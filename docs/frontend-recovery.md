# Frontend recovery — November 8, 2026

The GitHub `main` frontend was older than the frontend already hosted on Firebase.
Publishing it replaced the landing language selector, settings gear and sheet,
Traditional/Simplified lyric conversion, personal collections, last-viewed hymn,
and newer admin UI. This was a source/deployment mismatch, not browser caching.

Recovered Firebase version: `sites/shige-app-2022/versions/0faecced8138ce19`,
released October 4, 2026 (Los Angeles). The original unmodified HTML, JavaScript,
and CSS are backed up locally at
`/home/jc/.local/share/codex/backups/shige-app-2022/frontend-0faecced8138ce19/`.
A preview copy is available at
https://shige-app-2022--recover-ui-kmf2kr48.web.app.

`index.html` and `style.css` recover that interface. `app.js` is the recovered
JavaScript, formatted for editing; original module structure and variable names
were not available. It includes the original Chinese conversion dictionaries.
Its bundled lyric database was verified identical to `songDB.js` and replaced
with an import of that file. Future builds run normally through Vite.

The recovered MIDI/MP3 request and playback code, controls, and audio-refresh
setting are removed. Hymn selection uses the existing `hymn-video.js` module and
Firestore YouTube endpoint. The recovered admin page uses the already deployed
`manageDynamicHymns` function; its explicit Hosting rewrite is restored. This
recovery deploys Hosting only and does not replace that backend or change data.

The service worker cache version is incremented so older installations install
the restored shell; registration uses the root path and bypasses HTTP caches
when checking the worker script.

Validation: all nine existing media tests and the production build pass. Browser
checks verify landing language selection, converted lyrics, the gear opening the
settings sheet, font-size changes, and switching back to Traditional Chinese.
The build retains the existing large lyric bundle warning.
