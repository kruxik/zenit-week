# Implementation Plan: Google Drive Sync Tests

## Overview
This plan outlines the steps to introduce comprehensive testing for the Google Drive sync logic in Zenit Week. Since the CRDT merge logic (`mergeWeekData`) is already tested, this effort will focus on testing the OAuth flows, the HTTP interactions with Google APIs, and the state-machine orchestration for syncing. We will use Mock Service Worker (`msw`) to safely mock network requests within Vitest without hitting actual endpoints.

## Task List

### Phase 1: Foundation & MSW Setup
**Description:** Install MSW and expose the internal sync functions from `zenit-week.html` so they can be tested.
**Acceptance criteria:**
- `msw` is added to `devDependencies`.
- `tests/setup.js` is updated to expose functions like `authFetch`, `driveApiRequest`, `syncWeekFromDrive`, `syncWeekToDrive`, `pollDriveMeta`, `silentRefresh`, and `exchangeToken`.
- A new file `tests/sync.test.js` is created with a basic MSW setup intercepting requests to `https://www.googleapis.com`.

### Phase 2: Testing OAuth and Authentication Flows
**Description:** Verify that authentication logic correctly handles tokens and auto-refresh mechanisms.
**Acceptance criteria:**
- Test `exchangeToken` simulates a successful login, ensuring tokens are properly stored in the mock `localStorage`.
- Test `silentRefresh` intercepts a token refresh request and verifies the new access token is applied.
- Test error handling when a refresh token is invalid or revoked (ensuring the user is "signed out" cleanly).

### Phase 3: Testing Drive API Orchestration
**Description:** Verify the core sync operations interact with the Drive API correctly.
**Acceptance criteria:**
- **Push (`syncWeekToDrive`):** Mock the Drive files list/create/update endpoints. Verify that a push correctly writes a file with the expected metadata (including custom `appProperties` like `hash`).
- **Pull (`syncWeekFromDrive`):** Mock a remote file payload. Verify that it correctly triggers a fetch and calls the already-tested CRDT merge logic.
- **Conflict detection (`pollDriveMeta`):** Test the background polling loop. Verify that it only initiates a full file download when the remote `properties.hash` differs from the local state.
- **Hash mismatch recovery:** Test the behavior when the local `zenit-week-reset-token` does not match the remote server, simulating an edge case where a sync is rejected and requires a re-fetch.

## Verification
- All tests pass when running `npm test -- --grep "sync"`.
- Vitest coverage report shows significant improvement in the lines spanning the Google Sync implementation block (L3599–L4632).

## Migration & Rollback
No application code is being structurally altered; this is purely an addition of tests. If tests are flaky, they can be skipped or rolled back via git without impacting the production build.