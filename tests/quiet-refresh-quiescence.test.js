import { describe, it, expect } from 'vitest';
import { isAppQuiescent } from './setup.js';

function allClearState(overrides = {}) {
  return {
    hasEditingNode:   false,
    isPanning:        false,
    atomicOpsDepth:   0,
    pendingUploadCount: 0,
    openPanel:        null,
    ...overrides,
  };
}

describe('isAppQuiescent', () => {
  it('returns quiescent=true when every blocker is clear', () => {
    expect(isAppQuiescent(allClearState())).toEqual({ quiescent: true, reason: null });
  });

  it('defers when a node is being edited', () => {
    expect(isAppQuiescent(allClearState({ hasEditingNode: true })))
      .toEqual({ quiescent: false, reason: 'editing' });
  });

  it('defers while panning', () => {
    expect(isAppQuiescent(allClearState({ isPanning: true })))
      .toEqual({ quiescent: false, reason: 'panning' });
  });

  it('defers while an atomic op is active', () => {
    expect(isAppQuiescent(allClearState({ atomicOpsDepth: 1 })))
      .toEqual({ quiescent: false, reason: 'atomic-op' });
    expect(isAppQuiescent(allClearState({ atomicOpsDepth: 3 })))
      .toEqual({ quiescent: false, reason: 'atomic-op' });
  });

  it('defers while a Drive upload is pending', () => {
    expect(isAppQuiescent(allClearState({ pendingUploadCount: 1 })))
      .toEqual({ quiescent: false, reason: 'pending-upload' });
  });

  it('defers while a panel is open and reports the panel id', () => {
    expect(isAppQuiescent(allClearState({ openPanel: 'help-panel' })))
      .toEqual({ quiescent: false, reason: 'panel:help-panel' });
    expect(isAppQuiescent(allClearState({ openPanel: 'app-confirm-overlay' })))
      .toEqual({ quiescent: false, reason: 'panel:app-confirm-overlay' });
  });

  it('reports edit before pan when both are true (deterministic order)', () => {
    const r = isAppQuiescent(allClearState({ hasEditingNode: true, isPanning: true }));
    expect(r.reason).toBe('editing');
  });

  it('reports atomic-op before pending-upload when both are true', () => {
    const r = isAppQuiescent(allClearState({
      atomicOpsDepth: 1,
      pendingUploadCount: 1,
    }));
    expect(r.reason).toBe('atomic-op');
  });

  it('treats atomicOpsDepth of 0 as clear', () => {
    expect(isAppQuiescent(allClearState({ atomicOpsDepth: 0 })).quiescent).toBe(true);
  });

  it('treats zero pendingUploadCount as clear', () => {
    expect(isAppQuiescent(allClearState({ pendingUploadCount: 0 })).quiescent).toBe(true);
  });
});
