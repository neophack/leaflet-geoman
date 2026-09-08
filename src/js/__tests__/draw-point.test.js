// @vitest-environment jsdom
/**
 * Point drawing: a precise-position dot (small solid CircleMarker),
 * in contrast to the teardrop Marker.
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

describe('Draw.Point', () => {
  it('is registered as a draw shape', () => {
    expect(map.pm.Draw.getShapes()).toContain('Point');
    expect(map.pm.Draw.Point).toBeTruthy();
  });

  it('places a small solid dot with a single click', () => {
    const created = vi.fn();
    map.on('pm:create', created);

    map.pm.Draw.Point.enable();
    expect(map.pm.Draw.Point.enabled()).toBe(true);

    map.fire('click', { latlng: L.latLng(52.52, 13.4), originalEvent: {} });

    expect(created).toHaveBeenCalledTimes(1);
    const { layer, shape } = created.mock.calls[0][0];
    expect(shape).toBe('Point');
    expect(layer).toBeInstanceOf(L.CircleMarker);
    // screen pixel radius -> constant on every zoom level
    expect(layer.getRadius()).toBe(6);
    expect(layer.getLatLng().lat).toBeCloseTo(52.52, 6);
    expect(layer.getLatLng().lng).toBeCloseTo(13.4, 6);
    // solid dot styling
    expect(layer.options.fillOpacity).toBe(1);
  });

  it('is draggable and editable like other layers (regression)', () => {
    const created = vi.fn();
    map.on('pm:create', created);
    map.pm.Draw.Point.enable();
    map.fire('click', { latlng: L.latLng(52.52, 13.4), originalEvent: {} });
    const layer = created.mock.calls[0][0].layer;

    layer.pm.enable();
    expect(layer.pm.enabled()).toBe(true);
    layer.pm.disable();
  });

  it('works together with categories', () => {
    map.pm.setActiveCategory('house');
    const created = vi.fn();
    map.on('pm:create', created);
    map.pm.Draw.Point.enable();
    map.fire('click', { latlng: L.latLng(52.52, 13.4), originalEvent: {} });

    expect(created.mock.calls[0][0].layer.pm.getCategory()).toBe('house');
  });

  it('undo removes the point again', () => {
    const created = vi.fn();
    map.on('pm:create', created);
    map.pm.Draw.Point.enable();
    map.fire('click', { latlng: L.latLng(52.52, 13.4), originalEvent: {} });
    const layer = created.mock.calls[0][0].layer;

    map.pm.undo();
    expect(map.hasLayer(layer)).toBe(false);
  });

  it('has a toolbar button (opt-in via drawPoint option)', () => {
    map.pm.addControls({ drawPoint: true });
    const button = map.pm.Toolbar.getButton('drawPoint');
    expect(button).toBeTruthy();
  });

  it('Enter does not finish a point (single-click shape)', () => {
    map.pm.setGlobalOptions({ finishOnEnter: true });
    const created = vi.fn();
    map.on('pm:create', created);
    map.pm.Draw.Point.enable();

    document.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
    expect(created).not.toHaveBeenCalled();
    map.pm.Draw.Point.disable();
  });
});
