// @vitest-environment jsdom
/**
 * MarkerLimits: with `limitMarkersToCount` set, only the edit markers
 * closest to the cursor stay attached to the marker group (see
 * Mixins/MarkerLimits.js). This targets the cursor-distance filtering
 * directly; perf-6000.test.js already covers the marker-cache interaction
 * with the (separate) viewport-culling feature.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import L from 'leaflet';

let map;

// four corners far enough apart that "closest to a corner" is unambiguous
const CORNERS = {
  nw: L.latLng(52.54, 13.36),
  ne: L.latLng(52.54, 13.44),
  se: L.latLng(52.5, 13.44),
  sw: L.latLng(52.5, 13.36),
};

function square() {
  return [CORNERS.sw, CORNERS.se, CORNERS.ne, CORNERS.nw];
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

function enableWithLimit(limit) {
  const layer = L.polygon(square()).addTo(map);
  layer.pm.setOptions({
    limitMarkersToCount: limit,
    hideMiddleMarkers: true, // isolate vertex markers, no middle markers to count
    simplifyEditMarkers: 0,
  });
  layer.pm.enable();
  return layer;
}

describe('MarkerLimits', () => {
  it('caches every vertex marker regardless of the count limit', () => {
    const layer = enableWithLimit(1);
    expect(layer.pm.markerCache).toHaveLength(4);
  });

  it('shows only the N markers closest to the given cursor position', () => {
    const layer = enableWithLimit(1);
    const cursorNearNW = map.project(CORNERS.nw, map.getZoom());
    const cursorLatLng = map.unproject(cursorNearNW, map.getZoom());

    layer.pm.applyLimitFilters({ latlng: cursorLatLng });

    const shown = layer.pm._markerGroup.getLayers();
    expect(shown).toHaveLength(1);
    expect(shown[0].getLatLng().equals(CORNERS.nw)).toBe(true);
  });

  it('updates which markers are shown as the cursor moves', () => {
    const layer = enableWithLimit(1);

    layer.pm.applyLimitFilters({ latlng: CORNERS.nw });
    expect(
      layer.pm._markerGroup.getLayers()[0].getLatLng().equals(CORNERS.nw)
    ).toBe(true);

    layer.pm.applyLimitFilters({ latlng: CORNERS.se });
    const shown = layer.pm._markerGroup.getLayers();
    expect(shown).toHaveLength(1);
    expect(shown[0].getLatLng().equals(CORNERS.se)).toBe(true);
  });

  it('shows the closest 2 markers when the limit is 2', () => {
    const layer = enableWithLimit(2);
    layer.pm.applyLimitFilters({ latlng: CORNERS.nw });

    const shownLatLngs = layer.pm._markerGroup
      .getLayers()
      .map((m) => m.getLatLng());
    expect(shownLatLngs).toHaveLength(2);
    expect(shownLatLngs.some((l) => l.equals(CORNERS.nw))).toBe(true);
  });

  it('_preventRenderingMarkers(true) freezes the currently shown markers', () => {
    const layer = enableWithLimit(1);
    layer.pm.applyLimitFilters({ latlng: CORNERS.nw });
    const before = layer.pm._markerGroup.getLayers();

    layer.pm._preventRenderingMarkers(true);
    layer.pm.applyLimitFilters({ latlng: CORNERS.se });

    expect(layer.pm._markerGroup.getLayers()).toEqual(before);
  });

  it('limitMarkersToCount: -1 (default) keeps every marker attached', () => {
    const layer = enableWithLimit(-1);
    expect(layer.pm._markerGroup.getLayers()).toHaveLength(4);
    layer.pm.applyLimitFilters({ latlng: CORNERS.nw });
    expect(layer.pm._markerGroup.getLayers()).toHaveLength(4);
  });
});
