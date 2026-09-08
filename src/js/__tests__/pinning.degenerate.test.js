// @vitest-environment jsdom
/**
 * Pinning degenerate-geometry regression tests.
 *
 * A rectangle and a triangle share one vertex. Dragging a third layer's
 * pinned vertex around that shared point must never corrupt the pinned
 * layers with zero-length edges:
 * - dragging onto another vertex of the pinned triangle would duplicate
 *   that vertex (one triangle edge becomes length 0)
 * - dragging a pinned rectangle corner onto/level with another corner
 *   rebuilds a degenerate rectangle (zero width/height)
 * In those cases the pinned layer simply keeps its previous geometry
 * (the pin breaks instead of corrupting the shape).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import L from 'leaflet';

let map;

const SHARED = [52.52, 13.4];
const TRI_A = [52.525, 13.415];
const TRI_B = [52.515, 13.41];

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
  map = L.map(container, { center: [52.52, 13.4], zoom: 18 });
  map.pm.setGlobalOptions({ snappable: false });
});

function minEdgeLength(layer) {
  const ring = layer.getLatLngs()[0];
  let min = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const d = map.distance(ring[i], ring[(i + 1) % ring.length]);
    if (d < min) {
      min = d;
    }
  }
  return min;
}

/** rect (corner at SHARED) + triangle sharing SHARED + another triangle with a vertex at SHARED */
function loadSharedPointScene() {
  const rect = L.rectangle([
    [52.52, 13.4],
    [52.53, 13.43],
  ]).addTo(map);
  const triangle = L.polygon([SHARED, TRI_A, TRI_B]).addTo(map);
  const other = L.polygon([SHARED, [52.522, 13.408], [52.518, 13.404]]).addTo(
    map
  );

  // pinning is a layer option pushed to the layers existing when it is
  // enabled (same as upstream) - so enable it after the layers are added
  map.pm.setGlobalOptions({ pinning: true });

  [rect, triangle, other].forEach((layer) =>
    layer.pm.enable({ allowSelfIntersection: true })
  );

  const marker = other.pm._markers[0].find((m) =>
    m.getLatLng().equals(L.latLng(SHARED))
  );
  expect(marker).toBeTruthy();
  return { rect, triangle, other, marker };
}

function dragMarkerTo(marker, latlng) {
  marker.fire('dragstart', { target: marker });
  marker.setLatLng(L.latLng(latlng));
  marker.fire('drag', { target: marker });
  marker.fire('dragend', { target: marker });
}

describe('pinning shared-vertex degenerate geometry', () => {
  it('a normal drag still moves and rebuilds the pinned layers', () => {
    const { rect, triangle, other, marker } = loadSharedPointScene();
    const moved = L.latLng(52.521, 13.401);

    dragMarkerTo(marker, moved);

    // all three layers follow, none degenerates
    expect(other.getLatLngs()[0][0].equals(moved)).toBe(true);
    expect(triangle.getLatLngs()[0][0].equals(moved)).toBe(true);
    // the rectangle is rebuilt from the dragged corner + the opposite one
    // (the rebuild goes through a projection roundtrip, so compare by
    // distance instead of exact equality)
    expect(
      rect.getLatLngs()[0].some((ll) => map.distance(ll, moved) < 0.01)
    ).toBe(true);
    [rect, triangle, other].forEach((layer) =>
      expect(minEdgeLength(layer)).toBeGreaterThan(1)
    );
  });

  it('dragging onto another vertex of the pinned triangle keeps it intact (no zero-length edge)', () => {
    const { rect, triangle, marker } = loadSharedPointScene();

    dragMarkerTo(marker, TRI_A);

    // the pinned corner is NOT moved onto the triangle's own vertex A
    expect(minEdgeLength(triangle)).toBeGreaterThan(1);
    expect(triangle.getLatLngs()[0][0].equals(L.latLng(SHARED))).toBe(true);
    expect(triangle.getLatLngs()[0][1].equals(L.latLng(TRI_A))).toBe(true);
    // the other layers stay valid as well
    expect(minEdgeLength(rect)).toBeGreaterThan(1);
  });

  it.each([
    ['another rectangle corner', [52.52, 13.43]],
    ['the opposite rectangle corner', [52.53, 13.43]],
    ['level with the opposite corner (same lng)', [52.53, 13.415]],
    ['level with the opposite corner (same lat)', [52.525, 13.43]],
  ])('dragging onto %s keeps the rectangle valid', (_label, target) => {
    const { rect, triangle, marker } = loadSharedPointScene();

    dragMarkerTo(marker, target);

    expect(minEdgeLength(rect)).toBeGreaterThan(1);
    expect(minEdgeLength(triangle)).toBeGreaterThan(1);
  });

  it('the dragged layer itself can still be placed on the shared point', () => {
    // pinning a vertex TO the shared point from the outside is a normal,
    // valid operation and must not be blocked
    const rect = L.rectangle([
      [52.52, 13.4],
      [52.53, 13.43],
    ]).addTo(map);
    const triangle = L.polygon([SHARED, TRI_A, TRI_B]).addTo(map);
    const other = L.polygon([
      [52.518, 13.398],
      [52.522, 13.408],
      [52.515, 13.404],
    ]).addTo(map);
    [rect, triangle, other].forEach((layer) =>
      layer.pm.enable({ allowSelfIntersection: true })
    );

    const marker = other.pm._markers[0][0];
    dragMarkerTo(marker, SHARED);

    expect(other.getLatLngs()[0][0].equals(L.latLng(SHARED))).toBe(true);
    expect(minEdgeLength(other)).toBeGreaterThan(1);
    // the already-shared layers are untouched by this drag
    expect(triangle.getLatLngs()[0][0].equals(L.latLng(SHARED))).toBe(true);
    expect(minEdgeLength(triangle)).toBeGreaterThan(1);
    expect(minEdgeLength(rect)).toBeGreaterThan(1);
  });
});
