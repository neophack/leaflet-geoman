// @vitest-environment jsdom
/**
 * Layer categories: stamp drawn layers with a category like "river" / "house".
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

function square(n, s, w, e) {
  return [
    [s, w],
    [s, e],
    [n, e],
    [n, w],
  ];
}

function drawPolygon() {
  const created = vi.fn();
  map.on('pm:create', created);
  map.pm.Draw.Polygon.enable();
  [
    [52.5, 13.38],
    [52.5, 13.42],
    [52.52, 13.42],
    [52.52, 13.38],
  ].forEach((latlng) => {
    map.pm.Draw.Polygon._hintMarker.setLatLng(latlng);
    map.pm.Draw.Polygon._createVertex({ latlng });
  });
  map.pm.Draw.Polygon._finishShape();
  map.off('pm:create', created);
  return created.mock.calls[0][0].layer;
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

describe('active category', () => {
  it('stamps drawn layers with the active category', () => {
    map.pm.setActiveCategory('river');
    expect(map.pm.getActiveCategory()).toBe('river');

    const layer = drawPolygon();
    expect(layer.pm.getCategory()).toBe('river');
  });

  it('does not stamp without an active category', () => {
    const layer = drawPolygon();
    expect(layer.pm.getCategory()).toBeUndefined();
  });

  it('the draw option category wins over the active one', () => {
    map.pm.setActiveCategory('river');
    const created = vi.fn();
    map.on('pm:create', created);
    map.pm.Draw.Polygon.enable({ category: 'house' });
    [
      [52.5, 13.38],
      [52.5, 13.42],
      [52.52, 13.42],
      [52.52, 13.38],
    ].forEach((latlng) => {
      map.pm.Draw.Polygon._hintMarker.setLatLng(latlng);
      map.pm.Draw.Polygon._createVertex({ latlng });
    });
    map.pm.Draw.Polygon._finishShape();

    expect(created.mock.calls[0][0].layer.pm.getCategory()).toBe('house');
  });

  it('clearActiveCategory stops stamping', () => {
    map.pm.setActiveCategory('river');
    map.pm.clearActiveCategory();
    expect(map.pm.getActiveCategory()).toBeUndefined();

    const layer = drawPolygon();
    expect(layer.pm.getCategory()).toBeUndefined();
  });

  it('fires pm:activecategorychange', () => {
    const event = vi.fn();
    map.on('pm:activecategorychange', event);
    map.pm.setActiveCategory('river');
    expect(event).toHaveBeenCalledTimes(1);
    expect(event.mock.calls[0][0].category).toBe('river');
    map.pm.setActiveCategory('river'); // no change -> no event
    expect(event).toHaveBeenCalledTimes(1);
  });
});

describe('category registry & styling', () => {
  it('applies registered styles to layers of the category', () => {
    map.pm.setCategory('river', { pathOptions: { color: '#0088ff' } });
    map.pm.setActiveCategory('river');
    const layer = drawPolygon();
    expect(layer.options.color).toBe('#0088ff');
  });

  it('restyles all layers when the category style is updated', () => {
    map.pm.setCategory('river', { pathOptions: { color: '#0088ff' } });
    map.pm.setActiveCategory('river');
    const a = drawPolygon();
    const b = drawPolygon();

    map.pm.setCategory('river', { pathOptions: { color: '#00ff88' } });
    expect(a.options.color).toBe('#00ff88');
    expect(b.options.color).toBe('#00ff88');
  });

  it('getLayersByCategory returns only matching layers', () => {
    map.pm.setActiveCategory('river');
    const river = drawPolygon();
    map.pm.setActiveCategory('house');
    const house = drawPolygon();

    expect(map.pm.getLayersByCategory('river')).toEqual([river]);
    expect(map.pm.getLayersByCategory('house')).toEqual([house]);
    expect(map.pm.getLayersByCategory('street')).toEqual([]);
  });

  it('getCategories / removeCategory', () => {
    map.pm.setCategory('river', { pathOptions: { color: '#123456' } });
    expect(Object.keys(map.pm.getCategories())).toContain('river');
    map.pm.setActiveCategory('river');
    map.pm.removeCategory('river');
    expect(map.pm.getActiveCategory()).toBeUndefined();
  });
});

describe('layer category API', () => {
  it('setCategory fires pm:categorychange and can be queried', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    const event = vi.fn();
    map.on('pm:categorychange', event);

    layer.pm.setCategory('house');
    expect(layer.pm.getCategory()).toBe('house');
    expect(event).toHaveBeenCalledTimes(1);
    expect(event.mock.calls[0][0].category).toBe('house');
    expect(event.mock.calls[0][0].oldCategory).toBeUndefined();

    layer.pm.setCategory('street');
    expect(event).toHaveBeenCalledTimes(2);
    expect(event.mock.calls[1][0].oldCategory).toBe('house');
  });

  it('copies keep the category of their source', () => {
    map.pm.setActiveCategory('river');
    const original = drawPolygon();
    const copy = map.pm.copyLayer(original);
    expect(copy.pm.getCategory()).toBe('river');
  });

  it('union keeps the category shared by both source layers', () => {
    map.pm.setActiveCategory('river');
    const a = L.polygon(square(52.54, 52.5, 13.38, 13.42)).addTo(map);
    const b = L.polygon(square(52.54, 52.5, 13.4, 13.44)).addTo(map);
    a.pm.setCategory('river');
    b.pm.setCategory('river');

    const result = map.pm.union(a, b);
    expect(result.pm.getCategory()).toBe('river');
  });

  it('union does not guess a category when sources disagree', () => {
    const a = L.polygon(square(52.54, 52.5, 13.38, 13.42)).addTo(map);
    const b = L.polygon(square(52.54, 52.5, 13.4, 13.44)).addTo(map);
    a.pm.setCategory('river');
    b.pm.setCategory('house');

    const result = map.pm.union(a, b);
    expect(result.pm.getCategory()).toBeUndefined();
  });

  it('difference keeps the category of the base layer', () => {
    const a = L.polygon(square(52.54, 52.5, 13.38, 13.42)).addTo(map);
    const b = L.polygon(square(52.54, 52.5, 13.4, 13.44)).addTo(map);
    a.pm.setCategory('river');

    const result = map.pm.difference(a, b);
    expect(result.pm.getCategory()).toBe('river');
  });

  it('undo/redo keeps working with categorized layers', () => {
    map.pm.setActiveCategory('river');
    const layer = drawPolygon();
    expect(map.pm.undo()).toBe(true);
    expect(map.hasLayer(layer)).toBe(false);
    expect(map.pm.redo()).toBe(true);
    expect(map.hasLayer(layer)).toBe(true);
    expect(layer.pm.getCategory()).toBe('river');
  });
});

describe('category GeoJSON round-trip', () => {
  it('toGeoJSON includes the category as properties.pmCategory', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    layer.pm.setCategory('river');

    expect(layer.toGeoJSON().properties.pmCategory).toBe('river');
  });

  it('clearing the category removes it from properties', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    layer.pm.setCategory('river');
    layer.pm.setCategory(undefined);

    expect(layer.toGeoJSON().properties.pmCategory).toBeUndefined();
  });

  it('a layer loaded from GeoJSON with pmCategory is picked up without an explicit setCategory call', () => {
    const geojson = {
      type: 'Feature',
      properties: { pmCategory: 'house' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [13.39, 52.51],
            [13.41, 52.51],
            [13.41, 52.53],
            [13.39, 52.53],
            [13.39, 52.51],
          ],
        ],
      },
    };
    const layer = L.geoJSON(geojson).getLayers()[0].addTo(map);

    expect(layer.pm.getCategory()).toBe('house');
  });
});

describe('ctrl+click re-categorizes an existing layer', () => {
  // the re-categorize click is bound on the layer's DOM element
  function ctrlClick(layer) {
    layer.getElement().dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      })
    );
  }

  function plainClick(layer) {
    layer
      .getElement()
      .dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      );
  }

  it('stamps the active category (and its style) onto the clicked layer', () => {
    map.pm.setCategory('river', { pathOptions: { color: '#3388ff' } });
    map.pm.setActiveCategory('river');
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);

    ctrlClick(layer);

    expect(layer.pm.getCategory()).toBe('river');
    expect(layer.options.color).toBe('#3388ff');
  });

  it('does nothing without an active category', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);

    ctrlClick(layer);

    expect(layer.pm.getCategory()).toBeUndefined();
  });

  it('is a no-op while a global mode (f.ex. Draw) is active', () => {
    map.pm.setActiveCategory('river');
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    map.pm.Draw.Polygon.enable();

    ctrlClick(layer);

    expect(layer.pm.getCategory()).toBeUndefined();
    map.pm.Draw.Polygon.disable();
  });

  it('a plain click (no ctrl/meta) does not re-categorize', () => {
    map.pm.setActiveCategory('river');
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);

    plainClick(layer);

    expect(layer.pm.getCategory()).toBeUndefined();
  });
});
