# Dynamic Hymns

The app supports hymn additions from Firestore without rebuilding or redeploying
the frontend. The bundled `songDB.js` file still loads first, then published
Firestore records are merged into the in-memory hymn list and become searchable.

## Implementation Plan

This feature is intentionally split so dynamic additions do not require exposing
public write access from the app:

1. Keep bundled hymns in `songDB.js` as the fast default data source.
2. Read published Firestore additions from the `dynamicHymns` collection through
   a Cloud Function.
3. Route `/api/getDynamicHymns` to that function through Firebase Hosting.
4. Merge Firestore additions into the bundled hymn list in the browser.
5. Let Firestore records override bundled records with the same `edition` and
   `hymnID`, allowing corrections without a frontend redeploy.
6. Cache the latest dynamic hymn response locally so synced additions remain
   searchable while offline.
7. Protect write access with an admin token stored as a Firebase Functions
   secret.

The current admin workflow uses `/admin/add-hymn` plus a protected Cloud
Function. The write endpoint requires an admin token stored as a Firebase
Functions secret.

## Firestore Collection

Use this collection:

```text
dynamicHymns
```

The existing `hymns` collection is intentionally not used.

## Document Schema

Each document in `dynamicHymns` represents one hymn edition. A large-book and
small-book version of the same hymn should be stored as separate documents.

Required fields:

| Field | Type | Notes |
| --- | --- | --- |
| `hymnID` | string | Hymn number, such as `"1"` or `"1001"`. |
| `edition` | string | Use `"user_upload"` for new admin entries. Existing bundled editions use `"ch"` for large book and `"ts"` for small book. |
| `html` | string | Renderable hymn HTML. This app inserts it into the hymn display. |
| `published` | boolean | Must be `true` before the app will show it. |

Recommended fields:

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string | Optional title; included in search. |
| `searchText` | string | Plain-text lyrics/search keywords; included in search. |
| `updatedAt` | timestamp | Useful for tracking edits in Firestore. |
| `createdAt` | timestamp | Useful for tracking when the hymn was added. |
| `notes` | string | Internal notes; currently not shown in the app. |

## Example Document

Document ID can be anything stable, but this pattern is easy to scan:

```text
user_upload-9001
```

Example fields:

```json
{
  "hymnID": "9001",
  "edition": "user_upload",
  "title": "Example New Hymn",
  "html": "<div class=\"col-xs-12 lyrics chinese-lyrics\"><table class=\"js-stanzas\"><tbody><tr data-type=\"verse\"><td class=\"verse-num\"><div class=\"stanza-num\">1</div></td><td>First line<br>Second line</td></tr></tbody></table></div>",
  "searchText": "Example New Hymn First line Second line",
  "published": true
}
```

## How The App Loads Dynamic Hymns

1. The app starts with bundled hymns from `songDB.js`.
2. It loads cached dynamic hymns from `localStorage`, if available.
3. If online, it calls:

```text
/api/getDynamicHymns
```

4. The Cloud Function reads published records from `dynamicHymns`.
5. The browser caches the returned records for offline fallback.
6. Number lookup and lyric search use the merged list.

If a Firestore hymn has the same `edition` and `hymnID` as another loaded hymn,
the later Firestore record replaces the earlier one in the app. Corrections to
bundled hymns can still use `"ch"` or `"ts"`, while new admin-added hymns should
use `"user_upload"`.

## Offline Behavior

Dynamic hymns are available offline after the app has successfully loaded them
online at least once on that device. The current implementation caches the API
response in `localStorage`, which is simple and works well for moderate
additions. If dynamic hymn volume grows large, move the cache to IndexedDB.

## Publishing Workflow

1. Open `/admin/add-hymn`.
2. Enter the admin token.
3. Fill in hymn number, edition, title, HTML, and search text.
4. Leave `Publish immediately` checked if the hymn should appear in the app.
5. Submit the form.
6. Open the app online. The new hymn should appear in number lookup and search.

No frontend rebuild is needed for new Firestore records.

You can still edit records directly in Firestore. Keep `published` as `false`
while drafting, then set it to `true` when ready.

## Admin Token Setup

The admin write API is `createDynamicHymn`, exposed through:

```text
/api/createDynamicHymn
```

It requires this Firebase Functions secret:

```text
DYNAMIC_HYMN_ADMIN_TOKEN
```

Set it before deploying the function:

```bash
firebase functions:secrets:set DYNAMIC_HYMN_ADMIN_TOKEN
```

Use a long private value. The admin page sends it as:

```text
Authorization: Bearer <token>
```

The browser stores the token in `localStorage` after a successful save, so use
the admin page only on devices you trust.

## Deployment Notes

The dynamic hymn API is implemented in `functions/index.js` as
`getDynamicHymns`. The admin write API is implemented as `createDynamicHymn`.
Firebase Hosting routes `/api/getDynamicHymns`, `/api/createDynamicHymn`, and
`/admin/**` through `firebase.json`.

Deploy functions and hosting after code changes:

```bash
firebase deploy --only functions,hosting
```
