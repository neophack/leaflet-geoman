// @vitest-environment jsdom
/**
 * Snap to 90° while drawing (issue #559).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import L from 'leaflet';

let map;

beforeAll(async () => {
  globalThis.L = L;
  await import('../L.PM.js');
});

afterAll(() => {
  if (map) map.remove();
});

beforeEach(() => {
  if (map) map.remove();
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', {
    value: 800,
    configurable: true,
  });
  Object.defineProperty(container, 'clientHeight', {
    value: 600,
    configurable: true,
  });
  document.body.appendChild(container);
  map = L.map(container, { center: [52.52, 13.4], zoom: 14 });
  map.pm.setGlobalOptions({ snappable: false });
});

describe('snapTo90', () => {
  it('snaps a near-90-degree segment to exactly 90 degrees', () => {
    map.pm.setGlobalOptions({ snapTo90: true });
    map.pm.Draw.Line.enable();
    const draw = map.pm.Draw.Line;

    // first vertex
    draw._hintMarker.setLatLng([52.5, 13.4]);
    draw._createVertex({ latlng: [52.5, 13.4] });

    // move the cursor ~0.35 degrees (from north) instead of 0
    draw._syncHintMarker({ latlng: [52.5199, 13.4002] });

    const hint = draw._hintMarker.getLatLng();
    // snapped: the segment is now exactly vertical (same lng)
    expect(hint.lng).toBeCloseTo(13.4, 6);
    // the distance to the last vertex is kept (~0.02 lat)
    expect(hint.lat).toBeGreaterThan(52.51);
    draw.disable();
  });

  it('does not snap when the angle is far from 90 degrees', () => {
    map.pm.setGlobalOptions({ snapTo90: true });
    map.pm.Draw.Line.enable();
    const draw = map.pm.Draw.Line;

    draw._hintMarker.setLatLng([52.5, 13.4]);
    draw._createVertex({ latlng: [52.5, 13.4] });

    // 45 degrees
    draw._syncHintMarker({ latlng: [52.51, 13.41] });
    const hint = draw._hintMarker.getLatLng();
    expect(hint.lng).toBeCloseTo(13.41, 6);
    expect(hint.lat).toBeCloseTo(52.51, 6);
    draw.disable();
  });

  it('is disabled by default', () => {
    map.pm.Draw.Line.enable();
    const draw = map.pm.Draw.Line;

    draw._hintMarker.setLatLng([52.5, 13.4]);
    draw._createVertex({ latlng: [52.5, 13.4] });

    draw._syncHintMarker({ latlng: [52.5099, 13.4018] });
    const hint = draw._hintMarker.getLatLng();
    expect(hint.lng).toBeCloseTo(13.4018, 6);
    expect(hint.lat).toBeCloseTo(52.5099, 6);
    draw.disable();
  });

  it('respects a custom tolerance', () => {
    map.pm.setGlobalOptions({ snapTo90: true, snapTo90Tolerance: 1 });
    map.pm.Draw.Line.enable();
    const draw = map.pm.Draw.Line;

    draw._hintMarker.setLatLng([52.5, 13.4]);
    draw._createVertex({ latlng: [52.5, 13.4] });

    // ~2 degrees off north -> outside the 1 degree tolerance
    draw._syncHintMarker({ latlng: [52.505, 13.4003] });
    const hint = draw._hintMarker.getLatLng();
    expect(hint.lng).toBeCloseTo(13.4003, 6);
    draw.disable();
  });

  it('works while drawing polygons too', () => {
    map.pm.setGlobalOptions({ snapTo90: true });
    map.pm.Draw.Polygon.enable();
    const draw = map.pm.Draw.Polygon;

    [
      [52.5, 13.4],
      [52.52, 13.4],
    ].forEach((latlng) => {
      draw._hintMarker.setLatLng(latlng);
      draw._createVertex({ latlng });
    });

    // cursor nearly straight west from the last vertex (near 270°)
    draw._syncHintMarker({ latlng: [52.5198, 13.38] });
    const hint = draw._hintMarker.getLatLng();
    // snapped: same lat as the last vertex
    expect(hint.lat).toBeCloseTo(52.52, 6);
    draw.disable();
  });
});
