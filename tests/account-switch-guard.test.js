// A token the user did not just pick an account for (silent restore, renewal,
// a 401 refresh) may speak for another Google account: the HttpOnly refresh
// cookie can be replaced from outside the page. verifyDriveIdentity holds
// every Drive request behind a gate until the account matches the stored one
// or the user confirms the switch; declining signs out without uploading.
import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { _state, sandboxGlobal, verifyDriveIdentity, authFetch } from './setup.js';

const GOOGLE_AUTH_STORAGE_KEY = 'zenit-week-google-auth';
const VICTIM = 'me@example.com';
const OTHER  = 'someone-else@example.com';

let aboutEmail;
let tokenBodies;
let driveRequests;   // every googleapis request except the about lookup
let aboutCalls;

const server = setupServer(
  http.post('http://localhost/api/token', async ({ request }) => {
    const body = await request.json();
    tokenBodies.push(body);
    if (body.grant_type === 'logout') return new HttpResponse(null, { status: 204 });
    return HttpResponse.json({ access_token: 'token_from_cookie', expires_in: 3600 });
  }),
  http.get('https://www.googleapis.com/drive/v3/about', () => {
    aboutCalls++;
    return HttpResponse.json({ user: { emailAddress: aboutEmail, displayName: 'X', photoLink: '' } });
  }),
  http.all('https://www.googleapis.com/*', ({ request }) => {
    driveRequests.push(`${request.method} ${new URL(request.url).pathname}`);
    return HttpResponse.json({ files: [] });
  }),
);

describe('account-change guard', () => {
  const realConfirm = sandboxGlobal.showAppConfirm;
  let asked;
  let answer;   // 'confirm' | 'cancel' | null (leave the dialog open)
  let pendingDialog;

  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
  afterAll(() => server.close());

  beforeEach(() => {
    _state.resetSyncState();
    _state.clearLocalStorage();
    aboutEmail = VICTIM;
    tokenBodies = [];
    driveRequests = [];
    aboutCalls = 0;
    asked = null;
    answer = 'cancel';
    pendingDialog = null;
    sandboxGlobal.showAppConfirm = (opts) => {
      asked = opts;
      if (answer === 'confirm') opts.onConfirm();
      else if (answer === 'cancel') opts.onCancel();
      else pendingDialog = opts;
    };
    _state.setLocalStorage(GOOGLE_AUTH_STORAGE_KEY, { hasSession: true, email: VICTIM });
    _state.setAccessToken('token_from_cookie');
  });
  afterEach(() => {
    sandboxGlobal.showAppConfirm = realConfirm;
    _state.resetSyncState();
    server.resetHandlers();
  });

  const storedEmail = () => JSON.parse(_state.getLocalStorage(GOOGLE_AUTH_STORAGE_KEY) || 'null')?.email;

  test('the same account passes without a question and opens the gate', async () => {
    const { verdict } = await verifyDriveIdentity();
    expect(verdict).toBe('same');
    expect(asked).toBe(null);
    expect(_state.getIdentityGate()).toBe(null);
  });

  test('no stored identity: nothing to compare, nothing fetched', async () => {
    _state.setLocalStorage(GOOGLE_AUTH_STORAGE_KEY, { hasSession: true });
    const { verdict } = await verifyDriveIdentity();
    expect(verdict).toBe('unknown');
    expect(aboutCalls).toBe(0);
  });

  test('a different account asks, naming both emails, as a danger dialog', async () => {
    aboutEmail = OTHER;
    answer = 'confirm';
    await verifyDriveIdentity();
    expect(asked.danger).toBe(true);
    expect(asked.body).toContain(VICTIM);
    expect(asked.body).toContain(OTHER);
    expect(typeof asked.onCancel).toBe('function');
  });

  test('accepting the switch stores the new identity and drops the old file ids', async () => {
    aboutEmail = OTHER;
    answer = 'confirm';
    _state.setDriveFileId('2026-01', 'victims_file');
    const { verdict } = await verifyDriveIdentity();
    expect(verdict).toBe('switched');
    expect(storedEmail()).toBe(OTHER);
    expect(_state.getDriveFileId('2026-01')).toBe(null);
    expect(_state.getIdentityGate()).toBe(null);
  });

  test('declining signs out, clears the cookie, and uploads nothing', async () => {
    aboutEmail = OTHER;
    answer = 'cancel';
    const { verdict } = await verifyDriveIdentity();
    expect(verdict).toBe('declined');
    await new Promise(r => setTimeout(r, 10));   // the logout call is fire-and-forget
    expect(tokenBodies.map(b => b.grant_type)).toContain('logout');
    expect(_state.getAccessToken()).toBe(null);
    expect(storedEmail()).toBeUndefined();
    expect(driveRequests).toEqual([]);
  });

  test('a Drive request made while the question is open waits, and fails on decline', async () => {
    aboutEmail = OTHER;
    answer = null;
    const check = verifyDriveIdentity();
    const upload = authFetch('https://www.googleapis.com/upload/drive/v3/files/x?uploadType=multipart',
      { method: 'PATCH', body: '{}' });
    upload.catch(() => {});
    await new Promise(r => setTimeout(r, 20));
    expect(pendingDialog).not.toBe(null);
    expect(driveRequests).toEqual([]);
    pendingDialog.onCancel();
    await check;
    await expect(upload).rejects.toThrow(/paused/);
    expect(driveRequests).toEqual([]);
  });

  test('a Drive request made while the question is open goes through once accepted', async () => {
    aboutEmail = OTHER;
    answer = null;
    const check = verifyDriveIdentity();
    const req = authFetch('https://www.googleapis.com/drive/v3/files?q=x');
    await new Promise(r => setTimeout(r, 20));
    expect(driveRequests).toEqual([]);
    pendingDialog.onConfirm();
    await check;
    await req;
    expect(driveRequests).toEqual(['GET /drive/v3/files']);
  });

  describe('session start ordering', () => {
    const realInit = sandboxGlobal.initDriveSync;
    let initCalls;
    beforeEach(() => {
      initCalls = 0;
      sandboxGlobal.initDriveSync = () => { initCalls++; return Promise.resolve(); };
    });
    afterEach(() => { sandboxGlobal.initDriveSync = realInit; });

    test('a silent session into another account asks before the seed, and a decline never seeds', async () => {
      aboutEmail = OTHER;
      answer = 'cancel';
      await _state.startDriveSessionReal();
      await new Promise(r => setTimeout(r, 10));
      expect(asked).not.toBe(null);
      expect(initCalls).toBe(0);
      expect(driveRequests).toEqual([]);
      expect(tokenBodies.map(b => b.grant_type)).toEqual(['logout']);
    });

    test('an interactive sign-in into another account keeps today\'s behaviour: no question', async () => {
      aboutEmail = OTHER;
      _state.setInteractiveSignIn(true);
      await _state.startDriveSessionReal();
      expect(asked).toBe(null);
      expect(initCalls).toBe(1);
      expect(storedEmail()).toBe(OTHER);
    });
  });
});
