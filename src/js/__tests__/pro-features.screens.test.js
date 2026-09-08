// @vitest-environment jsdom
/**
 * Screen-size tests: runs the extension features on phone / tablet / desktop
 * container sizes to catch resolution dependent behavior (pixel thresholds,
 * snap distances, container point math).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import L from 'leaflet';

const SCREENS = [
  { name: 'phone-portrait (375x667)', width: 375, height: 667 },
  { name: 'tablet (768x1024)', width: 768, height: 1024 },
  { name: 'desktop (1920x1080)', width: 1920, height: 1080 },
];

let map;

function createMap({ width, height }) {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', {
    value: width,
    configurable: true,
  });
  Object.defineProperty(container, 'clientHeight', {
    value: height,
    configurable: true,
  });
  document.body.appendChild(container);
  const m = L.map(container, { center: [52.52, 13.4], zoom: 14 });
  m.pm.setGlobalOptions({ snappable: false });
  return m;
}

function gesture(m, latlngs, button = 0) {
  m.fire('mousedown', {
    latlng: L.latLng(latlngs[0]),
    originalEvent: { button },
  });
  latlngs.slice(1).forEach((latlng) => {
    m.fire('mousemove', {
      latlng: L.latLng(latlng),
      originalEvent: { button },
    });
  });
  m.fire('mouseup', {
    latlng: L.latLng(latlngs[latlngs.length - 1]),
    originalEvent: { button },
  });
}

function square(n, s, w, e) {
  return [
    [s, w],
    [s, e],
    [n, e],
    [n, w],
  ];
}

beforeAll(async () => {
  globalThis.L = L;
  await import('../L.PM.js');
});

afterAll(() => {
  if (map) map.remove();
});

SCREENS.forEach(({ name, width, height }) => {
  describe(`screen ${name}`, () => {
    it('has the expected container size', () => {
      if (map) map.remove();
      map = createMap({ width, height });
      expect(map.getSize().x).toBe(width);
      expect(map.getSize().y).toBe(height);
    });

    it('freehand drawing works and respects the pixel threshold', () => {
      if (map) map.remove();
      map = createMap({ width, height });
      const created = vi.fn();
      map.on('pm:create', created);

      map.pm.Draw.Freehand.enable({ freehandThreshold: 8 });
      // ~40px steps (0.003 lat at zoom 14 ≈ 35px) -> all recorded
      gesture(map, [
        [52.5, 13.38],
        [52.503, 13.383],
        [52.506, 13.386],
        [52.509, 13.389],
        [52.512, 13.392],
        [52.515, 13.395],
        [52.518, 13.398],
      ]);
      expect(created).toHaveBeenCalledTimes(1);
      const layer = created.mock.calls[0][0].layer;
      const count = layer.getLatLngs()[0].length;
      expect(count).toBeGreaterThanOrEqual(5);

      // sub-threshold jitter adds nothing: start a new stroke of micro moves
      map.pm.Draw.Freehand.setOptions({ continueDrawing: true });
      map.pm.Draw.Freehand.enable();
      map.fire('mousedown', {
        latlng: L.latLng(52.52, 13.4),
        originalEvent: { button: 0 },
      });
      for (let i = 1; i <= 10; i += 1) {
        // 0.00002 lat ≈ 0.24px -> below any threshold
        map.fire('mousemove', {
          latlng: L.latLng(52.52 + i * 0.00002, 13.4 + i * 0.00002),
          originalEvent: { button: 0 },
        });
      }
      map.fire('mouseup', {
        latlng: L.latLng(52.5202, 13.4002),
        originalEvent: { button: 0 },
      });
      // stroke too short (2 captured points) -> no second shape, still enabled
      expect(map.pm.Draw.Freehand.enabled()).toBe(true);
      map.pm.Draw.Freehand.disable();
    });

    it('lasso selection works at this resolution', () => {
      if (map) map.remove();
      map = createMap({ width, height });
      const inside = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
      const outside = L.polygon(square(52.7, 52.68, 13.6, 13.62)).addTo(map);
      const lassoEvents = [];
      map.on('pm:lasso-select', (e) => lassoEvents.push(e));

      map.pm.enableGlobalLassoMode();
      gesture(map, [
        [52.5, 13.38],
        [52.5, 13.44],
        [52.56, 13.44],
        [52.56, 13.38],
      ]);
      expect(lassoEvents).toHaveLength(1);
      expect(lassoEvents[0].selectedLayers).toContain(inside);
      expect(lassoEvents[0].selectedLayers).not.toContain(outside);
      map.pm.disableGlobalLassoMode();
    });

    it('scale handle math is consistent regardless of viewport', () => {
      if (map) map.remove();
      map = createMap({ width, height });
      const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
      layer.pm.enableScale();
      const handle = layer.pm._scaleHandles.topleft.marker;
      handle.fire('dragstart', { target: handle });
      handle.setLatLng(L.latLng(52.56, 13.36));
      handle.fire('drag', { target: handle });
      handle.fire('dragend', { target: handle });

      const b = layer.getBounds();
      // uniform scale by factor 2 keeps the shape proportional
      expect(b.getNorth() - b.getSouth()).toBeGreaterThan(0.03);
      expect(b.getEast() - b.getWest()).toBeGreaterThan(0.03);
      layer.pm.disableScale();
    });

    it('copy offset (15px) stays a visible offset at this zoom/size', () => {
      if (map) map.remove();
      map = createMap({ width, height });
      const original = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
      const copy = map.pm.copyLayer(original);
      const p1 = map.latLngToContainerPoint(original.getBounds().getCenter());
      const p2 = map.latLngToContainerPoint(copy.getBounds().getCenter());
      expect(p2.distanceTo(p1)).toBeGreaterThan(10);
      copy.remove();
      original.remove();
    });
  });
});
