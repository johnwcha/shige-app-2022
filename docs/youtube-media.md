# Firestore YouTube lookup

## Findings — November 8, 2026

Read-only inspection of the default Firestore database in `shige-app-2022`
confirmed the existing sources:

| Collection | Records | Relevant fields | Purpose |
| --- | ---: | --- | --- |
| `hymns` | 498 | `hymn`, `link`, `updated` | Existing recording catalog. 493 records have a link; 420 have a valid YouTube video URL. |
| `dynamicHymns` | 8 | `hymnID`, `edition`, `published`, `youtubeUrl` | Published added lyrics; all eight currently have valid YouTube links. |
| `shige-2022` | 1,334 | `hymnID`, `edition`, `html` | Original lyric collection; no `link` or `youtubeUrl` fields found. |

The old `getHymnMp3` function fetched a hymnal.net page and extracted MP3 URLs
with regular expressions. No MIDI retrieval code exists in this checkout.
The sample pages `ch/1` and `ts/1` returned HTTP 200 and still contained MP3
URLs, but HEAD requests to four sample recording URLs returned HTTP 403.
This confirms a direct-access failure from the research environment; it does
not establish whether every recording is permanently unavailable.

The dynamic hymn reader previously omitted `youtubeUrl` from its response,
even though the field already exists in Firestore.

## Lookup behavior

`GET /api/getHymnYoutube?hymnNumber=378&edition=ch` reads Firestore through the
existing Firebase Admin SDK. No browser Firestore permissions or YouTube API
key are needed. Example response:

```json
{
  "success": true,
  "hymnNumber": "378",
  "edition": "ch",
  "youtubeUrl": "https://www.youtube.com/watch?v=m0T6rqWPqjA",
  "source": "hymns"
}
```

1. Query `dynamicHymns` by the exact string `hymnID`, then filter by edition
   and `published === true`. Prefer the most recently updated matching document.
2. A published dynamic record owns its recording choice. If its link is empty
   or invalid, return `youtubeUrl: null`; do not attach a legacy recording to
   potentially different lyrics.
3. Otherwise read the legacy `hymns` catalog. Recognize `D`/`d`/`大本` and
   `大本詩歌`/`大本诗歌` as `ch`; recognize `b`/`B`/`補充本`/`補充`/`小本`
   as `ts`. Extract the number from the start of the label.
4. Ignore non-YouTube links and ambiguous labels such as `>71`, bare `444`,
   appendix numbers, and titles without a numbered edition. Do not guess.
5. If several legacy documents match, use the newest valid recording by
   `updated`, breaking timestamp ties by document ID.

This yields **401 usable legacy records covering 386 distinct edition/number
pairs**, plus the **8 dynamic records**. Nineteen otherwise valid YouTube
records lack a recognized numbered edition. These require manual classification
before they can be matched safely. Of the other legacy links, 72 point to
hymnal.net, one points to the app, and five records have no link.

Leading zeros matter: `dynamicHymns/ts-001` is “Were you there when they
crucified my Lord,” while legacy `b1` is “開口讚美.” Dynamic IDs `001`–`008`
must remain distinct from bundled IDs `1`–`8`.

## Frontend and administration

The three audio controls are replaced by one accessible YouTube link. It opens
the saved video in a new tab so the app retains the displayed lyrics. YouTube
watch pages are not direct audio files for `new Audio(url)`. An in-app player
would require a visible YouTube iframe and separate player lifecycle handling;
the external link avoids embedding restrictions and that additional UI.

The button hides immediately on selection changes and ignores late responses
for previous hymns. It remains hidden for missing links, errors, or offline use.
YouTube playback requires an internet connection.

`getDynamicHymns` now includes the validated `youtubeUrl`. The existing protected
admin form and `createDynamicHymn` accept an optional YouTube URL. Omitting the
field in API edits preserves an existing value; sending an empty string clears
it. URLs are restricted to HTTPS YouTube video hosts and normalized to watch
URLs, preserving a valid start time and dropping sharing trackers.

The initial code implementation did not modify Firestore documents or require
a collection migration. A subsequent user-requested label cleanup is recorded below.

## Label cleanup — November 8, 2026

The `hymns.hymn` labels now use `D<number>` for all 295 recognized large-book
records and `b<number>` for all 175 recognized supplemental records. Titles and
numbers were preserved. Of those records, 343 already used the canonical form;
127 were updated (88 large-book and 39 supplemental).

The cleanup changed only the `hymn` field, in one atomic commit with document
update-time preconditions. All 498 documents were read back and their fields
verified against the pre-change backup. The 28 ambiguous/other records and the
separate `dynamicHymns` collection were left unchanged. The original `updated`
timestamps were retained so recording precedence does not change.

A full collection backup and commit receipt are saved locally under
`/home/jc/.local/share/codex/backups/shige-app-2022/`, with basename
`hymns-labels-20261109T025043Z` (UTC timestamp; November 8 in Los Angeles).

## Cost, caching, and deployment

Legacy labels are unstructured, so lookup initially reads the catalog's
`hymn`, `link`, and `updated` fields. The index is cached for five minutes per
warm function instance; concurrent reads share the same pending load. Each
request also queries the dynamic ID. HTTP responses cache for one minute.
Legacy edits may take roughly six minutes to appear. New function instances
read the catalog again; a future structured `edition`/`hymnID` index would avoid
these scans if traffic grows.

Deploy the updated functions and Hosting together after review:

```bash
firebase deploy --only functions:getHymnYoutube,functions:getDynamicHymns,functions:createDynamicHymn,hosting
```

The old `/api/**` catch-all rewrite is replaced by the explicit YouTube route.
The retired `getHymnMp3` export is removed from source. The selective deploy
above leaves any previously deployed MP3 function in place; remove that old
function separately after older clients have moved to the new app version.
Deployed to `shige-app-2022` on November 8, 2026, with the functions runtime
upgraded to Node.js 22 because Node.js 20 no longer accepts deployments.

## Verification

- Nine automated tests pass for URL validation, legacy label matching, duplicate
  selection, exact padded IDs, draft exclusion, empty links, API errors,
  dynamic read/write behavior, stale responses, and offline behavior. Backend
  tests use a Firestore test double; no production writes are performed.
- The legacy index builder was also run against the read-only catalog snapshot
  to establish the coverage figures above.
- The production Vite build passes. It retains the large JavaScript chunk
  warning caused by the bundled lyric database (about 4.55 MB before gzip).
- Headless Chrome checks pass at a mobile viewport for number and edition
  changes, dynamic `001`, lyric search selection, blank input, offline/reconnect,
  the external YouTube link, and the admin form payload, with no page errors.
  Those browser checks use stubbed API responses; video playback has not been
  verified. After deployment, live HTTP checks confirmed the built site and
  assets, legacy `ch/378` and dynamic `ts/001` YouTube lookups, and all eight
  published dynamic hymns with YouTube fields. All nine tests also pass on
  Node.js 22.

## Research sources

- [Firebase: retrieve documents using the Admin SDK](https://firebase.google.com/docs/firestore/query-data/get-data).
- [YouTube: embedded players and parameters](https://developers.google.com/youtube/player_parameters).
- [Sample large-book page](https://www.hymnal.net/zh/hymn/ch/1)
  and [small-book page](https://www.hymnal.net/zh/hymn/ts/1).
