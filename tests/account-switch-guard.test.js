// A token the user did not just pick an account for (silent restore, renewal,
// a 401 refresh) may speak for another Google account: the HttpOnly refresh
// cookie can be replaced from outside the page. verifyDriveIdentity holds
// every Drive request behind a gate until the account matches the stored one
// or the user confirms the switch; declining signs out without uploading.
import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { _state, sandboxGlobal, verifyDriveIdentity, authFetch, handleAuthCode } from './setup.js';

const GOOGLE_AUTH_STORAGE_KEY = 'zenit-week-google-auth';
const VICTIM = 'me@example.com';
const OTHER  = 'someone-else@example.com';

let aboutEmail;
let aboutStatus;     // HTTP status the about lookup answers with
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
    if (aboutStatus !== 200) return HttpResponse.json({ error: 'nope' }, { status: aboutStatus });
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
    aboutStatus = 200;
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

  test('no stored identity: the account is fetched and recorded, no question asked', async () => {
    _state.setLocalStorage(GOOGLE_AUTH_STORAGE_KEY, { hasSession: true });
    aboutEmail = OTHER;
    const { verdict } = await verifyDriveIdentity();
    expect(verdict).toBe('recorded');
    expect(aboutCalls).toBe(1);
    expect(asked).toBe(null);
    expect(storedEmail()).toBe(OTHER);
    expect(_state.getIdentityGate()).toBe(null);
  });

  test('no stored identity: a Drive request waits until the identity is recorded', async () => {
    _state.setLocalStorage(GOOGLE_AUTH_STORAGE_KEY, { hasSession: true });
    let emailWhenRequested;
    server.use(http.get('https://www.googleapis.com/drive/v3/files', () => {
      emailWhenRequested = storedEmail();
      driveRequests.push('GET /drive/v3/files');
      return HttpResponse.json({ files: [] });
    }));
    const check = verifyDriveIdentity();
    const req = authFetch('https://www.googleapis.com/drive/v3/files?q=x');
    await check;
    await req;
    expect(driveRequests).toEqual(['GET /drive/v3/files']);
    expect(emailWhenRequested).toBe(VICTIM);
  });

  describe('Drive will not say who the token belongs to', () => {
    const realSetTimeout = sandboxGlobal.setTimeout;
    beforeEach(() => {
      // Collapse the backoff waits so the capped attempts run in one tick each.
      sandboxGlobal.setTimeout = (fn) => realSetTimeout(fn, 0);
      aboutStatus = 403;
    });
    afterEach(() => { sandboxGlobal.setTimeout = realSetTimeout; });

    test('gives up after the capped attempts, pauses sync and keeps the session', async () => {
      _state.setSyncStatus('connected');
      const { verdict } = await verifyDriveIdentity();
      expect(verdict).toBe('unverified');
      expect(aboutCalls).toBe(4);
      expect(asked).toBe(null);
      expect(_state.getIdentityGate().settled).toBe(true);
      expect(_state.getIdentityGate().ok).toBe(false);
      expect(storedEmail()).toBe(VICTIM);
      expect(_state.getAccessToken()).toBe('token_from_cookie');
      expect(tokenBodies).toEqual([]);
      expect(_state.getSyncStatus()).toBe('error');
      expect(_state.hasRefreshRetryPending()).toBe(true);
    });

    test('a waiter is released (rejected) when it gives up, and nothing uploads', async () => {
      const check = verifyDriveIdentity();
      const upload = authFetch('https://www.googleapis.com/upload/drive/v3/files/x?uploadType=multipart',
        { method: 'PATCH', body: '{}' });
      upload.catch(() => {});
      await check;
      await expect(upload).rejects.toThrow(/paused/);
      const late = authFetch('https://www.googleapis.com/drive/v3/files?q=x');
      late.catch(() => {});
      await expect(late).rejects.toThrow(/paused/);
      expect(driveRequests).toEqual([]);
    });

    test('the next check (reconnect) runs again and reopens sync', async () => {
      await verifyDriveIdentity();
      aboutStatus = 200;
      const { verdict } = await verifyDriveIdentity();
      expect(verdict).toBe('same');
      expect(_state.getIdentityGate()).toBe(null);
      await authFetch('https://www.googleapis.com/drive/v3/files?q=x');
      expect(driveRequests).toEqual(['GET /drive/v3/files']);
    });
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

    test('a silent session with no stored identity records it before the seed', async () => {
      _state.setLocalStorage(GOOGLE_AUTH_STORAGE_KEY, { hasSession: true });
      let emailAtSeed;
      sandboxGlobal.initDriveSync = () => { initCalls++; emailAtSeed = storedEmail(); return Promise.resolve(); };
      await _state.startDriveSessionReal();
      expect(asked).toBe(null);
      expect(initCalls).toBe(1);
      expect(emailAtSeed).toBe(VICTIM);
    });

    test('a silent session that cannot verify never seeds and can start again', async () => {
      const realSetTimeout = sandboxGlobal.setTimeout;
      sandboxGlobal.setTimeout = (fn) => realSetTimeout(fn, 0);
      aboutStatus = 503;
      try {
        await _state.startDriveSessionReal();
      } finally {
        sandboxGlobal.setTimeout = realSetTimeout;
      }
      expect(initCalls).toBe(0);
      expect(driveRequests).toEqual([]);
      expect(_state.getDriveSessionStarted()).toBe(false);
      expect(storedEmail()).toBe(VICTIM);
    });

    test('a decline that keeps the session (about 401s) lets the next token start it afresh', async () => {
      aboutStatus = 401;
      _state.setDriveSessionStarted(true);
      await _state.startDriveSessionReal();
      expect(initCalls).toBe(0);
      expect(_state.getAccessToken()).toBe('token_from_cookie');
      expect(_state.getIdentityGate().ok).toBe(false);
      expect(_state.getDriveSessionStarted()).toBe(false);
    });

    test('a decline that signs out leaves the session flag to signOut, not started', async () => {
      aboutEmail = OTHER;
      answer = 'cancel';
      _state.setDriveSessionStarted(true);
      await _state.startDriveSessionReal();
      expect(_state.getAccessToken()).toBe(null);
      expect(_state.getDriveSessionStarted()).toBe(false);
      expect(initCalls).toBe(0);
    });

    test('a check released by an interactive sign-in does not reset the live session', async () => {
      aboutEmail = OTHER;
      answer = null;
      _state.setDriveSessionStarted(true);
      const session = _state.startDriveSessionReal();
      await new Promise(r => setTimeout(r, 20));
      expect(pendingDialog).not.toBe(null);
      _state.getIdentityGate().settle(true);   // what handleAuthCode does
      pendingDialog.onConfirm();
      await session;
      expect(_state.getDriveSessionStarted()).toBe(true);
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

  test('an interactive sign-in releases a request still waiting on an open check', async () => {
    aboutEmail = OTHER;
    answer = null;
    const check = verifyDriveIdentity();
    const req = authFetch('https://www.googleapis.com/drive/v3/files?q=x');
    await new Promise(r => setTimeout(r, 20));
    expect(pendingDialog).not.toBe(null);
    sandboxGlobal.sessionStorage.setItem(_state.pkceSessionKey,
      JSON.stringify({ verifier: 'v', redirectUri: 'http://localhost/', state: 's' }));
    await handleAuthCode({ code: 'c', state: 's' });
    await req;
    expect(driveRequests).toEqual(['GET /drive/v3/files']);
    expect(_state.getIdentityGate()).toBe(null);
    pendingDialog.onConfirm();
    expect((await check).verdict).toBe('declined');
  });
  describe('poll and cached file ids around the identity check', () => {
    const realStop = sandboxGlobal.stopDrivePoll;
    const realStart = sandboxGlobal.startDrivePoll;
    const realSetTimeout = sandboxGlobal.setTimeout;
    let polls;   // 'start' / 'stop', in order
    beforeEach(() => {
      polls = [];
      sandboxGlobal.stopDrivePoll = () => { polls.push('stop'); };
      sandboxGlobal.startDrivePoll = () => { polls.push('start'); };
    });
    afterEach(() => {
      sandboxGlobal.stopDrivePoll = realStop;
      sandboxGlobal.startDrivePoll = realStart;
      sandboxGlobal.setTimeout = realSetTimeout;
    });

    test('an unverified check stops the poll, and a later passing renewal restarts it once', async () => {
      sandboxGlobal.setTimeout = (fn) => realSetTimeout(fn, 0);
      aboutStatus = 403;
      expect((await verifyDriveIdentity()).verdict).toBe('unverified');
      expect(polls).toEqual(['stop']);
      aboutStatus = 200;
      await _state.verifyRenewedIdentity();
      expect(polls).toEqual(['stop', 'start']);
    });

    test('a renewal that stays unverified does not restart the poll', async () => {
      sandboxGlobal.setTimeout = (fn) => realSetTimeout(fn, 0);
      aboutStatus = 403;
      await _state.verifyRenewedIdentity();
      expect(polls).toEqual(['stop']);
    });

    test('a recorded identity loads the cached Drive file ids for that account', async () => {
      _state.setLocalStorage('zenit-week-drive-file-ids', { email: OTHER, ids: { '2026-14': 'file-abc' } });
      _state.setLocalStorage(GOOGLE_AUTH_STORAGE_KEY, { hasSession: true });
      aboutEmail = OTHER;
      expect((await verifyDriveIdentity()).verdict).toBe('recorded');
      expect(_state.getDriveFileId('2026-14')).toBe('file-abc');
    });

    test('a recorded identity does not load ids cached for another account', async () => {
      _state.setLocalStorage('zenit-week-drive-file-ids', { email: VICTIM, ids: { '2026-14': 'file-abc' } });
      _state.setLocalStorage(GOOGLE_AUTH_STORAGE_KEY, { hasSession: true });
      aboutEmail = OTHER;
      await verifyDriveIdentity();
      expect(_state.getDriveFileId('2026-14')).toBe(null);
    });
  });
});
