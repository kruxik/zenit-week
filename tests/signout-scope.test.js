import { describe, test, expect, beforeEach, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { useMockServer } from './msw-strict.js';
import { http, HttpResponse } from 'msw';
import { signOut, _state } from './setup.js';

// Signing out ends this browser's session and nothing else. Revoking was
// tried and removed: Google's revoke endpoint acts on the grant behind the
// token it is given, which is this browser's own, so it cannot reach another
// device - measured twice on real devices - and all it bought was a fresh
// consent screen on the next sign-in.
const server = setupServer();
useMockServer(server);

describe('sign-out scope', () => {
  let tokenBodies;
  let revokeCalls;

  beforeEach(() => {
    tokenBodies = [];
    revokeCalls = [];
    server.use(
      http.post('http://localhost/api/token', async ({ request }) => {
        tokenBodies.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
      http.post('https://oauth2.googleapis.com/revoke', ({ request }) => {
        revokeCalls.push(new URL(request.url).searchParams.get('token'));
        return new HttpResponse(null, { status: 200 });
      }),
      // Sign-out flushes the week and colors to Drive before the token goes:
      // nothing is there yet, so each file is created, read back empty, then uploaded.
      http.get('https://www.googleapis.com/drive/v3/files', () => HttpResponse.json({ files: [] })),
      http.post('https://www.googleapis.com/drive/v3/files', () => HttpResponse.json({ id: 'new_file' })),
      http.get('https://www.googleapis.com/drive/v3/files/:fileId', () => HttpResponse.json({ id: 'new_file', appProperties: {} })),
      http.patch('https://www.googleapis.com/upload/drive/v3/files/:fileId', () => HttpResponse.json({ id: 'new_file' })),
    );
    _state.setAccessToken('access_token_of_this_device');
  });

  afterEach(() => server.resetHandlers());

  const flush = () => new Promise(r => setTimeout(r, 0));

  test('sign-out ends this session without telling Google', async () => {
    await signOut();
    await flush();

    expect(tokenBodies).toEqual([{ grant_type: 'logout' }]);
    expect(revokeCalls).toEqual([]);
    expect(_state.getAccessToken()).toBe(null);
  });

});
