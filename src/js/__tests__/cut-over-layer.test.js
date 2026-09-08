// @vitest-environment jsdom
/**
 * Regression (cypress polygon.cy.js hole tests): a Cut drawn with clicks
 * that land ON the polygon body must still reach the map's click handler
 * and cut a hole into the polygon.
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

function domClick(element, containerPoint) {
  const rect = map.getContainer().getBoundingClientRect();
  element.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + containerPoint.x,
      clientY: rect.top + containerPoint.y,
    })
  );
}

describe('cut clicks landing on the polygon body', () => {
  it('still cut the polygon (map click routing)', () => {
    const target = L.polygon([
      [52.54, 13.38],
      [52.54, 13.44],
      [52.48, 13.44],
      [52.48, 13.38],
    ]).addTo(map);

    map.pm.enableGlobalCutMode({ snappable: false });
    const cut = map.pm.Draw.Cut;
    // like the cypress test: a triangle crossing the polygon
    const cutPoints = [
      [52.52, 13.4],
      [52.53, 13.39],
      [52.51, 13.43],
    ].map((ll) => map.latLngToContainerPoint(ll));

    // place vertices by clicking on the polygon's path element (the real
    // browser would hit the polygon body / working layer)
    const pathEl = target.getElement();
    cutPoints.forEach((p) => domClick(pathEl || map.getContainer(), p));
    // finish by clicking the first vertex marker element (a real browser
    // click at that position hits the marker icon)
    const firstLatLng = cut._layer.getLatLngs()[0];
    const markerEls = map
      .getContainer()
      .querySelectorAll('.marker-icon:not(.marker-icon-middle)');
    const firstEl = markerEls[0];
    domClick(
      firstEl || map.getContainer(),
      map.latLngToContainerPoint(firstLatLng)
    );

    const hasHole = target.getLatLngs().length > 1 || !map.hasLayer(target);
    expect(hasHole).toBe(true);
  });
});
