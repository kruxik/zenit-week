import { taperedPathD } from './setup.js';

describe('taperedPathD', () => {
  test('returns a closed SVG path (M...Z)', () => {
    const d = taperedPathD(0, 0, 100, 0, 10, 4);
    expect(d).toMatch(/^M /);
    expect(d).toMatch(/ Z$/);
  });

  test('contains cubic bezier commands', () => {
    const d = taperedPathD(0, 0, 100, 0, 10, 4);
    expect(d).toContain(' C ');
    expect(d).toContain(' L ');
  });

  test('horizontal line: perpendicular offset is vertical', () => {
    const d = taperedPathD(0, 0, 100, 0, 10, 4);
    const nums = d.match(/-?[\d.]+/g).map(Number);
    // First point (M): x=0, y=+5 (half of swStart=10, perpendicular to horizontal = vertical)
    expect(nums[0]).toBeCloseTo(0, 5);
    expect(nums[1]).toBeCloseTo(5, 5);
  });

  test('vertical line: perpendicular offset is horizontal', () => {
    const d = taperedPathD(0, 0, 0, 100, 10, 4);
    const nums = d.match(/-?[\d.]+/g).map(Number);
    // For vertical chord (dx=0, dy=100): perpendicular is (-1, 0)
    // First point M: x = 0 + (-1)*5 = -5, y = 0
    expect(nums[0]).toBeCloseTo(-5, 5);
    expect(nums[1]).toBeCloseTo(0, 5);
  });

  test('uniform width (swStart === swEnd) produces symmetric shape', () => {
    const d = taperedPathD(0, 0, 200, 0, 8, 8);
    const nums = d.match(/-?[\d.]+/g).map(Number);
    // Start top y-offset = +4, end top y-offset = +4
    expect(nums[1]).toBeCloseTo(4, 5);
  });

  test('zero-length chord does not produce NaN', () => {
    const d = taperedPathD(50, 50, 50, 50, 6, 2);
    expect(d).not.toContain('NaN');
  });

  test('negative coordinates work', () => {
    const d = taperedPathD(-100, -50, 100, 50, 8, 4);
    expect(d).toMatch(/^M /);
    expect(d).toMatch(/ Z$/);
    expect(d).not.toContain('NaN');
  });

  test('path has exactly 2 cubic bezier segments and 1 line-to', () => {
    const d = taperedPathD(0, 0, 100, 0, 10, 4);
    const cCount = (d.match(/ C /g) || []).length;
    const lCount = (d.match(/ L /g) || []).length;
    expect(cCount).toBe(2);
    expect(lCount).toBe(1);
  });
});
