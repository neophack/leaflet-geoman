// @vitest-environment jsdom
/**
 * Performance coverage for Geofencing (helpers/Geofence.js).
 *
 * `checkGeofencing` runs synchronously on every `pm:change` - i.e. on every
 * vertex-drag / whole-layer-drag mousemove - whenever a layer has
 * `preventIntersection` and/or `requireContainment` configured. For each
 * candidate fence layer it:
 *   1. converts it to GeoJSON (`toGeoJSON()`, O(vertices) of that fence)
 *   2. runs turf's `lineIntersect`/`booleanContains` against it
 * with no cheap "could these even touch?" rejection beforehand - every
 * fence pays the full cost on every single frame, even ones nowhere near
 * the shape being edited.
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

/** an `n`-vertex polygon ring (small circle-ish shape) centered at lat/lng */
function ring(lat, lng, radiusDeg, n = 40) {
  const coords = [];
  for (let i = 0; i < n; i += 1) {
    const angle = (i / n) * Math.PI * 2;
    coords.push([
      lat + Math.sin(angle) * radiusDeg,
      lng + Math.cos(angle) * radiusDeg,
    ]);
  }
  return coords;
}

/** `count` fence polygons scattered far apart, none overlapping the center */
function scatterFences(count) {
  const fences = [];
  const center = [52.52, 13.4];
  for (let i = 0; i < count; i += 1) {
    const lat = center[0] + (((i * 37) % 200) - 100) * 0.02 + 0.5;
    const lng = center[1] + (((i * 53) % 200) - 100) * 0.02 + 0.5;
    fences.push(L.polygon([ring(lat, lng, 0.01, 40)]).addTo(map));
  }
  return fences;
}

describe('geofencing performance', () => {
  it('preventIntersection: rejects many far-away fences within budget', async () => {
    const { checkGeofencing } = await import('../helpers/Geofence');

    const fences = scatterFences(5000);
    // one real, nearby (but non-intersecting) obstacle
    const nearby = L.polygon([ring(52.55, 13.45, 0.005, 60)]).addTo(map);
    fences.push(nearby);

    const checkedLayer = L.polygon([ring(52.52, 13.4, 0.001, 20)]).addTo(map);

    const frames = 60; // ~simulated drag mousemove events
    const start = performance.now();
    for (let i = 0; i < frames; i += 1) {
      checkedLayer.setLatLngs([
        ring(52.52 + i * 0.00001, 13.4 + i * 0.00001, 0.001, 20),
      ]);
      checkGeofencing(checkedLayer, { preventIntersection: fences });
    }
    const duration = performance.now() - start;

    // this is the scenario a bounding-box pre-filter targets: without it,
    // every one of the 5001 fences gets a full toGeoJSON() conversion plus a
    // turf line-intersect call on every single frame, regardless of
    // distance (~630ms in isolation before the pre-filter, ~380ms after).
    // Budget kept generous to absorb full-suite/CI CPU contention.
    expect(duration).toBeLessThan(1500);
  });

  it('requireContainment: rejects many fences that cannot possibly contain the shape', async () => {
    const { checkGeofencing } = await import('../helpers/Geofence');

    // small, far-away polygons: none of them can bbox-contain the checked
    // shape, so the exact turf containment check should never run for them
    const fences = scatterFences(3000);
    // the actual, correctly-sized boundary
    const boundary = L.polygon([ring(52.52, 13.4, 0.05, 60)]).addTo(map);
    fences.push(boundary);

    const checkedLayer = L.polygon([ring(52.52, 13.4, 0.001, 20)]).addTo(map);

    const frames = 80;
    const start = performance.now();
    for (let i = 0; i < frames; i += 1) {
      checkedLayer.setLatLngs([
        ring(52.52 + i * 0.000001, 13.4 + i * 0.000001, 0.001, 20),
      ]);
      checkGeofencing(checkedLayer, { requireContainment: fences });
    }
    const duration = performance.now() - start;

    // ~305ms in isolation before the container-bounds pre-filter, ~200ms
    // after; budget kept generous to absorb full-suite/CI CPU contention
    expect(duration).toBeLessThan(900);
  });

  it('handles a real intersection check against a large, overlapping fence within budget', async () => {
    const { checkGeofencing } = await import('../helpers/Geofence');

    // a single large fence the checked shape actually overlaps - can't be
    // bounding-box rejected, documents the unavoidable exact-check cost
    const largeFence = L.polygon([ring(52.52, 13.4, 0.02, 2000)]).addTo(map);
    const checkedLayer = L.polygon([ring(52.52, 13.4, 0.001, 20)]).addTo(map);

    const frames = 30;
    const start = performance.now();
    for (let i = 0; i < frames; i += 1) {
      checkedLayer.setLatLngs([
        ring(52.52 + i * 0.00001, 13.4 + i * 0.00001, 0.001, 20),
      ]);
      checkGeofencing(checkedLayer, { preventIntersection: [largeFence] });
    }
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(3000);
  });
});
