import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { sandboxGlobal } from './setup.js';

// A merge that produced content Drive lacks has to be pushed. Who pushes it
// depends on who pulled: a poll-driven merge arms the debounce, but a merge
// made inside syncWeekToDrive is followed immediately by that function's own
// upload, and arming the debounce there buys nothing but a second, empty
// pull-merge round trip ten seconds later.
describe('merge → push handoff', () => {
  const WK = '2030-10';
  let scheduled;
  let originalSchedule;

  const commit = (scheduleUpload, callerWillPush) => {
    const data = { nodes: [], tombstones: [], crdtVersion: 1 };
    return sandboxGlobal._commitRemoteMerge(
      WK, data, JSON.stringify(data), 123, scheduleUpload, callerWillPush);
  };

  beforeEach(() => {
    scheduled = [];
    originalSchedule = sandboxGlobal.scheduleDriveSync;
    sandboxGlobal.scheduleDriveSync = (wk) => { scheduled.push(wk); };
  });

  afterEach(() => { sandboxGlobal.scheduleDriveSync = originalSchedule; });

  test('a poll-driven merge schedules the push itself', async () => {
    await commit(true, false);
    expect(scheduled).toEqual([WK]);
  });

  test('a merge inside a push leaves the upload to its caller', async () => {
    await commit(true, true);
    expect(scheduled).toEqual([]);
  });

  test('a merge that matches Drive pushes nothing either way', async () => {
    await commit(false, false);
    await commit(false, true);
    expect(scheduled).toEqual([]);
  });
});
