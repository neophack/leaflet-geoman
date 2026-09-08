// @vitest-environment jsdom
/**
 * Edit.Rectangle#_initMarkers() replaced this._markerGroup with a new
 * L.FeatureGroup without first removing the previous one from the map
 * (unlike Edit.Line/Edit.CircleMarker, which call removeFrom(map) first).
 * Every call site that re-inits markers on an already-enabled layer
 * (Undo.js, Scaling.js#cancel) therefore leaked an empty, still-attached
 * FeatureGroup into the map on every call.
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

describe('Edit.Rectangle _initMarkers marker-group cleanup', () => {
  it('removes the previous marker group from the map when re-initializing markers on an already-enabled rectangle', () => {
    const layer = L.rectangle([
      [52.5, 13.3],
      [52.55, 13.5],
    ]).addTo(map);
    layer.pm.enable();

    const firstGroup = layer.pm._markerGroup;
    expect(map.hasLayer(firstGroup)).toBe(true);

    // simulate what Undo.js / Scaling.js#cancel do on an already-enabled layer
    layer.pm._initMarkers();

    const secondGroup = layer.pm._markerGroup;
    expect(secondGroup).not.toBe(firstGroup);
    expect(map.hasLayer(firstGroup)).toBe(false);
    expect(map.hasLayer(secondGroup)).toBe(true);
  });
});
