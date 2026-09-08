// @vitest-environment jsdom
/**
 * LayerOps: shared helpers behind the boolean-operation modes
 * (Union / Difference / Split), see helpers/LayerOps.js.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import L from 'leaflet';
import {
  isPolygonLayer,
  isRelevantLayer,
  setLayerPane,
  replaceLayersWithGeoJSON,
  addSelectionHighlight,
  removeSelectionHighlight,
  actionTooltip,
} from '../helpers/LayerOps';

let map;

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

describe('isPolygonLayer', () => {
  it('is true for a polygon and a rectangle', () => {
    expect(isPolygonLayer(L.polygon(square(52.53, 52.51, 13.39, 13.41)))).toBe(
      true
    );
    expect(
      isPolygonLayer(
        L.rectangle([
          [52.51, 13.39],
          [52.53, 13.41],
        ])
      )
    ).toBe(true);
  });

  it('is false for a polyline or marker', () => {
    expect(
      isPolygonLayer(
        L.polyline([
          [52.51, 13.39],
          [52.53, 13.41],
        ])
      )
    ).toBe(false);
    expect(isPolygonLayer(L.marker([52.51, 13.39]))).toBe(false);
  });
});

describe('isRelevantLayer', () => {
  it('is true for a normal geoman-enabled layer on the map', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    expect(isRelevantLayer(layer)).toBe(true);
  });

  it('is true even before the layer is added to the map (pm attaches on construction)', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41));
    expect(isRelevantLayer(layer)).toBe(true);
  });

  it('is false for a LayerGroup', () => {
    const group = L.layerGroup().addTo(map);
    expect(isRelevantLayer(group)).toBe(false);
  });

  it('is false for a temporary geoman layer (_pmTempLayer)', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    layer._pmTempLayer = true;
    expect(isRelevantLayer(layer)).toBe(false);
  });

  it('respects options.pmIgnore (pm is never attached, so it reads as falsy)', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41), {
      pmIgnore: true,
    }).addTo(map);
    expect(layer.pm).toBeUndefined();
    expect(isRelevantLayer(layer)).toBeFalsy();
  });
});

describe('setLayerPane', () => {
  it('uses the map global layerPane option', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41));
    map.pm.setGlobalOptions({ panes: { layerPane: 'shadowPane' } });
    setLayerPane(map, layer);
    expect(layer.options.pane).toBe('shadowPane');
  });

  it('falls back to overlayPane when no pane is configured', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41));
    map.pm.globalOptions.panes = undefined;
    setLayerPane(map, layer);
    expect(layer.options.pane).toBe('overlayPane');
  });
});

describe('addSelectionHighlight / removeSelectionHighlight', () => {
  it('adds a non-interactive, pmIgnore-d dashed copy of the layer to the map', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    const highlight = addSelectionHighlight(layer);

    expect(map.hasLayer(highlight)).toBe(true);
    expect(highlight._pmTempLayer).toBe(true);
    expect(highlight.options.interactive).toBe(false);
    expect(highlight.options.pmIgnore).toBe(true);
  });

  it('accepts style overrides', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    const highlight = addSelectionHighlight(layer, { color: '#ff0000' });
    expect(highlight.options.color).toBe('#ff0000');
  });

  it('removeSelectionHighlight removes it from the map', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    const highlight = addSelectionHighlight(layer);
    removeSelectionHighlight(highlight);
    expect(map.hasLayer(highlight)).toBe(false);
  });

  it('removeSelectionHighlight is a no-op for undefined', () => {
    expect(() => removeSelectionHighlight(undefined)).not.toThrow();
  });
});

describe('actionTooltip', () => {
  it('interpolates the {action} placeholder with the translated action', () => {
    const text = actionTooltip('tooltips.selectFirstLayerFor', 'actions.union');
    expect(text).toBe('Select first layer for Union');
  });
});

describe('replaceLayersWithGeoJSON', () => {
  it('returns null for an empty geojson', () => {
    expect(replaceLayersWithGeoJSON(map, [], null)).toBeNull();
  });

  it('replaces the input layer(s) with a layer built from the geojson', () => {
    const original = L.polygon(square(52.53, 52.51, 13.39, 13.41), {
      color: '#123456',
    }).addTo(map);
    const geojson = original.toGeoJSON();

    const result = replaceLayersWithGeoJSON(map, [original], geojson);

    expect(map.hasLayer(original)).toBe(false);
    expect(map.hasLayer(result)).toBe(true);
    expect(result.options.color).toBe('#123456'); // keeps the template's options
    expect(result._drawnByGeoman).toBe(true);
    expect(result.pm.enabled()).toBe(false); // enabled then disabled to transfer options
  });

  it('marks every sub-layer of a multi-feature result as drawn by geoman', () => {
    // a FeatureCollection (multiple disjoint result parts, as Union produces
    // for non-overlapping polygons) turns into a LayerGroup, unlike a single
    // MultiPolygon feature which Leaflet renders as one multi-part layer
    const original = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    const geojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [13.39, 52.51],
                [13.4, 52.51],
                [13.4, 52.52],
                [13.39, 52.51],
              ],
            ],
          },
        },
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [13.41, 52.51],
                [13.42, 52.51],
                [13.42, 52.52],
                [13.41, 52.51],
              ],
            ],
          },
        },
      ],
    };

    const result = replaceLayersWithGeoJSON(map, [original], geojson);

    expect(result instanceof L.LayerGroup).toBe(true);
    result.eachLayer((l) => {
      expect(l._drawnByGeoman).toBe(true);
    });
  });
});
