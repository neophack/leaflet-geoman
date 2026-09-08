// @vitest-environment jsdom
/**
 * Dragging.js#_syncLayers: when `syncLayersOnDrag: true` and a layer
 * belongs to more than one parent LayerGroup/FeatureGroup, the loop over
 * `this._parentLayerGroup` overwrote `layersToSync` on every iteration
 * instead of concatenating, so only the last-iterated group's siblings
 * were actually synced during a drag.
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
  map.pm.setGlobalOptions({ draggable: true, snappable: false });
});

describe('Dragging syncLayersOnDrag with multiple parent groups', () => {
  it('syncs siblings from every parent group the dragged layer belongs to', () => {
    const layer1 = L.polyline([
      [52.5, 13.3],
      [52.51, 13.31],
    ]);
    const layer2 = L.polyline([
      [52.52, 13.32],
      [52.53, 13.33],
    ]);
    const layer3 = L.polyline([
      [52.54, 13.34],
      [52.55, 13.35],
    ]);

    L.featureGroup([layer1, layer2]).addTo(map);
    L.featureGroup([layer1, layer3]).addTo(map);

    layer1.pm.options.syncLayersOnDrag = true;

    const spy2 = vi
      .spyOn(layer2.pm, '_dragMixinOnMouseDown')
      .mockImplementation(() => {});
    const spy3 = vi
      .spyOn(layer3.pm, '_dragMixinOnMouseDown')
      .mockImplementation(() => {});

    const fakeEvent = {
      target: layer1,
      originalEvent: { button: 0 },
      latlng: L.latLng(52.5, 13.3),
    };
    layer1.pm._syncLayers('_dragMixinOnMouseDown', fakeEvent);

    expect(spy2).toHaveBeenCalled();
    expect(spy3).toHaveBeenCalled();
  });
});
