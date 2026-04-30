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

    // In fixed vertical zig-zag layout, centers are spaced by 22px (half of 32+12)
    const expectedVStep = (32 + 12) / 2;
    expect(positions['d2'].y - positions['d1'].y).toBeCloseTo(expectedVStep, 1);
    expect(positions['d3'].y - positions['d2'].y).toBeCloseTo(expectedVStep, 1);
    
    // Check horizontal stagger: staggerX = (maxW1 + maxW2) / 2 + Gap
    // Since all are Mo/Tu/We circles (width 48.1), staggerX = 48.1 + 12 = 60.1
    expect(Math.abs(positions['d2'].x - positions['d1'].x)).toBeCloseTo(60.1, 1);
  });

  test('oval node in first column expands horizontal stagger but keeps vertical spacing', () => {
    const data = {
      nodes: [
        { id: 'center', type: 'center', label: 'Week', children: ['b1'] },
        { id: 'b1', type: 'branch', parent: 'center', label: 'Work', side: 'right', children: ['a1'] },
        mkActivity('a1', 'b1', 'b1', { children: ['d1', 'd2', 'd3'] }),
        mkActivity('d1', 'a1', 'b1', { label: 'Mo', dayChild: true, priority: 'critical' }), // This is an OVAL in Col 1
        mkActivity('d2', 'a1', 'b1', { label: 'Tu', dayChild: true }),
        mkActivity('d3', 'a1', 'b1', { label: 'We', dayChild: true }),
      ]
    };
    _state.set(data);
    rebuildNodeMap();

    const positions = computeLayout();
    
    // Check vertical spacing: still 22px
    expect(positions['d2'].y - positions['d1'].y).toBeCloseTo(22, 1);
    
    // Horizontal stagger: (maxW1 + maxW2)/2 + 12
    // maxW1 is d1 (oval, width 86)
    // maxW2 is d2 (circle, width 48.1)
    // expectedStaggerX = (86 + 48.1)/2 + 12 = 67.05 + 12 = 79.05
    expect(Math.abs(positions['d2'].x - positions['d1'].x)).toBeCloseTo(79.05, 1);
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

  test('zig-zag is disabled when autoLayout is false', () => {
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
    _state.setAutoLayout(false);

    const positions = computeLayout();

    // Should be standard vertical layout: same x
    expect(positions['d1'].x).toBe(positions['d2'].x);
    expect(positions['d1'].x).toBe(positions['d3'].x);
    
    // Cleanup for other tests
    _state.setAutoLayout(true);
  });
});
