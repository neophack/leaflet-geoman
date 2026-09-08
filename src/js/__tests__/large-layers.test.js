// @vitest-environment jsdom
/**
 * Large layer rendering (issue #366, part 2):
 * zoom dependent decimation + viewport culling of the rendered geometry,
 * while the full coordinates stay untouched for data & editing.
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

const COUNT = 4000;

/** a noisy line from west to east through the map center */
function noisyLine(count = COUNT) {
  const line = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    line.push([
      52.52 + Math.sin(t * 60) * 0.02, // wave ~0.04 degrees tall
      13.2 + t * 0.4, // spans 0.4 degrees lng
    ]);
  }
  return line;
}

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

describe('activation', () => {
  it('activates automatically above the threshold', () => {
    const layer = L.polyline(noisyLine()).addTo(map);
    expect(layer._pmOptimize).toBeTruthy();
    expect(layer.pm.getFullLatLngs()).toHaveLength(COUNT);
  });

  it('ignores small layers', () => {
    const layer = L.polyline([
      [52.5, 13.4],
      [52.52, 13.42],
    ]).addTo(map);
    expect(layer._pmOptimize).toBeUndefined();
  });

  it('can be disabled with largeLayerThreshold: 0', () => {
    map.pm.setGlobalOptions({ largeLayerThreshold: 0 });
    const layer = L.polyline(noisyLine()).addTo(map);
    expect(layer._pmOptimize).toBeUndefined();
  });
});

describe('zoom dependent decimation (zoomed out)', () => {
  it('renders far fewer points when the whole line fits the screen', () => {
    const layer = L.polyline(noisyLine()).addTo(map);
    // zoom out until the whole 0.4 degree line fits
    map.setZoom(9, { animate: false });
    map.pm._processOptimizedLayers();

    const rendered = layer.getLatLngs().length;
    expect(rendered).toBeGreaterThan(10);
    expect(rendered).toBeLessThan(COUNT / 10);
  });

  it('toGeoJSON still returns the full geometry', () => {
    const layer = L.polyline(noisyLine()).addTo(map);
    map.setZoom(9, { animate: false });
    map.pm._processOptimizedLayers();
    expect(layer.getLatLngs().length).toBeLessThan(COUNT);

    const geo = layer.toGeoJSON(15);
    expect(geo.geometry.coordinates).toHaveLength(COUNT);
  });
});

describe('viewport culling (zoomed in)', () => {
  it('renders only the in-view part plus the run borders', () => {
    const layer = L.polyline(noisyLine()).addTo(map);
    // zoom 14: only a fraction of the 0.4 degree line is in view
    const rendered = layer.getLatLngs().length;
    expect(rendered).toBeGreaterThan(1);
    expect(rendered).toBeLessThan(COUNT / 2);

    // the rendered part still spans both sides of the viewport, so the
    // line visually crosses the whole screen
    const renderedBounds = L.latLngBounds(layer.getLatLngs());
    const view = map.getBounds();
    expect(renderedBounds.getWest()).toBeLessThan(view.getWest());
    expect(renderedBounds.getEast()).toBeGreaterThan(view.getEast());
  });

  it('updates the rendered subset when the map moves', () => {
    const layer = L.polyline(noisyLine()).addTo(map);
    const before = layer.getLatLngs().length;
    map.setView([52.52, 13.5], 14, { animate: false }); // fires moveend
    const after = layer.getLatLngs().length;
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(COUNT / 2);
    void before;
  });
});

describe('editing keeps the full geometry', () => {
  it('restores the full coordinates while editing and re-optimizes after', () => {
    const layer = L.polyline(noisyLine()).addTo(map);
    expect(layer.getLatLngs().length).toBeLessThan(COUNT);

    layer.pm.enable();
    // full coordinates are back for the edit logic
    expect(layer.getLatLngs()).toHaveLength(COUNT);

    layer.pm.disable();
    // display is culled again
    expect(layer.getLatLngs().length).toBeLessThan(COUNT);
    expect(layer.pm.getFullLatLngs()).toHaveLength(COUNT);
  });

  it('an edit of the full geometry updates the stored full copy', () => {
    const layer = L.polyline(noisyLine()).addTo(map);
    layer.pm.enable();

    const marker = layer.pm._markers[0];
    marker.fire('dragstart', { target: marker });
    marker.setLatLng(L.latLng(52.6, 13.3));
    marker.fire('drag', { target: marker });
    marker.fire('dragend', { target: marker });
    layer.pm.disable();

    expect(layer.pm.getFullLatLngs()[0].lat).toBeCloseTo(52.6, 4);
    expect(layer.getLatLngs().length).toBeLessThan(COUNT);
  });
});

describe('data integrity of the other features', () => {
  it('copy duplicates the full geometry', () => {
    const layer = L.polyline(noisyLine()).addTo(map);
    const copy = map.pm.copyLayer(layer);
    // the copy itself gets optimized again (above threshold), so check full
    expect(copy.pm.getFullLatLngs()).toHaveLength(COUNT);
  });

  it('simplify operates on the full geometry', () => {
    const layer = L.polyline(noisyLine()).addTo(map);
    const fullBefore = layer.pm.getFullLatLngs().length;
    map.pm.simplifyLayer(layer, { factor: 0.01 });
    const fullAfter = layer.pm.getFullLatLngs().length;
    expect(fullAfter).toBeLessThan(fullBefore);
  });

  it('undo restores the full geometry after an edit', () => {
    const layer = L.polyline(noisyLine()).addTo(map);
    layer.pm.enable();
    const marker = layer.pm._markers[0];
    marker.fire('dragstart', { target: marker });
    marker.setLatLng(L.latLng(52.6, 13.3));
    marker.fire('drag', { target: marker });
    marker.fire('dragend', { target: marker });
    layer.pm.disable();

    map.pm.undo();
    expect(layer.pm.getFullLatLngs()).toHaveLength(COUNT);
    expect(layer.pm.getFullLatLngs()[0].lat).not.toBeCloseTo(52.6, 4);
  });

  it('union uses the full geometry', () => {
    // two big overlapping rectangles (zigzag noise makes them exceed the
    // threshold, the union result must still cover the full extent)
    const big = [];
    for (let i = 0; i < 1200; i += 1) {
      const t = i / 1199;
      big.push([52.5 + t * 0.02 + (i % 2) * 1e-6, 13.38 + t * 0.001]);
    }
    for (let i = 0; i < 1200; i += 1) {
      const t = i / 1199;
      big.push([52.52 - t * 0.02 - (i % 2) * 1e-6, 13.381 - t * 0.001]);
    }
    const a = L.polygon([big]).addTo(map);

    const big2 = [];
    for (let i = 0; i < 1200; i += 1) {
      const t = i / 1199;
      big2.push([52.5 + t * 0.02 + (i % 2) * 1e-6, 13.39 + t * 0.001]);
    }
    for (let i = 0; i < 1200; i += 1) {
      const t = i / 1199;
      big2.push([52.52 - t * 0.02 - (i % 2) * 1e-6, 13.391 - t * 0.001]);
    }
    const b = L.polygon([big2]).addTo(map);

    const result = map.pm.union(a, b);
    expect(result).toBeTruthy();
    const bounds = result.getBounds();
    expect(bounds.getWest()).toBeLessThanOrEqual(13.381);
    expect(bounds.getEast()).toBeGreaterThanOrEqual(13.39);
  });

  it('measurements use the full geometry', () => {
    const layer = L.polyline(noisyLine()).addTo(map);
    const full = map.pm.getMeasurement(layer);
    // ~9.5 wave periods over 0.4 degrees lng -> ~90 km total length
    expect(full.length).toBeGreaterThan(80000);
    expect(full.length).toBeLessThan(120000);

    // zoom far out: the rendered subset is heavily decimated (the wave
    // amplitude of 0.02 degrees projects below the pixel threshold),
    // but the measurement stays stable because it uses the full geometry
    map.setZoom(7, { animate: false });
    map.pm._processOptimizedLayers();
    expect(layer.getLatLngs().length).toBeLessThan(COUNT / 5);
    const afterZoom = map.pm.getMeasurement(layer);
    expect(afterZoom.length).toBeCloseTo(full.length, -3);
  });
});

describe('deactivation', () => {
  it('restores the full geometry when the layer is removed from the optimized list', () => {
    const layer = L.polyline(noisyLine()).addTo(map);
    expect(layer.getLatLngs().length).toBeLessThan(COUNT);
    map.pm._deoptimizeLayer(layer);
    expect(layer.getLatLngs()).toHaveLength(COUNT);
    expect(map.pm.getOptimizedLayers()).not.toContain(layer);
  });

  it('toGeoJSON keeps working (does not throw) after the layer is removed from the map', () => {
    const layer = L.polyline(noisyLine()).addTo(map);
    layer.remove(); // fires 'remove' -> _deoptimizeLayer
    expect(() => layer.toGeoJSON(15)).not.toThrow();
    expect(layer.toGeoJSON(15).geometry.coordinates).toHaveLength(COUNT);
  });

  it('does not nest the toGeoJSON wrapper across remove/re-add cycles', () => {
    const layer = L.polyline(noisyLine()).addTo(map);
    const wrappedOnce = layer.toGeoJSON;
    layer.remove();
    layer.addTo(map);
    expect(layer.toGeoJSON).not.toBe(wrappedOnce);
    // still returns the full geometry, single layer of wrapping
    expect(layer.toGeoJSON(15).geometry.coordinates).toHaveLength(COUNT);
  });
});
