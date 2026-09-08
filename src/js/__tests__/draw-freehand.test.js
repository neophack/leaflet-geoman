// @vitest-environment jsdom
/**
 * Freehand draw had two bugs:
 * 1. Vertices were built from the raw mouse latlng instead of the
 *    (possibly snapped) hint-marker latlng, so `snappable: true` never
 *    affected the drawn geometry.
 * 2. `_onFreehandMove` called `_syncHintMarker` a second time on top of
 *    the mousemove listener Draw.Line#enable already registers, so every
 *    real mouse movement produced snapping side effects (pm:snap events)
 *    twice.
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
  map.pm.setGlobalOptions({ snappable: false });
});

function mousedown(latlng) {
  map.fire('mousedown', {
    latlng: L.latLng(latlng),
    originalEvent: { button: 0 },
  });
}
function mousemove(latlng) {
  map.fire('mousemove', {
    latlng: L.latLng(latlng),
    originalEvent: { button: 0 },
  });
}
function mouseup(latlng) {
  map.fire('mouseup', {
    latlng: L.latLng(latlng),
    originalEvent: { button: 0 },
  });
}

describe('Freehand draw snapping', () => {
  it('snaps the first (mousedown) vertex onto a nearby line', () => {
    L.polyline([
      [52.5, 13.4],
      [52.54, 13.4],
    ]).addTo(map);

    map.pm.Draw.Freehand.enable({ snappable: true });

    // ~12px off the vertical line at lng=13.4 (well within the 20px snapDistance)
    mousedown([52.52, 13.401]);

    const first = map.pm.Draw.Freehand._layer.getLatLngs()[0];
    expect(first.lng).toBeCloseTo(13.4, 4);

    map.pm.Draw.Freehand.disable();
  });

  it('snaps subsequent (mousemove) vertices onto a nearby line', () => {
    L.polyline([
      [52.5, 13.4],
      [52.54, 13.4],
    ]).addTo(map);

    map.pm.Draw.Freehand.enable({ snappable: true });

    mousedown([52.51, 13.42]);
    mousemove([52.52, 13.401]);

    const latlngs = map.pm.Draw.Freehand._layer.getLatLngs();
    const last = latlngs[latlngs.length - 1];
    expect(last.lng).toBeCloseTo(13.4, 4);

    map.pm.Draw.Freehand.disable();
  });

  it('does not run snapping/hint-sync twice per mousemove', () => {
    const draw = map.pm.Draw.Freehand;
    const spy = vi.spyOn(draw, '_syncHintMarker');
    draw.enable({ snappable: false });

    mousedown([52.51, 13.42]);
    spy.mockClear();
    mousemove([52.515, 13.425]);

    expect(spy).toHaveBeenCalledTimes(1);

    draw.disable();
  });
});
