# Google Drive Sync

## Problem Statement
How Might We sync Zenit Week data across devices without a backend, using only the user's own Google Drive?

**Root problem:** `localStorage` is device-local. Multi-device use means data diverges silently.

## Recommended Direction

Deploy to GitHub Pages first, then implement the TODO plan in order.

The `todos/GOOGLE_DRIVE_SYNC_TODO.md` plan is solid architecture. The only gap is the `file://` blocker — Google Identity Services rejects non-HTTP origins, so OAuth cannot work until the app is served over HTTP.

**Fastest path to working sync:**
1. Deploy `zenit-week.html` to GitHub Pages (5 min) → establishes an HTTP origin (rename to `zenit-week.html` when ready)
2. Do TASK-01 (Google Cloud Console, register that domain as OAuth origin)
3. Implement TASK-02 through TASK-16 in order — the plan is complete, no redesign needed

## Key Assumptions to Validate
- [ ] App will run from HTTP going forward (GitHub Pages or localhost) — confirm before any code
- [ ] `appDataFolder` data is invisible to user in Drive UI — if Google access is lost, data recovery is hard; consider periodic JSON export as backup
- [ ] Last-write-wins (TASK-13) is acceptable — editing same week on two devices simultaneously loses one version silently

## MVP Scope
- Deploy to GitHub Pages or set up localhost server
- Complete TASK-01 through TASK-16 as specified in the TODO
- Manual verification via TASK-17 checklist

## Not Doing (and Why)
- **Backend/server** — unnecessary; the plan correctly avoids it
- **Per-week Drive files** — single JSON blob is right; 1 read + 1 write per sync minimizes quota and complexity
- **CRDT conflict resolution** — last-write-wins is sufficient for personal planning data
- **Dropbox/iCloud now** — already noted as TASK-18 future work

## Open Questions
- Deploy to GitHub Pages or use localhost for development?
- Google account ready to create the Cloud project?
- JSON export/import fallback for users without Google accounts?
