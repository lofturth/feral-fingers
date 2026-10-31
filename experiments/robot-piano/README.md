# Robot Piano

Standalone browser experiment for MIDI piano practice. It uses plain HTML, CSS, and JavaScript, with no build step.

## Run

From this directory, run `./run.sh` and open **http://127.0.0.1:4174/** in a browser with Web MIDI support. The server binds only to `127.0.0.1:4174`; if that port is unavailable, it exits instead of choosing another port. Refresh the browser manually to load file changes.

## Local recordings

Completed and cancelled attempts are stored in this browser's IndexedDB under the exact origin **http://127.0.0.1:4174/**. Moving the source files does not move or reset browser data; keep this URL unchanged to access existing recordings. Copy JSON and Download JSON export the saved sessions and attempts without deleting them. Browser site-data clearing would remove the local recordings.
