import { describe, it, expect } from 'vitest';
import { isDevResetAllowed } from './setup.js';

// The dev reset wipes everything, so the host guard is the only thing standing
// between it and a real user's week. Production must stay shut whatever it is
// asked, including hosts that merely look like development ones.
describe('dev reset guard', () => {
  it('opens on a development host', () => {
    expect(isDevResetAllowed('localhost', 'http:')).toBe(true);
    expect(isDevResetAllowed('127.0.0.1', 'http:')).toBe(true);
    expect(isDevResetAllowed('macbook.local', 'http:')).toBe(true);
    expect(isDevResetAllowed('nemesis-enlarged-quaintly.ngrok-free.dev', 'https:')).toBe(true);
    expect(isDevResetAllowed('', 'file:')).toBe(true);
  });

  it('stays shut on production', () => {
    expect(isDevResetAllowed('zenitweek.com', 'https:')).toBe(false);
    expect(isDevResetAllowed('www.zenitweek.com', 'https:')).toBe(false);
    expect(isDevResetAllowed('zenit-week-git-main.vercel.app', 'https:')).toBe(false);
    expect(isDevResetAllowed('ZenitWeek.com', 'https:')).toBe(false);
  });

  it('stays shut on any host outside the allowlist', () => {
    expect(isDevResetAllowed('example.com', 'https:')).toBe(false);
    expect(isDevResetAllowed('notlocalhost', 'http:')).toBe(false);
    // Lookalikes that merely contain a dev host name must not pass.
    expect(isDevResetAllowed('localhost.evil.com', 'https:')).toBe(false);
    expect(isDevResetAllowed('ngrok-free.dev.evil.com', 'https:')).toBe(false);
    expect(isDevResetAllowed('local', 'https:')).toBe(false);
  });
});
