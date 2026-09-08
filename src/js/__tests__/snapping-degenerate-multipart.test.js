// @vitest-environment jsdom
/**
 * Snapping.js#_calcLatLngDistances threw when snapping against a
 * multi-part Polyline whose every individual part had fewer than 2 points
 * (even though the flattened total was >= 2, which is all the upstream
 * guard in _calcClosestLayers checks): no A-B segment ever gets built, so
 * `closestSegment` stayed undefined and `closestSegment[0]` crashed.
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
});

describe('Snapping against a degenerate multi-part line', () => {
  it('does not throw when every part of a multi-part Polyline has a single point', () => {
    const layer = L.polyline([[[52.5, 13.4]], [[52.51, 13.41]]]).addTo(map);
    const snapper = map.pm.Draw.Line;

    let result;
    expect(() => {
      result = snapper._calcLayerDistances(L.latLng(52.505, 13.405), layer);
    }).not.toThrow();

    expect(result.latlng).toBeTruthy();
    expect(typeof result.distance).toBe('number');
  });
});
