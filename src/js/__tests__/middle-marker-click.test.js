// @vitest-environment jsdom
/**
 * Regression: a DOM click on a middle marker of an edited polygon must add
 * a vertex (pm:vertexadded). The click routing must not be swallowed by
 * the selection handler bound on layer elements.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
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

describe('middle marker click adds a vertex', () => {
  it('fires pm:vertexadded on a DOM click on the middle marker element', () => {
    const layer = L.polygon([
      [52.54, 13.38],
      [52.54, 13.44],
      [52.48, 13.41],
    ]).addTo(map);
    layer.pm.enable({ allowSelfIntersection: false });

    let fired = '';
    layer.on('pm:vertexadded', () => {
      fired = 'pm:vertexadded';
    });

    const middles = map.getContainer().querySelectorAll('.marker-icon-middle');
    // find the middle marker on the first segment
    const el = middles[0];
    // trace Leaflet routing
    const layerObj = map._targets[L.stamp(el)];
    console.log(
      'layerObj:',
      !!layerObj,
      'listens click:',
      layerObj && layerObj.listens('click', true),
      'draggableMoved:',
      !!(
        layerObj &&
        layerObj.dragging &&
        layerObj.dragging.enabled() &&
        layerObj.dragging.moved()
      )
    );
    layerObj.on('click', () => console.log('leaflet click on middle marker'));
    map.on('click', () => console.log('map click'));
    const container = map.getContainer();
    container.addEventListener('click', (ev) => {
      console.log(
        'container DOM click, target:',
        (ev.target.className || '').toString().slice(0, 50),
        'disableEvents:',
        !!ev.target['_leaflet_disable_events'],
        'isClickDisabled:',
        map._isClickDisabled ? map._isClickDisabled(ev.target) : 'n/a',
        'loaded:',
        map._loaded
      );
    });
    el.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );

    expect(fired).toBe('pm:vertexadded');
  });
});
