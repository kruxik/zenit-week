import { hexToHsv, hsvToHex } from './setup.js';

describe('Color Picker: hsvToHex / hexToHsv', () => {
  test('pure red round-trips', () => {
    const hex = hsvToHex(0, 100, 100);
    expect(hex).toBe('#ff0000');
    const hsv = hexToHsv(hex);
    expect(hsv.h).toBeCloseTo(0, 0);
    expect(hsv.s).toBeCloseTo(100, 0);
    expect(hsv.v).toBeCloseTo(100, 0);
  });

  test('pure green round-trips', () => {
    const hex = hsvToHex(120, 100, 100);
    expect(hex).toBe('#00ff00');
    const hsv = hexToHsv(hex);
    expect(hsv.h).toBeCloseTo(120, 0);
    expect(hsv.s).toBeCloseTo(100, 0);
    expect(hsv.v).toBeCloseTo(100, 0);
  });

  test('pure blue round-trips', () => {
    const hex = hsvToHex(240, 100, 100);
    expect(hex).toBe('#0000ff');
    const hsv = hexToHsv(hex);
    expect(hsv.h).toBeCloseTo(240, 0);
    expect(hsv.s).toBeCloseTo(100, 0);
    expect(hsv.v).toBeCloseTo(100, 0);
  });

  test('black (v=0)', () => {
    const hex = hsvToHex(0, 0, 0);
    expect(hex).toBe('#000000');
    const hsv = hexToHsv(hex);
    expect(hsv.v).toBeCloseTo(0, 0);
    expect(hsv.s).toBeCloseTo(0, 0);
  });

  test('white (s=0, v=100)', () => {
    const hex = hsvToHex(0, 0, 100);
    expect(hex).toBe('#ffffff');
    const hsv = hexToHsv(hex);
    expect(hsv.s).toBeCloseTo(0, 0);
    expect(hsv.v).toBeCloseTo(100, 0);
  });

  test('mid-gray (s=0, v=50)', () => {
    const hex = hsvToHex(0, 0, 50);
    expect(hex).toBe('#808080');
    const hsv = hexToHsv(hex);
    expect(hsv.s).toBeCloseTo(0, 0);
    expect(hsv.v).toBeCloseTo(50, 0);
  });

  test('yellow hue (h=60)', () => {
    const hex = hsvToHex(60, 100, 100);
    expect(hex).toBe('#ffff00');
  });

  test('cyan hue (h=180)', () => {
    const hex = hsvToHex(180, 100, 100);
    expect(hex).toBe('#00ffff');
  });

  test('magenta hue (h=300)', () => {
    const hex = hsvToHex(300, 100, 100);
    expect(hex).toBe('#ff00ff');
  });

  test('arbitrary color round-trips within rounding tolerance', () => {
    const h = 217, s = 63, v = 78;
    const hex = hsvToHex(h, s, v);
    const back = hexToHsv(hex);
    expect(back.h).toBeCloseTo(h, 0);
    expect(back.s).toBeCloseTo(s, 0);
    expect(back.v).toBeCloseTo(v, 0);
  });

  test('hexToHsv handles uppercase and lowercase', () => {
    const upper = hexToHsv('#FF8800');
    const lower = hexToHsv('#ff8800');
    expect(upper.h).toBeCloseTo(lower.h, 5);
    expect(upper.s).toBeCloseTo(lower.s, 5);
    expect(upper.v).toBeCloseTo(lower.v, 5);
  });

  test('all six hue sectors produce valid hex', () => {
    const hues = [15, 75, 135, 195, 255, 315];
    for (const h of hues) {
      const hex = hsvToHex(h, 80, 90);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      const back = hexToHsv(hex);
      expect(back.h).toBeCloseTo(h, 0);
    }
  });
});
