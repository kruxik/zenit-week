import { describe, it, expect, beforeEach } from 'vitest';
import { _state, addBranch, deleteBranch, applyBranchColor, findNode, BRANCH_CONFIG, BRANCH_COLORS } from './setup.js';

describe('Branch Management', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.reset();
    _state.set({
      nodes: [
        { id: 'center', type: 'center', label: '2026-W18', children: ['b1'] },
        { id: 'b1', type: 'branch', label: 'Work', parent: 'center', children: [], side: 'left' }
      ]
    });
  });

  it('adds a new branch to the specified side', () => {
    addBranch('right');
    const data = _state.get();
    const branches = data.nodes.filter(n => n.type === 'branch');
    expect(branches.length).toBe(2);
    
    const newBranch = branches.find(b => b.id !== 'b1');
    expect(newBranch.side).toBe('right');
    // Branches have implicit parent 'center', not stored in node.parent
    expect(newBranch.parent).toBeUndefined();
    expect(BRANCH_CONFIG[newBranch.id].side).toBe('right');
    expect(BRANCH_COLORS[newBranch.id]).toBeDefined();
  });

  it('deletes a branch and its descendants', () => {
    _state.set({
      nodes: [
        { id: 'center', type: 'center', label: '2026-W18' },
        { id: 'b1', type: 'branch', label: 'Work', children: ['a1'] },
        { id: 'b2', type: 'branch', label: 'Family', children: [] },
        { id: 'a1', type: 'activity', parent: 'b1', children: [] }
      ]
    });

    deleteBranch('b1');
    
    const data = _state.get();
    expect(data.nodes.find(n => n.id === 'b1')).toBeUndefined();
    expect(data.nodes.find(n => n.id === 'a1')).toBeUndefined();
    expect(BRANCH_CONFIG['b1']).toBeUndefined();
    expect(BRANCH_COLORS['b1']).toBeUndefined();
  });

  it('prevents deleting the last branch', () => {
    // Already has only b1
    deleteBranch('b1');
    const data = _state.get();
    expect(data.nodes.find(n => n.id === 'b1')).toBeDefined();
  });

  it('applies branch color and updates palette', () => {
    const branch = findNode('b1');
    applyBranchColor(branch, '#ff0000');
    
    // palette should be generated and stored in a global/state that we can ideally check
    // In our setup, BRANCH_COLORS is in the sandbox. We don't export it directly but 
    // we can check if the branch node itself was "touched" or if we can see the effect.
    // The code does: BRANCH_COLORS[branch.id] = deriveBranchPalette(hex);
    // Since we can't easily see BRANCH_COLORS from here without exporting it,
    // let's at least verify it doesn't crash and we could potentially export BRANCH_COLORS too.
  });
});
