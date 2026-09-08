// @vitest-environment jsdom
/**
 * Rings with more than `simplifyEditMarkers` (default 100) vertices only
 * get a decimated subset of vertex markers when editing. Which vertices are
 * shown depends on the zoom level (min `simplifyEditMarkersSpacing` screen
 * pixels apart), the marker array keeps `{}` placeholders so indices stay
 * aligned with the coordinates. When a shown vertex is dragged, the hidden
 * vertices between it and the next shown neighbors follow the drag weighted
 * by their path distance on the line.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import L from 'leaflet';

let map;

function straightLine(count, startLat = 52.5, lng = 13.4, latStep = 0.0001) {
  const latlngs = [];
  for (let i = 0; i < count; i += 1) {
    latlngs.push([startLat + i * latStep, lng]);
  }
  return latlngs;
}

function dragMarker(marker, toLatLng) {
  marker.fire('dragstart', { target: marker });
  marker.setLatLng(toLatLng);
  marker.fire('drag', { target: marker });
  marker.fire('dragend', { target: marker });
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

const shownIndices = (layer) =>
  layer.pm._markers
    .map((m, i) => (typeof m.getLatLng === 'function' ? i : -1))
    .filter((i) => i > -1);

describe('simplified edit markers (simplifyEditMarkers)', () => {
  it('decimates vertex markers above the threshold and hides middle markers', () => {
    const layer = L.polyline(straightLine(2000)).addTo(map);
    layer.pm.enable();

    // markers array keeps its length (placeholders), real markers are few
    expect(layer.pm._markers.length).toBe(2000);
    const realCount = shownIndices(layer).length;
    expect(realCount).toBeLessThanOrEqual(
      map.pm.globalOptions.simplifyEditMarkers + 2
    );
    // vertex markers only, no middle markers on simplified rings
    expect(layer.pm._allEditMarkers.length).toBe(realCount);

    layer.pm.disable();
  });

  it('creates all markers when below the threshold', () => {
    const layer = L.polyline(straightLine(50)).addTo(map);
    layer.pm.enable();

    // 50 vertices + 49 middle markers
    expect(layer.pm._allEditMarkers.length).toBe(50 + 49);
    layer.pm.disable();
  });

  it('can be disabled with simplifyEditMarkers: 0', () => {
    const layer = L.polyline(straightLine(500)).addTo(map);
    layer.pm.setOptions({ simplifyEditMarkers: 0 });
    layer.pm.enable();

    expect(layer.pm._allEditMarkers.length).toBe(500 + 499);
    layer.pm.disable();
  });

  it('shows more edit markers when zoomed in and fewer when zoomed out', () => {
    const layer = L.polyline(straightLine(2000, 52.4, 13.35)).addTo(map);
    layer.pm.enable();

    const atZoom14 = shownIndices(layer).length;

    map.setZoom(10, { animate: false }); // fires zoomend -> rebuild
    const atZoom10 = shownIndices(layer).length;
    expect(atZoom10).toBeLessThan(atZoom14);

    map.setZoom(18, { animate: false });
    const atZoom18 = shownIndices(layer).length;
    expect(atZoom18).toBeGreaterThan(atZoom14);

    // hard cap: even fully zoomed in there are at most simplifyEditMarkersMax
    expect(atZoom18).toBeLessThanOrEqual(
      map.pm.globalOptions.simplifyEditMarkersMax + 2
    );

    // the geometry is untouched by the rebuilds
    expect(layer.getLatLngs().length).toBe(2000);
    layer.pm.disable();
  });

  it('moving a shown vertex makes the hidden vertices follow weighted by path distance', () => {
    // uniform spacing: hidden vertex `s` path steps away from the dragged
    // vertex moves by (1 - s / stride) * dragDelta
    const layer = L.polyline(straightLine(201, 52.4)).addTo(map);
    layer.pm.enable();

    const shown = shownIndices(layer);
    expect(shown.length).toBeGreaterThan(4);

    // pick a shown vertex with shown neighbors on both sides
    const pos = Math.floor(shown.length / 2);
    const draggedIndex = shown[pos];
    const stride = shown[pos + 1] - draggedIndex;
    const draggedMarker = layer.pm._markers[draggedIndex];
    expect(stride).toBeGreaterThan(1); // there are hidden vertices in between

    const before = layer.getLatLngs().map((ll) => ll.lat);
    const dragDelta = 0.01;
    dragMarker(draggedMarker, L.latLng(before[draggedIndex] + dragDelta, 13.4));

    const after = layer.getLatLngs().map((ll) => ll.lat);
    expect(after.length).toBe(201); // no vertices lost

    // the dragged vertex moved by the full delta
    expect(after[draggedIndex] - before[draggedIndex]).toBeCloseTo(
      dragDelta,
      8
    );

    // hidden vertices: weight 1 - pathDistance / totalPath (uniform spacing
    // -> path distance in steps), so the drag fades out along the line
    for (let offset = 1; offset < stride; offset += 1) {
      const idx = draggedIndex + offset;
      const expected = dragDelta * (1 - offset / stride);
      expect(after[idx] - before[idx]).toBeCloseTo(expected, 6);
    }

    // shown neighbors are not moved
    expect(after[shown[pos - 1]]).toBeCloseTo(before[shown[pos - 1]], 10);
    expect(after[shown[pos + 1]]).toBeCloseTo(before[shown[pos + 1]], 10);

    // vertices beyond the shown neighbors are untouched
    expect(after[shown[pos - 1] - 1]).toBeCloseTo(
      before[shown[pos - 1] - 1],
      10
    );
    expect(after[shown[pos + 1] + 1]).toBeCloseTo(
      before[shown[pos + 1] + 1],
      10
    );

    layer.pm.disable();
  });

  it('dragging a shown vertex next to hidden placeholders does not crash on a self-intersecting layer', () => {
    // two straight rays crossing each other (an "X"), each far more than
    // `simplifyEditMarkers` (default 100) points, so most vertex markers
    // are `{}` placeholders. With allowSelfIntersectionEdit the drag start
    // handler calls _checkMarkerAllowedToDrag, which looks at the dragged
    // marker's array-neighbors - almost certainly placeholders here.
    const rayA = [];
    const rayB = [];
    for (let i = 0; i < 150; i += 1) {
      const t = i / 149;
      rayA.push([52.4 + t * 0.05, 13.3 + t * 0.1]);
      rayB.push([52.45 - t * 0.05, 13.3 + t * 0.1]);
    }
    const layer = L.polyline(rayA.concat(rayB)).addTo(map);
    layer.pm.enable({
      allowSelfIntersection: false,
      allowSelfIntersectionEdit: true,
    });
    expect(layer.pm.hasSelfIntersection()).toBe(true);

    const shown = shownIndices(layer);
    expect(shown.length).toBeGreaterThan(2);
    // a shown vertex with placeholder neighbors on both sides
    const draggedIndex = shown[Math.floor(shown.length / 2)];
    const draggedMarker = layer.pm._markers[draggedIndex];

    expect(() =>
      dragMarker(draggedMarker, L.latLng(52.42, 13.35))
    ).not.toThrow();

    layer.pm.disable();
  });

  it('keeps the geometry exportable after interpolated drags', () => {
    // 0.01deg spacing: every vertex is far more than the marker spacing
    // apart at zoom 14, so all of them are editable
    const layer = L.polyline(straightLine(400, 52.4, 13.4, 0.01)).addTo(map);
    layer.pm.enable();

    expect(typeof layer.pm._markers[120].getLatLng).toBe('function');
    dragMarker(layer.pm._markers[120], L.latLng(52.55, 13.45));

    const geojson = layer.toGeoJSON();
    expect(geojson.geometry.coordinates.length).toBe(400);

    layer.pm.disable();
  });
});
