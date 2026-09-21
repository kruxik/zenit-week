import { describe, test, expect, beforeEach, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { signOut, signOutAllDevices, _state } from './setup.js';

// Signing out of one device must not sign the account out of the others.
// Google's revoke endpoint works on the grant, not on the token handed to it:
// revoking one device's refresh token withdraws the app's authorization for
// the whole account, so every other device gets 401 on Drive and invalid_grant
// on refresh. Sign-out therefore clears the cookie and stops; signing out of
// all devices is the separate, deliberate act that revokes.
const server = setupServer();
server.listen({ onUnhandledRequest: 'bypass' });
afterAll(() => server.close());

describe('sign out vs sign out of all devices', () => {
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

  test('signing out of all devices revokes the grant as well', async () => {
    await signOutAllDevices();
    await flush();

    expect(tokenBodies).toEqual([{ grant_type: 'revoke' }]);
    expect(revokeCalls).toEqual(['access_token_of_this_device']);
    expect(_state.getAccessToken()).toBe(null);
  });
});
