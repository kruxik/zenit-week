import { zoomAt, recomputeZoomBounds, _state } from './setup.js';

describe('recomputeZoomBounds', () => {
  test('sets ZOOM_DEFAULT to fitZoom', () => {
    recomputeZoomBounds(0.4);
    expect(_state.getZoomBounds().ZOOM_DEFAULT).toBeCloseTo(0.4, 5);
  });

  test('ZOOM_MIN is 30% of ZOOM_DEFAULT', () => {
    recomputeZoomBounds(0.5);
    const { ZOOM_MIN, ZOOM_DEFAULT } = _state.getZoomBounds();
    expect(ZOOM_MIN).toBeCloseTo(ZOOM_DEFAULT * 0.3, 5);
  });

  test('ZOOM_MAX is at least ZOOM_MAX_BASE (1.8 on desktop)', () => {
    recomputeZoomBounds(0.3);
    expect(_state.getZoomBounds().ZOOM_MAX).toBeGreaterThanOrEqual(1.8);
  });

  test('ZOOM_MAX grows with large fitZoom', () => {
    recomputeZoomBounds(2.0);
    expect(_state.getZoomBounds().ZOOM_MAX).toBeCloseTo(4.0, 5);
  });

  test('very small fitZoom clamps to ZOOM_MIN_FLOOR', () => {
    recomputeZoomBounds(0.001);
    const { ZOOM_DEFAULT, ZOOM_MIN } = _state.getZoomBounds();
    expect(ZOOM_DEFAULT).toBeGreaterThanOrEqual(0.02);
    expect(ZOOM_MIN).toBeGreaterThanOrEqual(0.02 * 0.3);
  });
});

describe('zoomAt', () => {
  beforeEach(() => {
    recomputeZoomBounds(0.6);
    _state.setZoom(0.6);
    _state.setPan(400, 300);
  });

  test('zoom in increases zoom level', () => {
    const before = _state.getZoom();
    zoomAt(400, 300, 1.5);
    expect(_state.getZoom()).toBeGreaterThan(before);
  });

  test('zoom out decreases zoom level', () => {
    const before = _state.getZoom();
    zoomAt(400, 300, 0.5);
    expect(_state.getZoom()).toBeLessThan(before);
  });

  test('zoom clamps to ZOOM_MAX', () => {
    zoomAt(400, 300, 100);
    const { ZOOM_MAX } = _state.getZoomBounds();
    expect(_state.getZoom()).toBeCloseTo(ZOOM_MAX, 5);
  });

  test('zoom clamps to ZOOM_MIN', () => {
    zoomAt(400, 300, 0.001);
    const { ZOOM_MIN } = _state.getZoomBounds();
    expect(_state.getZoom()).toBeCloseTo(ZOOM_MIN, 5);
  });

  test('zooming at center does not shift pan', () => {
    _state.setZoom(0.6);
    _state.setPan(0, 0);
    zoomAt(0, 0, 2.0);
    const pan = _state.getPan();
    expect(pan.x).toBeCloseTo(0, 5);
    expect(pan.y).toBeCloseTo(0, 5);
  });

  test('zooming at off-center adjusts pan to keep point fixed', () => {
    _state.setZoom(0.6);
    _state.setPan(100, 100);
    const cx = 200, cy = 200;
    zoomAt(cx, cy, 2.0);
    const pan = _state.getPan();
    // Point under cursor: worldX = (cx - panX) / zoom
    // After zoom: new panX = cx - worldX * newZoom
    // worldX = (200 - 100) / 0.6 = 166.67
    // newPanX = 200 - 166.67 * 1.2 = 0
    expect(pan.x).toBeCloseTo(0, 0);
  });

  test('factor of 1.0 does not change zoom', () => {
    const before = _state.getZoom();
    zoomAt(400, 300, 1.0);
    expect(_state.getZoom()).toBeCloseTo(before, 10);
  });
});
