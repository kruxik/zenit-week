# Implementation Plan: IndexedDB & Local Persistence Tests

## Overview
Zenit Week persists data locally using `IndexedDB`, with fallback support for `localStorage`. It also includes a critical migration script (`runMigrationIfNeeded`) that moves legacy data from `localStorage` into `IndexedDB`. Currently, these mechanisms are heavily mocked out in the test suite (`tests/setup.js`), leaving the actual database interactions and migration logic untested. This plan introduces `fake-indexeddb` to run realistic storage tests within the existing Node.js/Vitest environment.

## Architecture Decisions
- **Framework:** Vitest (existing).
- **Library:** `fake-indexeddb`. This provides a complete, in-memory implementation of the IndexedDB API that works in Node.js, allowing us to test `openDB`, `transaction`, `put`, and `get` without needing a real browser.
- **Scope:** Test the migration logic, standard read/write operations, and error handling (e.g., handling blocked databases or quota errors).

## Task List

### Phase 1: Storage Test Foundation Setup
**Description:** Install `fake-indexeddb` and refactor the `setup.js` mocks so that specific tests can opt-in to using the realistic IndexedDB implementation instead of the null/no-op stubs.
**Acceptance criteria:**
- `fake-indexeddb` is added to `devDependencies`.
- A new file `tests/persistence.test.js` is created.
- The test file correctly patches the global `indexedDB` object with `fake-indexeddb` before tests run.

### Phase 2: Testing Core IDB Operations
**Description:** Verify the basic read, write, and delete wrappers over the IndexedDB API.
**Acceptance criteria:**
- Test `saveWeekIDB` and `loadWeekIDB` successfully round-trip a week's data object.
- Test `deleteWeekIDB` correctly removes data.
- Test `listWeekKeysIDB` correctly returns all stored week keys.
- Test that database connection errors (or blocked upgrades) are caught and handled gracefully (falling back to `localStorage` or showing an error).

### Phase 3: Testing Migration Logic (`runMigrationIfNeeded`)
**Description:** Ensure that the application correctly detects legacy data in `localStorage` and moves it to IndexedDB.
**Acceptance criteria:**
- Simulate a state where legacy data exists in `localStorage` but the `zenit-week-storage-migrated` flag is not set.
- Call `runMigrationIfNeeded()` and verify that data is correctly copied into the `fake-indexeddb` instance.
- Verify that the `zenit-week-storage-migrated` flag is set in `localStorage` after a successful migration.
- Verify that running the migration again is a no-op if the flag is already set.

### Phase 4: Fallback & Quota Error Testing
**Description:** Verify that the application falls back safely when IndexedDB is unavailable or throws errors.
**Acceptance criteria:**
- Force `openDB` to reject/fail and verify `loadWeek` successfully falls back to reading from `localStorage`.
- Simulate a `QuotaExceededError` (or generic `put` failure) during `saveWeekIDB` and ensure the error is logged or handled without crashing the application state.

## Verification
- All tests pass when running `npm test -- --grep "persistence"`.
- Test coverage for the IDB helper functions (L2864–L3023) increases significantly.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| `fake-indexeddb` behavior differs from actual browsers | Low | `fake-indexeddb` is highly compliant. For hyper-specific browser quirks (like Safari IDB bugs), we may need to rely on the E2E Playwright tests. |
| Global state pollution across tests | Medium | Ensure that `fake-indexeddb` state and the `localStorage` stub are wiped clean in `beforeEach` hooks in the persistence test file. |
