# Google Drive Sync — Implementation TODO

**Author:** Petr Burian  
**Goal:** Allow users to sign in with Google and sync their Zenit Week data to their own Google Drive — no backend required.  
**Architecture:** 100% client-side. The app stores all week data in a single JSON file named `gravitas-map-data.json` inside the user's Google Drive `appDataFolder` — a hidden, app-specific folder that is not visible in the user's Drive UI.

---

## Prerequisites (One-time setup by developer)

### TASK-01 — Create Google Cloud Project & OAuth Client ID

**What:** Register the app in Google Cloud Console to obtain an OAuth 2.0 Client ID. This is a one-time manual step done by the developer, not by an AI agent.

**Steps:**
1. Go to https://console.cloud.google.com and create a new project named `gravitas-map`.
2. Enable the **Google Drive API** for the project.
3. Create an **OAuth 2.0 Client ID** credential of type "Web application".
4. Add the following as Authorized JavaScript origins: `http://localhost` (for local development) and the production domain once known (e.g. `https://gravitasmap.app`).
5. Copy the generated Client ID string (format: `xxxx.apps.googleusercontent.com`).
6. Store the Client ID as a named constant near the top of the application's JavaScript, alongside other global configuration values.

**Note:** No client secret is needed. This uses a public OAuth client (PKCE/implicit flow, entirely client-side). The Client ID is safe to embed in the source code.

---

## Implementation Tasks

### TASK-02 — Load Google authentication and API libraries

**What:** Two external Google JavaScript libraries must be loaded when the app starts. The first is the **Google Identity Services (GIS)** library, which handles the modern OAuth 2.0 sign-in flow. The second is the **Google API Client (GAPI)** library, which provides a convenient interface for calling Drive API endpoints. Both should be loaded asynchronously so they do not block initial rendering. Neither library should be bundled — load them from Google's official CDN URLs.

---

### TASK-03 — Add sync-related state variables

**What:** Introduce a small set of global state variables to track the sync lifecycle. The app needs to know: whether the user is currently signed in, what the Drive file ID is (so it doesn't have to look it up on every save), and the current sync status. The sync status should distinguish at least four states: not signed in, connected and idle, actively syncing, and error. These variables should live alongside the existing global state at the top of the script.

---

### TASK-04 — Add sync UI to the toolbar

**What:** Add a sign-in button and a small status indicator to the existing toolbar area on the right-hand side.

The **sign-in button** should display the official Google "G" logo alongside a short text label (e.g. "Sign in"). When the user is already signed in, the label should update to show their name or "Signed in", and clicking it should offer to sign out. The button should follow Google's branding guidelines (white background, thin border, Google colors).

The **status indicator** is a small colored dot placed next to the button. It communicates sync state at a glance: grey = not connected, green = synced, yellow/amber (pulsing) = currently syncing, red = error. The dot should show a descriptive tooltip on hover (e.g. "Synced with Google Drive" or "Sync error: token expired").

The styling should match the existing app's clean, minimal aesthetic.

---

### TASK-05 — Initialize Google authentication on app load

**What:** When the app initializes, set up the Google Identity Services token client using the stored Client ID and requesting only the `https://www.googleapis.com/auth/drive.appdata` scope (the minimum required — it only grants access to the app's own hidden folder, not the user's full Drive). Because the GIS library loads asynchronously, the initialization logic must wait until the library is available before proceeding.

The token client's callback should handle both success (proceed to load data) and failure (show error state). Call this initialization from the existing `init()` function that runs on page load. Also attempt a silent session restore on load (see TASK-15).

---

### TASK-06 — Handle sign-in button click

**What:** When the user clicks the sign-in button, request an OAuth access token from Google. If the user is already signed in, prompt them to confirm sign-out instead. If the auth library is not yet ready, show a brief message asking the user to try again in a moment. A successful token response should trigger loading the GAPI client and pulling data from Drive.

---

### TASK-07 — Handle sign-out

**What:** When the user signs out, revoke the current access token with Google's servers, clear the token from memory, clear the cached Drive file ID, and reset the sync status indicator to the disconnected state. Update the button label back to "Sign in". Also clear the session persistence flag (see TASK-15) so the next app open does not attempt a silent re-authentication.

---

### TASK-08 — Load GAPI client and initiate first sync

**What:** After a successful sign-in, load the Google API Client library and initialize it. Once ready, mark the sync status as connected, update the button label to reflect the signed-in user, and immediately pull the latest data from Drive to ensure the local app state is up to date. Handle any initialization errors by setting the error sync state.

---

### TASK-09 — Find or create the Drive data file

**What:** Implement a helper that returns the Drive file ID for `gravitas-map-data.json` stored in `appDataFolder`. On first run the file won't exist yet, so the helper must first search for it and, if not found, create it. The file ID should be cached in memory so subsequent saves do not repeat the search. Use the Google Drive API v3.

---

### TASK-10 — Save data to Drive

**What:** Implement a save-to-Drive function that collects all Zenit Week entries from `localStorage` (identifiable by their `week-planner-` key prefix) and uploads them as a single JSON object to the Drive file. The upload should happen asynchronously and non-blocking — it should not interrupt the user's interaction. Set the sync status to "syncing" during upload and back to "connected" on success. On error, set the error state.

Integrate this into the existing `saveWeek()` function: after writing to `localStorage`, trigger a Drive sync if the user is connected.

---

### TASK-11 — Load data from Drive

**What:** Implement a load-from-Drive function that downloads the JSON file from Drive and merges its contents into `localStorage`. This should be called immediately after sign-in to bring the local state up to date. For each week key found in the Drive data, apply the conflict resolution logic from TASK-13. After merging, re-render the current week view to reflect any newly loaded data. Handle errors gracefully by setting the error state.

---

### TASK-12 — Sync status helper

**What:** Implement a small helper function that accepts a status string and an optional error message, updates the global sync state variable, and reflects the change in the UI — updating the dot's color class and tooltip text. This helper should be called from all other sync functions to keep status updates consistent and avoid duplication.

---

### TASK-13 — Conflict resolution: last-write-wins per week

**What:** When merging Drive data into `localStorage`, do not blindly overwrite local data. Instead, compare each week's `savedAt` timestamp (added in TASK-14) and keep whichever version is newer. If the remote version is newer, write it to `localStorage`. If the local version is newer, keep it. If either version is missing a timestamp (e.g. older data), fall back to keeping the local version. If JSON parsing fails for any reason, keep the local version and log the error silently.

---

### TASK-14 — Add a save timestamp to week data

**What:** Before every `localStorage.setItem` call in `saveWeek()`, add a `savedAt` field to `weekData` containing the current Unix timestamp in milliseconds (`Date.now()`). This timestamp is what enables the conflict resolution in TASK-13 to determine which device's data is more recent.

---

### TASK-15 — Silent session restore on app load

**What:** Google access tokens expire after 1 hour. Implement silent token refresh so returning users are not shown a sign-in popup unless truly necessary. The approach: when a user signs in successfully, store a small flag in `localStorage` (e.g. `gravitas-had-google-session`) to indicate a previous session existed. On app load, if this flag is present, attempt a silent token request (no user-visible prompt). If the silent request succeeds, resume sync normally. If it fails (user revoked access, etc.), clear the flag and show the disconnected state. Remove the flag on explicit sign-out.

---

### TASK-16 — Privacy notice

**What:** Users should clearly understand where their data is stored. Add a tooltip to the sign-in button explaining that data is stored only in the user's own Google Drive and that Gravitas Map never sees or stores it. When the README is written, include a short "Privacy" section stating that sync uses `appDataFolder` (visible only to this app), there is no backend server, and data is transmitted only between the user's browser and their own Google account.

---

### TASK-17 — Manual test checklist

Before shipping the sync feature, verify all of the following manually:

- [ ] Clicking "Sign in" opens the Google OAuth popup and grants a token
- [ ] After sign-in, the status dot turns green and the button shows the user's name
- [ ] Saving a week triggers a sync; the dot briefly turns amber then back to green
- [ ] The Drive file `gravitas-map-data.json` is created in `appDataFolder` with correct data
- [ ] Opening the app on a second browser or device and signing in loads the same data
- [ ] Editing on device A and saving, then refreshing device B shows device A's changes
- [ ] Clicking the signed-in button and confirming sign-out resets the dot to grey
- [ ] Reopening the app within 1 hour silently restores the session without a popup
- [ ] Revoking the app in Google Account settings causes the app to show the error state gracefully
- [ ] The feature works correctly on Chrome, Firefox, and Safari
- [ ] Opening from a `file://` URL does not crash (though OAuth will require a proper origin to function)

---

## Summary

| Task | Description | Effort |
|------|-------------|--------|
| TASK-01 | Google Cloud project + OAuth client ID (manual) | 15 min |
| TASK-02 | Load GIS + GAPI libraries | 5 min |
| TASK-03 | Sync state variables | 5 min |
| TASK-04 | Sync UI: button + status dot | 20 min |
| TASK-05 | Initialize Google auth on app load | 15 min |
| TASK-06 | Sign-in button handler | 10 min |
| TASK-07 | Sign-out handler | 10 min |
| TASK-08 | Load GAPI client + first sync | 15 min |
| TASK-09 | Find or create Drive file | 20 min |
| TASK-10 | Save data to Drive | 20 min |
| TASK-11 | Load data from Drive | 20 min |
| TASK-12 | Sync status helper | 10 min |
| TASK-13 | Conflict resolution | 15 min |
| TASK-14 | `savedAt` timestamp | 5 min |
| TASK-15 | Silent session restore | 15 min |
| TASK-16 | Privacy notice | 5 min |
| TASK-17 | Manual test checklist | 30 min |

**Total estimated implementation time:** ~3.5 hours for an AI agent with no prior context.

---

## Architecture Notes

- **No backend required.** The app communicates directly with Google Drive API from the browser using the user's own OAuth token.
- **`appDataFolder` scope** means the file is invisible to the user in Drive — it won't clutter their storage. Only this app can access it.
- **Single file strategy:** All weeks are serialized into one JSON blob. This keeps API calls to 1 read + 1 write per sync, minimizing quota usage and complexity.
- **Google Drive API free tier** allows effectively unlimited requests for a small open-source app.
- **iCloud / CloudKit JS** can be added later as TASK-18 using the same pattern, toggled via a "Sync provider" selector in settings.
