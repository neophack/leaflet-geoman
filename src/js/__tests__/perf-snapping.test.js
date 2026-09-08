// @vitest-environment jsdom
/**
 * Performance coverage for the snapping hot path (Mixins/Snapping.js).
 *
 * `_calcClosestLayers` runs on every `drag` event of every marker being
 * dragged while `snappable` is on - i.e. many times per second while the
 * user moves the mouse. It loops through every snap-candidate layer and,
 * for polylines/polygons, every one of their vertices with no spatial
 * index at all. Two realistic scenes stress this differently:
 *
 *  - many small layers scattered across the map: most of them are nowhere
 *    near the cursor, so the useful work is a cheap "is this even close?"
 *    rejection, not a full per-vertex distance scan.
 *  - one very large layer (thousands of vertices): the per-vertex scan
 *    itself is the cost, bounding-box rejection can't skip anything.
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

/** a small square `sizeDeg` wide, centered at [lat, lng] */
function smallSquare(lat, lng, sizeDeg = 0.0005) {
  return [
    [lat - sizeDeg, lng - sizeDeg],
    [lat - sizeDeg, lng + sizeDeg],
    [lat + sizeDeg, lng + sizeDeg],
    [lat + sizeDeg, lng - sizeDeg],
  ];
}

/** `count` small polygons scattered across a wide area around the center */
function scatterPolygons(count) {
  const layers = [];
  const center = [52.52, 13.4];
  for (let i = 0; i < count; i += 1) {
    // spread across ~2 degrees lat/lng - most of these end up far (in
    // pixel terms, at the test's zoom level) from any single point
    const lat = center[0] + (((i * 37) % 200) - 100) * 0.01;
    const lng = center[1] + (((i * 53) % 200) - 100) * 0.01;
    layers.push(L.polygon([smallSquare(lat, lng)]).addTo(map));
  }
  return layers;
}

function ellipseRing(count, center, radiusLat, radiusLng) {
  const ring = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    ring.push([
      center[0] + Math.sin(angle) * radiusLat,
      center[1] + Math.cos(angle) * radiusLng,
    ]);
  }
  return ring;
}

/** runs `_calcClosestLayers` `frames` times at slightly different latlngs */
function timeClosestLayerCalc(snapper, layers, frames) {
  const start = performance.now();
  for (let i = 0; i < frames; i += 1) {
    const latlng = L.latLng(52.52 + i * 0.00001, 13.4 + i * 0.00001);
    snapper._calcClosestLayers(latlng, layers, 1);
  }
  return performance.now() - start;
}

describe('snapping performance', () => {
  it('handles many scattered small layers within budget (mostly bounding-box rejects)', () => {
    const layerCount = 3000;
    const layers = scatterPolygons(layerCount);
    // any Draw.* instance carries the SnapMixin and already has `_map` set
    const snapper = map.pm.Draw.Line;

    const frames = 150; // ~simulated mousemove events during one drag
    const duration = timeClosestLayerCalc(snapper, layers, frames);

    // this is the scenario bounding-box pre-filtering targets - without it
    // this loop does 3000 full per-vertex scans per frame (~1.7s in
    // isolation, more under full-suite CPU contention); with it almost all
    // layers are rejected in O(1) via their (cached) bounds instead of a
    // per-vertex segment-distance scan. Budget kept generous (not a tight
    // ~2x) to absorb CI/parallel-run noise.
    expect(duration).toBeLessThan(2500);
  });

  it('only runs the expensive per-vertex distance scan for layers that can plausibly be closest', () => {
    const layers = scatterPolygons(500);
    // one layer placed right next to the query point - a genuine candidate
    const near = L.polygon([smallSquare(52.52, 13.4, 0.0005)]).addTo(map);
    layers.push(near);

    const snapper = map.pm.Draw.Line;
    const spy = vi.spyOn(snapper, '_calcLayerDistances');

    snapper._calcClosestLayers(L.latLng(52.52, 13.4), layers, 1);

    // the far-away scattered layers must not each trigger a full per-vertex
    // scan - only a small fraction (the near layer, plus whatever else
    // shares its neighborhood) should reach the expensive exact path
    expect(spy.mock.calls.length).toBeLessThan(layers.length / 2);
  });

  it('handles one very large layer (6000 vertices) within budget', () => {
    const layer = L.polygon([
      ellipseRing(6000, [52.52, 13.4], 0.25, 0.02),
    ]).addTo(map);
    const snapper = map.pm.Draw.Line;

    const frames = 20;
    const duration = timeClosestLayerCalc(snapper, [layer], frames);

    // a single huge layer can't be bounding-box rejected (the cursor is
    // inside its bounds), so this documents the per-vertex-scan cost as a
    // baseline rather than asserting a specific optimization.
    expect(duration).toBeLessThan(4000);
  });

  it('full drag-triggered snapping stays responsive with many other layers on the map', () => {
    scatterPolygons(500);
    const dragged = L.polygon([smallSquare(52.55, 13.45, 0.001)]).addTo(map);
    dragged.pm.enable();

    const vertexMarker = dragged.pm._markers[0][0];
    const start = performance.now();
    for (let i = 0; i < 50; i += 1) {
      const latlng = L.latLng(52.55 + i * 0.00001, 13.45 + i * 0.00001);
      vertexMarker.setLatLng(latlng);
      vertexMarker.fire('drag', { target: vertexMarker });
    }
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(3000);
  });
});
