// @vitest-environment jsdom
/**
 * Rectangle drag drawing (issue #1106): press-drag-release instead of
 * two clicks. Enabled with `dragDraw: true`.
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

describe('rectangle dragDraw', () => {
  it('draws a rectangle on mousedown-move-mouseup', () => {
    const created = vi.fn();
    map.on('pm:create', created);

    map.pm.Draw.Rectangle.enable({ dragDraw: true, snappable: false });

    // press
    map.fire('mousedown', {
      latlng: L.latLng(52.5, 13.4),
      originalEvent: { button: 0 },
    });
    // map dragging is disabled while dragging out the rectangle
    expect(map.dragging.enabled()).toBe(false);

    // drag
    map.fire('mousemove', {
      latlng: L.latLng(52.53, 13.44),
      originalEvent: { button: 0 },
    });
    // release
    map.fire('mouseup', {
      latlng: L.latLng(52.53, 13.44),
      originalEvent: { button: 0 },
    });

    expect(created).toHaveBeenCalledTimes(1);
    const layer = created.mock.calls[0][0].layer;
    expect(layer).toBeInstanceOf(L.Rectangle);
    const bounds = layer.getBounds();
    expect(bounds.getSouth()).toBeCloseTo(52.5, 3);
    expect(bounds.getNorth()).toBeCloseTo(52.53, 3);
    expect(bounds.getWest()).toBeCloseTo(13.4, 3);
    expect(bounds.getEast()).toBeCloseTo(13.44, 3);
    // map dragging is restored after the rectangle is drawn
    expect(map.dragging.enabled()).toBe(true);
    expect(map.pm.Draw.Rectangle.enabled()).toBe(false);
  });

  it('ignores right-button presses', () => {
    const created = vi.fn();
    map.on('pm:create', created);
    map.pm.Draw.Rectangle.enable({ dragDraw: true, snappable: false });

    map.fire('mousedown', {
      latlng: L.latLng(52.5, 13.4),
      originalEvent: { button: 2 },
    });
    map.fire('mousemove', {
      latlng: L.latLng(52.53, 13.44),
      originalEvent: { button: 2 },
    });
    map.fire('mouseup', {
      latlng: L.latLng(52.53, 13.44),
      originalEvent: { button: 2 },
    });
    expect(created).not.toHaveBeenCalled();
    // left still works
    map.fire('mousedown', {
      latlng: L.latLng(52.5, 13.4),
      originalEvent: { button: 0 },
    });
    map.fire('mousemove', {
      latlng: L.latLng(52.53, 13.44),
      originalEvent: { button: 0 },
    });
    map.fire('mouseup', {
      latlng: L.latLng(52.53, 13.44),
      originalEvent: { button: 0 },
    });
    expect(created).toHaveBeenCalledTimes(1);
  });

  it('still works in click mode by default (regression)', () => {
    const created = vi.fn();
    map.on('pm:create', created);
    map.pm.Draw.Rectangle.enable({ snappable: false });

    map.fire('mousemove', { latlng: L.latLng(52.5, 13.4), originalEvent: {} });
    map.fire('click', { latlng: L.latLng(52.5, 13.4), originalEvent: {} });
    map.fire('mousemove', {
      latlng: L.latLng(52.53, 13.44),
      originalEvent: {},
    });
    map.fire('click', { latlng: L.latLng(52.53, 13.44), originalEvent: {} });

    expect(created).toHaveBeenCalledTimes(1);
  });
});
