import { describe, test, expect, beforeEach } from 'vitest';
import { _state, computeLayout, rebuildNodeMap, getNodeSize } from './setup.js';

describe('Zig-Zag Layout', () => {
  beforeEach(() => {
    _state.reset();
  });

  function mkActivity(id, parentId, branchId, props = {}) {
    return {
      id,
      type: 'activity',
      parent: parentId,
      branch: branchId,
      label: 'Node',
      children: [],
      ...props
    };
  }

  test('3+ day-children triggers zig-zag layout', () => {
    const data = {
      nodes: [
        { id: 'center', type: 'center', label: 'Week', children: ['b1'] },
        { id: 'b1', type: 'branch', parent: 'center', label: 'Work', side: 'right', children: ['a1'] },
        mkActivity('a1', 'b1', 'b1', { children: ['d1', 'd2', 'd3'] }),
        mkActivity('d1', 'a1', 'b1', { label: 'Mo', dayChild: true }),
        mkActivity('d2', 'a1', 'b1', { label: 'Tu', dayChild: true }),
        mkActivity('d3', 'a1', 'b1', { label: 'We', dayChild: true }),
      ]
    };
    _state.set(data);
    rebuildNodeMap();

    const positions = computeLayout();

    // In vertical zig-zag layout, every node has a different y
    // x alternates between base and base + staggerX
    
    expect(positions['d1'].x).not.toBe(positions['d2'].x);
    expect(positions['d1'].x).toBe(positions['d3'].x); // d1 and d3 are in the same column
    
    // Vertical shift: d2 should be exactly 50% height lower than d1
    // (In our implementation, currentY moves by H/2, and y is currentY + H/2)
    // d1: y = start + H/2
    // d2: y = (start + H/2) + H/2 = start + H
    // So y2 - y1 = H/2
    const { h: nodeH } = getNodeSize('d1');
    const VERTICAL_GAP = 12;
    const totalH = nodeH + VERTICAL_GAP;
    
    // Check horizontal stagger: staggerX = totalH * 0.866
    const expectedStaggerX = totalH * 0.866;
    expect(Math.abs(positions['d2'].x - positions['d1'].x)).toBeCloseTo(expectedStaggerX, 1);
    
    expect(positions['d2'].y - positions['d1'].y).toBeCloseTo(totalH / 2, 1);
    expect(positions['d3'].y - positions['d2'].y).toBeCloseTo(totalH / 2, 1);
    
    // Verify distance between d1 and d2 is exactly totalH (hexagonal packing)
    const dx = positions['d2'].x - positions['d1'].x;
    const dy = positions['d2'].y - positions['d1'].y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    expect(dist).toBeCloseTo(totalH, 1);
  });

  test('2 day-children uses standard vertical layout', () => {
    const data = {
      nodes: [
        { id: 'center', type: 'center', label: 'Week', children: ['b1'] },
        { id: 'b1', type: 'branch', parent: 'center', label: 'Work', side: 'right', children: ['a1'] },
        mkActivity('a1', 'b1', 'b1', { children: ['d1', 'd2'] }),
        mkActivity('d1', 'a1', 'b1', { label: 'Mo', dayChild: true }),
        mkActivity('d2', 'a1', 'b1', { label: 'Tu', dayChild: true }),
      ]
    };
    _state.set(data);
    rebuildNodeMap();

    const positions = computeLayout();

    // Standard layout: same x, different y
    expect(positions['d1'].x).toBe(positions['d2'].x);
    expect(positions['d2'].y).toBeGreaterThan(positions['d1'].y);
  });
});
