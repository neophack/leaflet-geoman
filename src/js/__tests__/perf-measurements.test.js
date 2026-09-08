// @vitest-environment jsdom
/**
 * Performance coverage for Measurements (Mixins/Measurements.js).
 *
 * While `measurements` is enabled, `_updateLayerMeasurement` runs on every
 * `pm:change` of an Edit/Rotation/Scale (i.e. every vertex-drag mousemove)
 * and recomputes the live tooltip via `calcMeasurement` ->
 * `_measurePolygon`. For every ring it did:
 *   `JSON.parse(JSON.stringify(cleaned))`
 * just to get a copy of the ring it can push a closing point onto without
 * mutating the layer's own coordinates - a much more expensive way to get
 * an unshared array than a plain `.slice()` (`_cleanRing` already returns a
 * fresh array via `.filter()`, and nothing here ever mutates an individual
 * latlng object).
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
  map.pm.setGlobalOptions({
    snappable: false,
    measurements: { measurement: true, displayFormat: 'metric', area: true },
  });
});

/** an `n`-vertex polygon ring around the map center */
function bigRing(count) {
  const ring = [];
  const center = [52.52, 13.4];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    ring.push([
      center[0] + Math.sin(angle) * 0.05,
      center[1] + Math.cos(angle) * 0.05,
    ]);
  }
  return ring;
}

describe('measurements performance', () => {
  it('recomputes the live measurement of a large polygon within budget while a vertex is dragged', () => {
    const layer = L.polygon([bigRing(6000)]).addTo(map);
    layer.pm.enable();

    const m = layer.pm._map.pm;
    expect(m._measurementsEnabled()).toBe(true);

    const frames = 40; // simulated drag mousemove events
    const start = performance.now();
    for (let i = 0; i < frames; i += 1) {
      // recomputing the measurement directly exercises the same
      // _measurePolygon() path _updateLayerMeasurement hits on every
      // pm:change while dragging a vertex, without needing a real marker
      // drag sequence
      m.calcMeasurement(layer);
    }
    const duration = performance.now() - start;

    // ~270ms in isolation before removing the redundant JSON clone and the
    // throwaway L.polygon() reconstruction, ~200ms after; budget kept
    // generous to absorb full-suite/CI CPU contention
    expect(duration).toBeLessThan(900);
  });
});
