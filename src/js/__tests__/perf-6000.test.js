// @vitest-environment jsdom
/**
 * Issue #366: editing performance for layers with 6000+ vertices.
 * The edit markers (vertex + middle markers) are only attached to the DOM
 * when they are inside the viewport. All marker objects still exist, so
 * dragging and neighbor logic is unchanged.
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

const VERTEX_COUNT = 6000;

/**
 * A flat ellipse ring of `count` vertices around the center: tall in lat
 * (0.25 degrees, spans way beyond the viewport) and narrow in lng (0.02
 * degrees), so the east & west parts of the ring cross the viewport while
 * most vertices are outside of it.
 */
function bigRing(count = VERTEX_COUNT) {
  const ring = [];
  const center = [52.52, 13.4];
  const radiusLat = 0.25;
  const radiusLng = 0.02;
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    ring.push([
      center[0] + Math.sin(angle) * radiusLat,
      center[1] + Math.cos(angle) * radiusLng,
    ]);
  }
  return ring;
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
  // disable the simplified edit markers so these tests cover the plain
  // viewport culling behavior (see simplify-edit-markers.test.js)
  map.pm.setGlobalOptions({ snappable: false, simplifyEditMarkers: 0 });
});

describe('viewport culling of edit markers (issue #366)', () => {
  it('creates all marker objects but attaches only in-view markers to the DOM', () => {
    const layer = L.polygon([bigRing()]).addTo(map);
    layer.pm.setOptions({ simplifyEditMarkers: 0 });
    layer.pm.enable();

    // all marker objects exist (6000 vertex + 6000 middle markers)
    expect(layer.pm._allEditMarkers).toHaveLength(VERTEX_COUNT * 2);

    // zoom 14 shows only a small part of the ring (~6% of the markers)
    const attached = layer.pm._markerGroup.getLayers().length;
    expect(attached).toBeGreaterThan(0);
    expect(attached).toBeLessThan(VERTEX_COUNT / 5);
  });

  it('attaches and detaches markers when the viewport moves', () => {
    const layer = L.polygon([bigRing()]).addTo(map);
    layer.pm.setOptions({ simplifyEditMarkers: 0 });
    layer.pm.enable();
    const initialCount = layer.pm._markerGroup.getLayers().length;

    // zoom out -> far more markers are in view
    map.setZoom(10, { animate: false });
    layer.pm._updateMarkersViewport();
    const zoomedOutCount = layer.pm._markerGroup.getLayers().length;
    expect(zoomedOutCount).toBeGreaterThan(initialCount * 5);

    // zoom back in -> markers get detached again
    map.setZoom(14, { animate: false });
    layer.pm._updateMarkersViewport();
    expect(layer.pm._markerGroup.getLayers().length).toBeLessThan(
      zoomedOutCount / 4
    );
  }, 30000);

  it('updates the markers on moveend (throttled, wired to the map)', () => {
    const layer = L.polygon([bigRing()]).addTo(map);
    layer.pm.enable();
    expect(map.listens('moveend')).toBe(true);

    map.setZoom(10, { animate: false }); // fires moveend -> throttled update
    layer.pm.disable();
  });

  it('vertex dragging still works and updates the geometry', () => {
    const layer = L.polygon([bigRing()]).addTo(map);
    layer.pm.enable();

    // find an attached (in view) vertex marker near the center-north of the ring
    const attachedVertex = layer.pm._markerGroup
      .getLayers()
      .find((m) => !m.options?.icon?.options?.className.includes('middle'));
    expect(attachedVertex).toBeTruthy();

    const before = layer.getLatLngs()[0].length;
    dragMarker(attachedVertex, L.latLng(52.55, 13.4));

    expect(layer.getLatLngs()[0].length).toBe(before);
    // the dragged marker moved
    expect(attachedVertex.getLatLng().lat).toBeCloseTo(52.55, 6);
  });

  it('adding a vertex through an in-view middle marker still works', () => {
    const layer = L.polygon([bigRing()]).addTo(map);
    layer.pm.setOptions({ simplifyEditMarkers: 0 });
    layer.pm.enable();
    const before = layer.getLatLngs()[0].length;

    const middleMarker = layer.pm._markerGroup
      .getLayers()
      .find((m) => m.options?.icon?.options?.className.includes('middle'));
    expect(middleMarker).toBeTruthy();

    layer.pm._onMiddleMarkerClick({ target: middleMarker });

    expect(layer.getLatLngs()[0].length).toBe(before + 1);
  });

  it('removing a vertex in view still works', () => {
    const layer = L.polygon([bigRing()]).addTo(map);
    layer.pm.enable();
    const before = layer.getLatLngs()[0].length;

    const vertexMarker = layer.pm._markerGroup
      .getLayers()
      .find((m) => !m.options?.icon?.options?.className.includes('middle'));
    layer.pm._removeMarker({ target: vertexMarker });

    expect(layer.getLatLngs()[0].length).toBe(before - 1);
  });

  it('limitMarkersToViewport: false restores the old behavior', () => {
    const layer = L.polygon([bigRing()]).addTo(map);
    layer.pm.setOptions({
      limitMarkersToViewport: false,
      simplifyEditMarkers: 0,
    });
    layer.pm.enable();

    expect(layer.pm._markerGroup.getLayers().length).toBe(VERTEX_COUNT * 2);
  }, 30000);

  it('works together with limitMarkersToCount (cache knows detached markers)', () => {
    const layer = L.polygon([bigRing()]).addTo(map);
    layer.pm.setOptions({ limitMarkersToCount: 50, simplifyEditMarkers: 0 });
    layer.pm.enable();

    // the cursor based limit applies, the cache contains every marker
    expect(layer.pm.markerCache.length).toBeGreaterThanOrEqual(
      VERTEX_COUNT * 2 - 10
    );
    layer.pm.setOptions({ limitMarkersToCount: -1 });
    layer.pm.disable();
  });

  it('unwires the map listeners on disable', () => {
    const layer = L.polygon([bigRing()]).addTo(map);
    layer.pm.enable();
    layer.pm.disable();
    // Leaflet stores the listeners in `map._events`
    const listeners = map._events?.moveend || [];
    const own = listeners.filter(
      (l) => l.fn === layer.pm.throttledUpdateViewport || l.ctx === layer.pm
    );
    expect(own).toHaveLength(0);
  });

  it('undo still snapshots the full geometry after an edit', () => {
    const layer = L.polygon([bigRing()]).addTo(map);
    layer.pm.enable();

    const vertexMarker = layer.pm._markerGroup
      .getLayers()
      .find((m) => !m.options?.icon?.options?.className.includes('middle'));
    dragMarker(vertexMarker, L.latLng(52.55, 13.4));

    map.pm.undo();
    expect(layer.getLatLngs()[0].length).toBe(VERTEX_COUNT);
    map.pm.redo();
  }, 30000);

  it('enables editing on a 6000 vertex layer within a reasonable time', () => {
    const layer = L.polygon([bigRing()]).addTo(map);
    const start = performance.now();
    layer.pm.enable();
    const duration = performance.now() - start;
    // generous budget for CI / jsdom; the win is the missing 12k DOM nodes
    expect(duration).toBeLessThan(4000);
    expect(layer.pm._markerGroup.getLayers().length).toBeLessThan(
      VERTEX_COUNT / 5
    );
  }, 30000);
});
