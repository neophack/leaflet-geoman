// @vitest-environment jsdom
/**
 * Snapping.js#_calcClosestLayers tracked the "closest distance so far"
 * using the last *accepted* candidate (`closestLayer.distance`) instead of
 * the true running minimum. Depending on layer iteration order, a
 * legitimately-tied candidate (within 5px of the true minimum) could be
 * evicted from the priority-tie pool while a farther layer survived,
 * corrupting `snappingOrder` priority resolution.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
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

describe('Snapping tie-tolerance priority resolution', () => {
  it('keeps a legitimately-tied, higher-priority candidate in the pool even when a farther layer is processed in between', () => {
    // Marker (default snapping priority 1) processed first at 10px.
    const layerA = L.marker([52.5, 13.3]).addTo(map);
    // Line (lower priority) processed second, 14px away - farther than the
    // eventual true minimum by more than the 5px tie window.
    const layerB = L.polyline([
      [52.5, 13.31],
      [52.51, 13.32],
    ]).addTo(map);
    // Polygon processed last, the true closest layer at 6px - within 5px of
    // layerA (10px), so both should remain tied candidates.
    const layerC = L.polygon([
      [52.5, 13.33],
      [52.51, 13.34],
      [52.52, 13.33],
    ]).addTo(map);

    // any Draw.* instance carries the SnapMixin and already has `_map` set
    const snapper = map.pm.Draw.Line;

    vi.spyOn(snapper, '_calcLayerDistances').mockImplementation(
      (latlng, layer) => {
        if (layer === layerA) return { latlng, distance: 10 };
        if (layer === layerB) return { latlng, distance: 14 };
        if (layer === layerC) return { latlng, distance: 6 };
        throw new Error('unexpected layer');
      }
    );

    const result = snapper._calcClosestLayers(
      L.latLng(52.5, 13.3),
      [layerA, layerB, layerC],
      1
    );

    // Marker outranks Polygon by default snapping priority, and since it's
    // within the 5px tie-tolerance of the true closest layer (6px), it
    // should win over the farther-but-untied layerB and the closer-but-
    // lower-priority layerC.
    expect(result[0].layer).toBe(layerA);
  });
});
