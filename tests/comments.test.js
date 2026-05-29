import { describe, it, expect } from 'vitest';
import { planCommentWrite } from './setup.js';

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
