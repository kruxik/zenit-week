import { describe, test, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { _state, pollDriveChanges } from './setup.js';

// One changes.list call per cycle replaces one appProperties GET per watched
// file. The old path cost five requests an idle cycle and grew with every file
// worth watching; this one does not depend on how many files exist.
const server = setupServer();
server.listen({ onUnhandledRequest: 'bypass' });
afterAll(() => server.close());

const CHANGES = 'https://www.googleapis.com/drive/v3/changes';
const START = 'https://www.googleapis.com/drive/v3/changes/startPageToken';

describe('Drive change feed', () => {
  let calls;

  const arm = ({ changes = [], status = 200, newStartPageToken = 'tok2' } = {}) => {
    server.use(
      http.get(START, () => { calls.push('start'); return HttpResponse.json({ startPageToken: 'tok1' }); }),
      http.get(CHANGES, ({ request }) => {
        calls.push('changes:' + new URL(request.url).searchParams.get('pageToken'));
        if (status !== 200) return new HttpResponse(null, { status });
        return HttpResponse.json({ newStartPageToken, changes });
      }),
    );
  };

  const change = (name, appProperties, fileId = 'id-' + name) =>
    ({ removed: false, fileId, file: { id: fileId, name, appProperties } });

  beforeEach(() => {
    calls = [];
    _state.resetSyncState();
    _state.setAccessToken('token');
  });

  afterEach(() => { server.resetHandlers(); _state.setChangesPageToken(null); });

  test('baselines the cursor on the first tick and drains nothing', async () => {
    arm();
    await pollDriveChanges('2026-39');
    expect(calls).toEqual(['start']);
    expect(_state.getChangesPageToken()).toBe('tok1');
  });

  test('an idle cycle costs exactly one request', async () => {
    arm();
    _state.setChangesPageToken('tok1');
    await pollDriveChanges('2026-39');
    expect(calls).toEqual(['changes:tok1']);
    expect(_state.getChangesPageToken()).toBe('tok2');
  });

  test('ignores files that are not ours', async () => {
    arm({ changes: [change('someone-elses.json', { contentHash: '9' })] });
    _state.setChangesPageToken('tok1');
    await pollDriveChanges('2026-39');
    expect(calls).toEqual(['changes:tok1']);
  });

  test('an expired cursor is dropped so a full reconcile can rebuild it', async () => {
    arm({ status: 404 });
    _state.setChangesPageToken('stale');
    await pollDriveChanges('2026-39');
    expect(_state.getChangesPageToken()).toBe(null);
  });

  test('a changed week is fetched, using the id the feed handed us', async () => {
    const media = [];
    arm({ changes: [change('zenit-week-2026-39.json', { contentHash: '4242' }, 'fid-39')] });
    server.use(
      http.get('https://www.googleapis.com/drive/v3/files/fid-39', ({ request }) => {
        media.push(new URL(request.url).searchParams.get('alt'));
        return HttpResponse.json({ nodes: [], tombstones: [], crdtVersion: 1 });
      }),
    );
    _state.setChangesPageToken('tok1');
    await pollDriveChanges('2026-39');

    // No getDriveFileId lookup: the change payload carried the id, and a lookup
    // would create a placeholder for a file the feed just told us exists.
    expect(_state.getDriveFileId('2026-39')).toBe('fid-39');
    expect(media).toEqual(['media']);
  });

  test('our own upload coming back is not downloaded again', async () => {
    const media = [];
    arm({ changes: [change('zenit-week-2026-39.json', { contentHash: '4242' }, 'fid-39')] });
    server.use(
      http.get('https://www.googleapis.com/drive/v3/files/fid-39', () => {
        media.push('fetched');
        return HttpResponse.json({ nodes: [], tombstones: [], crdtVersion: 1 });
      }),
    );
    _state.setLastSyncedHash('2026-39', 4242);
    _state.setChangesPageToken('tok1');
    await pollDriveChanges('2026-39');

    expect(media).toEqual([]);
  });

  test('maps every filename the app writes back to its sync key', () => {
    expect(_state.wKeyForDriveFileName('zenit-week-2026-39.json')).toBe('2026-39');
    expect(_state.wKeyForDriveFileName('zenit-week-colors.json')).toBe('colors');
    expect(_state.wKeyForDriveFileName('zenit-week-schedule.json')).toBe('schedule');
    expect(_state.wKeyForDriveFileName('zenit-week-nonsense.json')).toBe(null);
    expect(_state.wKeyForDriveFileName('notes.txt')).toBe(null);
    expect(_state.wKeyForDriveFileName(undefined)).toBe(null);
  });
});
