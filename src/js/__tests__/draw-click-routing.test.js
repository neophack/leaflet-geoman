// @vitest-environment jsdom
/**
 * Regression coverage for issue #911: a "hint" marker/shape that follows the
 * cursor while drawing sits exactly under the mouse. If it is left
 * `interactive` (Leaflet's default), a real click hits *it* instead of the
 * map - Leaflet routes the DOM click to whichever registered target the
 * cursor is actually over (see `Map._findEventTargets` /`_fireDOMEvent` in
 * leaflet-src.js), and `L.Marker`/`L.Path` default `bubblingMouseEvents` to
 * false, so the click never reaches the map's own 'click' handler that
 * places a vertex / center / marker. From the outside this looks like
 * "clicking the map to draw does nothing" - draw mode enables fine, no
 * exception is thrown, but nothing ever gets created.
 *
 * Calling internal handlers directly (`draw._createVertex({latlng})`,
 * `map.fire('click', {latlng})`) - the pattern used by the rest of this
 * suite - bypasses that exact routing and would pass even with the bug
 * present. These tests instead dispatch a genuine, bubbling DOM MouseEvent
 * on the actual hint element a real click would hit, so they fail the same
 * way a real user's click does.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

// Dispatches a genuine, bubbling MouseEvent - not map.fire('click', ...) -
// on `el`, so it goes through Leaflet's real DOM event routing
// (Map._findEventTargets) exactly like a physical click would.
function realClick(el, point) {
  el.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
    })
  );
}

function clickHintElement(draw) {
  const hint = draw._hintMarker;
  const el = hint._icon || hint._path;
  if (!el) {
    throw new Error('hint marker has no rendered DOM element to click');
  }
  realClick(el, map.latLngToContainerPoint(hint.getLatLng()));
}

// Marker draw's hint uses Leaflet's default pin icon, anchored at its
// bottom-center point rather than its visual center. jsdom's dispatchEvent
// always resolves to the exact element you call it on, which can't model a
// real browser's pixel-boundary hit-testing at that anchor edge, so it isn't
// covered here - already verified separately against a real Chromium build.
describe('a real click on the cursor-following hint element reaches the map (issue #911)', () => {
  it('places a plain CircleMarker', () => {
    map.pm.Draw.CircleMarker.enable();
    clickHintElement(map.pm.Draw.CircleMarker);
    expect(map.pm.getGeomanDrawLayers()).toHaveLength(1);
    expect(map.pm.getGeomanDrawLayers()[0]).toBeInstanceOf(L.CircleMarker);
  });

  it('places the center of a resizeable Circle, then finishes it on a second click', () => {
    map.pm.Draw.Circle.enable();
    const draw = map.pm.Draw.Circle;

    clickHintElement(draw);
    expect(draw._layerGroup.hasLayer(draw._centerMarker)).toBe(true);

    // move the cursor out to set a radius, then click again to finish
    draw._hintMarker.setLatLng([52.53, 13.42]);
    clickHintElement(draw);

    expect(map.pm.getGeomanDrawLayers()).toHaveLength(1);
    const layer = map.pm.getGeomanDrawLayers()[0];
    expect(layer).toBeInstanceOf(L.Circle);
    expect(layer.getRadius()).toBeGreaterThan(0);
  });

  it('places a resizeable CircleMarker center, then finishes it on a second click', () => {
    map.pm.Draw.CircleMarker.enable({ resizeableCircleMarker: true });
    const draw = map.pm.Draw.CircleMarker;

    clickHintElement(draw);
    expect(draw._layerGroup.hasLayer(draw._centerMarker)).toBe(true);

    draw._hintMarker.setLatLng([52.525, 13.405]);
    clickHintElement(draw);

    expect(map.pm.getGeomanDrawLayers()).toHaveLength(1);
    const layer = map.pm.getGeomanDrawLayers()[0];
    expect(layer).toBeInstanceOf(L.CircleMarker);
    expect(layer.getRadius()).toBeGreaterThan(0);
  });

  it('places the first vertex of a Line', () => {
    map.pm.Draw.Line.enable();
    clickHintElement(map.pm.Draw.Line);
    expect(map.pm.Draw.Line._layer.getLatLngs()).toHaveLength(1);
  });

  it('places the first vertex of a Polygon', () => {
    map.pm.Draw.Polygon.enable();
    clickHintElement(map.pm.Draw.Polygon);
    expect(map.pm.Draw.Polygon._layer.getLatLngs()).toHaveLength(1);
  });

  it('places the first corner of a Rectangle', () => {
    map.pm.Draw.Rectangle.enable();
    clickHintElement(map.pm.Draw.Rectangle);
    expect(
      map.pm.Draw.Rectangle._layerGroup.hasLayer(
        map.pm.Draw.Rectangle._startMarker
      )
    ).toBe(true);
  });

  it('places a Text marker', () => {
    map.pm.Draw.Text.enable();
    clickHintElement(map.pm.Draw.Text);
    expect(map.pm.getGeomanDrawLayers()).toHaveLength(1);
  });
});

describe('click routing with the selection click bound on the DOM element', () => {
  it('places a new Marker when clicking directly on an existing marker icon', () => {
    map.pm.enableDraw('Marker', { snappable: false });
    map.getContainer().dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: 300,
        clientY: 300,
      })
    );
    expect(map.pm.getGeomanDrawLayers()).toHaveLength(1);

    const icon = map.pm.getGeomanDrawLayers()[0].getElement();
    realClick(
      icon,
      map.latLngToContainerPoint(map.pm.getGeomanDrawLayers()[0].getLatLng())
    );
    expect(map.pm.getGeomanDrawLayers()).toHaveLength(2);
  });

  it('selects a layer on a plain DOM click when no mode is active', () => {
    const layer = L.polygon([
      [52.54, 13.38],
      [52.54, 13.44],
      [52.48, 13.44],
      [52.48, 13.38],
    ]).addTo(map);
    realClick(
      layer.getElement(),
      map.latLngToContainerPoint(layer.getCenter())
    );
    expect(map.pm.getSelectedLayers()).toEqual([layer]);
  });
});
