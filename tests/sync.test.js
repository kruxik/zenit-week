import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { 
  _state, 
  exchangeToken, 
  silentRefresh, 
  authFetch,
  syncWeekToDrive,
  syncWeekFromDrive,
  pollDriveMeta,
  fnv1a32,
  attemptSilentRestore,
  defaultWeekData
} from './setup.js';

const GOOGLE_AUTH_STORAGE_KEY = 'zenit-week-google-auth';

const handlers = [
  // Mock OAuth token exchange
  http.post('http://localhost/api/token', async ({ request }) => {
    const body = await request.json();
    if (body.refresh_token === 'valid_refresh_token' || body.code === 'valid_code') {
      return HttpResponse.json({
        access_token: 'new_access_token',
        refresh_token: 'new_refresh_token',
        expires_in: 3600
      });
    }
    return HttpResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }),

  // Mock Google Drive API - About
  http.get('https://www.googleapis.com/drive/v3/about', () => {
    return HttpResponse.json({ user: { emailAddress: 'test@example.com', displayName: 'Test User' } });
  }),

  // Mock Google Drive API - List files
  http.get('https://www.googleapis.com/drive/v3/files', ({ request }) => {
    const url = new URL(request.url);
    const q = url.searchParams.get('q');
    if (q && q.includes("name = 'zenit-week-2026-01.json'")) {
      return HttpResponse.json({
        files: [{ id: 'file_id_2026_01', name: 'zenit-week-2026-01.json', appProperties: { contentHash: 'remote_hash' } }]
      });
    }
    if (q && q.includes("name = 'zenit-week-colors.json'")) {
      return HttpResponse.json({
        files: [{ id: 'file_id_colors', name: 'zenit-week-colors.json', appProperties: { contentHash: 'colors_hash' } }]
      });
    }
    return HttpResponse.json({ files: [] });
  }),
  
  // Mock Google Drive API - Get file metadata OR content
  http.get('https://www.googleapis.com/drive/v3/files/:fileId', ({ params, request }) => {
    const url = new URL(request.url);
    const isMedia = url.searchParams.get('alt') === 'media';

    if (params.fileId === 'file_id_2026_01') {
      if (isMedia) {
        const data = defaultWeekData();
        data.nodes.push({ id: 'remote_node', type: 'activity', label: 'Remote Task', parent: 'work', children: [], _ts: 5000 });
        data.nodes.find(n => n.id === 'work').children.push('remote_node');
        data.savedAt = 5000;
        return HttpResponse.json(data);
      }
      return HttpResponse.json({
        id: 'file_id_2026_01',
        appProperties: { contentHash: 'remote_hash' }
      });
    }
    if (params.fileId === 'file_id_colors') {
      if (isMedia) {
        return HttpResponse.json({ theme: 'dark', savedAt: Date.now() });
      }
      return HttpResponse.json({
        id: 'file_id_colors',
        appProperties: { contentHash: 'colors_hash' }
      });
    }
    return new HttpResponse(null, { status: 404 });
  }),

  // Mock Google Drive API - Update file (PATCH)
  http.patch('https://www.googleapis.com/upload/drive/v3/files/:fileId', () => {
    return HttpResponse.json({ id: 'file_id_2026_01' });
  }),

  // Mock Google Drive API - Create file (POST)
  http.post('https://www.googleapis.com/drive/v3/files', () => {
    return HttpResponse.json({ id: 'new_file_id' });
  })
];

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  _state.resetSyncState();
});
afterAll(() => server.close());

describe('Google Drive Sync', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.clearIDBStore();
  });

  describe('OAuth and Authentication', () => {
    test('exchangeToken handles successful response', async () => {
      const result = await exchangeToken({ code: 'valid_code' });
      expect(result.access_token).toBe('new_access_token');
    });

    test('silentRefresh updates internal token state', async () => {
      _state.setLocalStorage(GOOGLE_AUTH_STORAGE_KEY, { refresh_token: 'valid_refresh_token' });
      
      const ok = await silentRefresh('valid_refresh_token');
      expect(ok).toBe(true);
      
      expect(_state.getAccessToken()).toBe('new_access_token');
    });

    test('authFetch automatically refreshes token on 401', async () => {
      _state.setLocalStorage(GOOGLE_AUTH_STORAGE_KEY, { refresh_token: 'valid_refresh_token' });
      await attemptSilentRestore();
      
      let callCount = 0;
      server.use(
        http.get('https://www.googleapis.com/test', () => {
          callCount++;
          if (callCount === 1) {
            return new HttpResponse(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
          }
          return HttpResponse.json({ success: true });
        })
      );

      const resp = await authFetch('https://www.googleapis.com/test');
      const data = await resp.json();
      
      expect(data.success).toBe(true);
      expect(callCount).toBe(2);
    });

    test('silentRefresh returns false on invalid token', async () => {
      _state.setLocalStorage(GOOGLE_AUTH_STORAGE_KEY, { refresh_token: 'invalid_token' });
      
      const ok = await silentRefresh('invalid_token');
      expect(ok).toBe(false);
    });
  });

  describe('Drive API Orchestration', () => {
    test('syncWeekFromDrive (Pull) merges remote data into local', async () => {
      _state.setLocalStorage(GOOGLE_AUTH_STORAGE_KEY, { refresh_token: 'valid_refresh_token' });
      await attemptSilentRestore();
      _state.setDriveFileId('2026-01', 'file_id_2026_01');
      
      // Initial local state
      const localData = defaultWeekData();
      const workNode = localData.nodes.find(n => n.id === 'work');
      workNode.children.push('local_node');
      localData.nodes.push({ id: 'local_node', type: 'activity', label: 'Local Task', parent: 'work', children: [], _ts: 1000 });
      localData.savedAt = 1000;
      await _state.saveWeekIDB('2026-01', localData);
      
      await syncWeekFromDrive('2026-01');
      
      const merged = (await _state.loadWeekIDB('2026-01'));
      expect(merged).not.toBeNull();
      expect(merged.nodes.some(n => n.id === 'remote_node')).toBe(true);
      expect(merged.nodes.some(n => n.id === 'local_node')).toBe(true);
    });

    test('syncWeekToDrive (Push) uploads local data to Drive', async () => {
      _state.setLocalStorage(GOOGLE_AUTH_STORAGE_KEY, { refresh_token: 'valid_refresh_token' });
      await attemptSilentRestore();
      _state.setDriveFileId('2026-01', 'file_id_2026_01');
      
      let patchedBody = null;
      server.use(
        http.patch('https://www.googleapis.com/upload/drive/v3/files/:fileId', async ({ request }) => {
          patchedBody = await request.text();
          return HttpResponse.json({ id: 'file_id_2026_01' });
        })
      );

      const localData = defaultWeekData();
      const workNode = localData.nodes.find(n => n.id === 'work');
      workNode.children.push('local_node');
      localData.nodes.push({ id: 'local_node', type: 'activity', label: 'Local Task', parent: 'work', children: [], _ts: 1000 });
      await _state.saveWeekIDB('2026-01', localData);
      
      await syncWeekToDrive('2026-01');
      
      expect(patchedBody).not.toBeNull();
      expect(patchedBody).toContain('local_node');
    });

    test('pollDriveMeta detects remote changes and triggers sync', async () => {
      _state.setLocalStorage(GOOGLE_AUTH_STORAGE_KEY, { refresh_token: 'valid_refresh_token' });
      await attemptSilentRestore();
      _state.setDriveFileId('2026-01', 'file_id_2026_01');
      await _state.saveWeekIDB('2026-01', defaultWeekData());
      _state.setLastSyncedHash('2026-01', 'old_hash');
      
      await pollDriveMeta('2026-01');
      
      const merged = (await _state.loadWeekIDB('2026-01'));
      expect(merged.nodes.some(n => n.id === 'remote_node')).toBe(true);
    });
    
    test('pollDriveMeta handles resetToken mismatch (Full Resync)', async () => {
      _state.setLocalStorage(GOOGLE_AUTH_STORAGE_KEY, { refresh_token: 'valid_refresh_token' });
      await attemptSilentRestore();
      _state.setDriveFileId('colors', 'file_id_colors');
      _state.setLocalStorage('zenit-week-reset-token', 'local_token');
      _state.setLocalStorage('zenit-week-2026-01', { nodes: [{ id: 'old_node' }] });
      
      server.use(
        http.get('https://www.googleapis.com/drive/v3/files/file_id_colors', () => {
          return HttpResponse.json({
            appProperties: { resetToken: 'remote_token_new' }
          });
        })
      );

      await pollDriveMeta('2026-01');
      
      // Local data should be wiped (except auth)
      expect(_state.getLocalStorage('zenit-week-2026-01')).toBeUndefined();
      expect(_state.getLocalStorage('zenit-week-reset-token')).toBe('remote_token_new');
    });
  });
});
