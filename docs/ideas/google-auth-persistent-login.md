# Google Auth — Persistent Login

## Problem Statement
How might we make Google Drive sync feel like a background utility (set-once, invisible forever) instead of a recurring interruption — without any backend server?

## Root Cause
All three pain points share one cause: **wrong OAuth flow**.

Current code uses `initTokenClient` → `requestAccessToken` (GIS implicit-like token flow):
- Returns only an `access_token` (lives 60 min)
- **Never returns a `refresh_token`** — by design
- Silent renewal (`prompt: 'none'`) works only if Google's cookie session is active AND one account is logged in. When it fails → popup steals focus

Token flow was designed for ephemeral access, not persistent sessions.

## Recommended Direction

Replace with **Authorization Code Flow + PKCE** via GIS `initCodeClient`.

```
1. First login (one time only):
   initCodeClient popup → user consents → gets auth code
   ↓
   Browser fetches: POST oauth2.googleapis.com/token
     { code, code_verifier, client_id, grant_type: "authorization_code", redirect_uri: "postmessage" }
   ↓
   Google returns: { access_token, refresh_token, expires_in }
   ↓
   Store { refresh_token, email } in localStorage

2. Every page load after that (silent, no popup):
   Browser fetches: POST oauth2.googleapis.com/token
     { refresh_token, client_id, grant_type: "refresh_token" }
   ↓
   Google returns: { access_token, expires_in }
   ↓
   Done. No UI. No popup.

3. Hourly renewal (silent, no popup):
   Same as step 2 — plain fetch(), zero UI.
```

This eliminates all three problems:

| Problem | Why it's fixed |
|---|---|
| Login lost on refresh | Refresh token in localStorage, silently restored on load |
| Re-consent on every login | Refresh token = no consent screen ever again (until revoked) |
| Popup on hourly renewal | Token refresh is a plain `fetch()` — zero UI |

## Key Assumptions

- **Google issues refresh tokens to public clients without a secret** — supported via PKCE per Google's official docs. Low risk of breaking.
- **Storing refresh_token in localStorage is acceptable** — token only grants `drive.appdata` access (app's own folder, invisible to other apps). No external scripts in this single-file app beyond Google's own GIS/GAPI. Confirmed acceptable for this threat model.
- **PKCE + postMessage works from zenitweek.com and localhost** — app no longer runs from `file://`; both origins are standard web contexts where GIS popup flow works reliably. Firebase Auth uses the same mechanism.
- **Let Google decide token expiry** — no app-side refresh token age wiping; stale tokens simply fail and fall back to the login button.

## MVP Scope

**In:**
- Replace `initTokenClient` → `initCodeClient` with `ux_mode: 'popup'`
- Implement PKCE (`code_verifier` + `code_challenge` via `crypto.subtle`, ~10 lines)
- Exchange code for tokens via `fetch` to `oauth2.googleapis.com/token`
- Store `{ refresh_token, email }` in localStorage key `zenit-week-google-auth`
- On page load: if stored refresh_token exists → silent exchange → restore session
- On 55-min timer: silent refresh via `fetch`, replacing current `requestAccessToken` call
- On sign-out: revoke refresh_token via `google.accounts.oauth2.revoke` + delete from localStorage
- Replace `zenit-week-had-google-session` flag with the new `zenit-week-google-auth` object

**Not in:**
- Refresh token encryption
- Service Worker token proxy
- Multi-account switcher
- Retry/backoff beyond "try once, fall back to sign-in button"

## Not Doing (and Why)

- **Backend server** — PKCE makes it unnecessary; user requirement
- **Refresh token encryption** — risk is `drive.appdata` only; overkill for this threat model
- **Service Worker token proxy** — same result as PKCE for 5× the complexity
- **Chrome Identity API** — extensions only
- **One Tap** — returns identity JWT, not Drive access token; wrong tool
- **Token age wiping** — unnecessary; let Google's own revocation handle it

## Open Questions

- `initCodeClient` replaces `initTokenClient` — confirm `zenit-week-had-google-session` is the only flag to migrate (no other code branches on it beyond silent-restore trigger).
