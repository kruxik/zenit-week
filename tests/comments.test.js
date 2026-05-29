import { describe, it, expect } from 'vitest';
import { planCommentWrite, validateAndRepair, mergeWeekData, defaultWeekData } from './setup.js';

// Build a valid tree (center + branches) with one activity under "work".
function treeWithActivity(activityProps = {}) {
  const data = defaultWeekData();
  const work = data.nodes.find(n => n.id === 'work');
  const act = { id: 'a1', type: 'activity', branch: 'work', label: 'Task',
                parent: 'work', children: [], _ts: 1, ...activityProps };
  work.children.push('a1');
  data.nodes.push(act);
  return data;
}
const findById = (data, id) => data.nodes.find(n => n.id === id);

// planCommentWrite decides what a Comment-dialog close should persist.
// Returns null  => unchanged, caller skips snapshot + save (no-op close).
// Returns ''    => clear an existing comment.
// Returns string => new/edited comment text.
describe('planCommentWrite (node comments dirty-check)', () => {
  it('returns null when value equals the existing comment', () => {
    expect(planCommentWrite({ comments: 'hi' }, 'hi')).toBe(null);
  });

  it('returns null when both stored and value are empty', () => {
    expect(planCommentWrite({}, '')).toBe(null);
    expect(planCommentWrite({ comments: '' }, '')).toBe(null);
  });

  it('returns the new value when the text changed', () => {
    expect(planCommentWrite({ comments: 'a' }, 'b')).toBe('b');
    expect(planCommentWrite({}, 'new note')).toBe('new note');
  });

  it('returns empty string (clear) when text is removed from a commented node', () => {
    expect(planCommentWrite({ comments: 'x' }, '')).toBe('');
  });

  it('treats whitespace-only edits as a real change (no implicit trim)', () => {
    expect(planCommentWrite({ comments: 'x' }, 'x ')).toBe('x ');
  });

  it('returns null for a missing node', () => {
    expect(planCommentWrite(null, 'x')).toBe(null);
  });
});

describe('validateAndRepair — comments tolerance', () => {
  it('keeps a non-empty string comment on an activity node', () => {
    const data = validateAndRepair(treeWithActivity({ comments: 'keep me' }));
    expect(findById(data, 'a1').comments).toBe('keep me');
  });

  it('strips an empty-string comment (normalizes away)', () => {
    const data = validateAndRepair(treeWithActivity({ comments: '' }));
    expect(findById(data, 'a1').comments).toBeUndefined();
  });

  it('strips a non-string comment', () => {
    const data = validateAndRepair(treeWithActivity({ comments: 42 }));
    expect(findById(data, 'a1').comments).toBeUndefined();
  });

  it('strips comments from a branch node', () => {
    const data = treeWithActivity();
    findById(data, 'work').comments = 'nope';
    validateAndRepair(data);
    expect(findById(data, 'work').comments).toBeUndefined();
  });

  it('strips comments from a counter node', () => {
    const data = treeWithActivity();
    const counter = { id: 'c1', type: 'counter', branch: 'work', label: '',
                      parent: 'a1', children: [], val: 0, max: 3, comments: 'nope', _ts: 1 };
    findById(data, 'a1').children.push('c1');
    data.nodes.push(counter);
    validateAndRepair(data);
    expect(findById(data, 'c1').comments).toBeUndefined();
  });
});

describe('mergeWeekData — comments LWW per node', () => {
  const wrap = (act) => {
    const data = treeWithActivity(act);
    data.savedAt = act._ts || 1;
    return data;
  };

  it('keeps the higher-_ts comment when both sides have one', () => {
    const local  = wrap({ comments: 'old', _ts: 10 });
    const remote = wrap({ comments: 'new', _ts: 20 });
    const merged = mergeWeekData(local, remote);
    expect(findById(merged, 'a1').comments).toBe('new');
  });

  it('adds a comment that exists only on the newer side', () => {
    const local  = wrap({ _ts: 10 });               // no comment
    const remote = wrap({ comments: 'added', _ts: 20 });
    const merged = mergeWeekData(local, remote);
    expect(findById(merged, 'a1').comments).toBe('added');
  });

  it('clears the comment when the newer side removed it', () => {
    const local  = wrap({ comments: 'stale', _ts: 10 });
    const remote = wrap({ _ts: 20 });               // comment cleared, newer
    const merged = mergeWeekData(local, remote);
    expect(findById(merged, 'a1').comments).toBeUndefined();
  });
});
