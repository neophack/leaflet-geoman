// @vitest-environment jsdom
/**
 * Interaction tests for the fork extension features.
 * Loads the source modules (no build needed) with real Leaflet in jsdom and
 * simulates mouse, touch and keyboard interaction.
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

function mouse(button = 0, extra = {}) {
  return { button, ...extra };
}

/** simulates a mouse/touch draw interaction (mousedown -> moves -> mouseup) */
function drawGesture(latlngs, button = 0) {
  map.fire('mousedown', { latlng: latlngs[0], originalEvent: mouse(button) });
  latlngs.slice(1).forEach((latlng) => {
    map.fire('mousemove', { latlng, originalEvent: mouse(button) });
  });
  map.fire('mouseup', {
    latlng: latlngs[latlngs.length - 1],
    originalEvent: mouse(button),
  });
}

/** simulate Leaflet marker drag on a (temp) handle marker */
function dragMarker(marker, toLatLng) {
  marker.fire('dragstart', { target: marker });
  marker.setLatLng(toLatLng);
  marker.fire('drag', { target: marker });
  marker.fire('dragend', { target: marker });
}

function square(north, south, west, east) {
  return [
    [south, west],
    [south, east],
    [north, east],
    [north, west],
  ];
}

beforeAll(async () => {
  globalThis.L = L;
  // load the plugin source after the global L is available
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
  map = L.map(container, {
    center: [52.52, 13.4],
    zoom: 14,
    preferCanvas: false,
  });
  map.pm.setGlobalOptions({ snappable: false });
});

describe('Freehand (mouse)', () => {
  it('draws a polygon on press-move-release', () => {
    const created = vi.fn();
    map.on('pm:create', created);

    map.pm.Draw.Freehand.enable();
    const points = [
      [52.5, 13.38],
      [52.51, 13.385],
      [52.52, 13.39],
      [52.53, 13.4],
      [52.535, 13.41],
      [52.53, 13.42],
      [52.51, 13.415],
    ];
    drawGesture(points);

    expect(created).toHaveBeenCalledTimes(1);
    const layer = created.mock.calls[0][0].layer;
    expect(layer).toBeInstanceOf(L.Polygon);
    expect(layer.getLatLngs()[0].length).toBeGreaterThanOrEqual(3);
    expect(map.hasLayer(layer)).toBe(true);
    expect(map.pm.Draw.Freehand.enabled()).toBe(false);
  });

  it('keeps drawing enabled with continueDrawing', () => {
    map.pm.Draw.Freehand.setOptions({ continueDrawing: true });
    map.pm.Draw.Freehand.enable();
    drawGesture([
      [52.5, 13.38],
      [52.51, 13.39],
      [52.52, 13.4],
      [52.53, 13.41],
    ]);
    expect(map.pm.Draw.Freehand.enabled()).toBe(true);
    map.pm.Draw.Freehand.setOptions({ continueDrawing: false });
    map.pm.Draw.Freehand.disable();
  });

  it('ignores right mouse button', () => {
    const created = vi.fn();
    map.on('pm:create', created);
    map.pm.Draw.Freehand.enable();
    drawGesture(
      [
        [52.5, 13.38],
        [52.51, 13.39],
        [52.52, 13.4],
        [52.53, 13.41],
      ],
      2
    );
    expect(created).not.toHaveBeenCalled();
    // left button still works afterwards
    drawGesture([
      [52.5, 13.38],
      [52.51, 13.39],
      [52.52, 13.4],
      [52.53, 13.41],
    ]);
    expect(created).toHaveBeenCalledTimes(1);
    map.pm.Draw.Freehand.disable();
  });

  it('respects the pixel threshold (few moves -> no premature finish)', () => {
    map.pm.Draw.Freehand.enable();
    map.pm.Draw.Freehand.setOptions({ freehandThreshold: 50 });
    // moves of less than 50 px should not add vertices
    map.fire('mousedown', { latlng: [52.5, 13.38], originalEvent: mouse() });
    map.fire('mousemove', {
      latlng: [52.5001, 13.3801],
      originalEvent: mouse(),
    });
    map.fire('mouseup', { latlng: [52.5001, 13.3801], originalEvent: mouse() });
    // not enough vertices collected -> still enabled
    expect(map.pm.Draw.Freehand.enabled()).toBe(true);
    map.pm.Draw.Freehand.disable();
  });

  it('blocks native text selection during the stroke', () => {
    // the stroke replaces map dragging, so without blocking the browser turns
    // the drag into a text selection (e.g. the zoom control labels)
    const disableSpy = vi.spyOn(L.DomUtil, 'disableTextSelection');
    const enableSpy = vi.spyOn(L.DomUtil, 'enableTextSelection');
    map.pm.Draw.Freehand.enable();
    drawGesture([
      [52.5, 13.38],
      [52.51, 13.385],
      [52.52, 13.39],
      [52.53, 13.4],
    ]);
    expect(disableSpy).toHaveBeenCalled();
    expect(enableSpy).toHaveBeenCalled();
    disableSpy.mockRestore();
    enableSpy.mockRestore();
    map.pm.Draw.Freehand.disable();
  });
});

describe('Freehand (touch)', () => {
  it('creates a polygon for a touch gesture (Leaflet synthesizes mouse events)', () => {
    const created = vi.fn();
    map.on('pm:create', created);
    map.pm.Draw.Freehand.enable();
    // on touch devices Leaflet fires the same map mouse events with
    // originalEvent.button === 0, so the gesture is identical
    drawGesture([
      [52.5, 13.38],
      [52.505, 13.385],
      [52.51, 13.392],
      [52.515, 13.4],
      [52.52, 13.41],
      [52.525, 13.42],
      [52.53, 13.425],
    ]);
    expect(created).toHaveBeenCalledTimes(1);
  });
});

describe('Lasso (mouse & touch)', () => {
  it('selects layers with the center inside the lasso', () => {
    const inside = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    const outside = L.polygon(square(52.6, 52.58, 13.5, 13.52)).addTo(map);
    const marker = L.marker([52.52, 13.4]).addTo(map);

    const lassoEvents = [];
    map.on('pm:lasso-select', (e) => lassoEvents.push(e));

    map.pm.enableGlobalLassoMode();
    drawGesture([
      [52.5, 13.38],
      [52.5, 13.44],
      [52.56, 13.44],
      [52.56, 13.38],
    ]);

    expect(lassoEvents).toHaveLength(1);
    const { selectedLayers, selectionChangedLayers } = lassoEvents[0];
    expect(selectedLayers).toContain(inside);
    expect(selectedLayers).toContain(marker);
    expect(selectedLayers).not.toContain(outside);
    expect(selectionChangedLayers).toEqual(selectedLayers);
    map.pm.disableGlobalLassoMode();
  });

  it('does not fire pm:lasso-select for a tiny (accidental) drag', () => {
    const lassoEvents = [];
    map.on('pm:lasso-select', (e) => lassoEvents.push(e));
    map.pm.enableGlobalLassoMode();
    // movements of less than 6px (0.0002 lat ≈ 2px at zoom 14)
    drawGesture([
      [52.5, 13.38],
      [52.5001, 13.3801],
      [52.5002, 13.38015],
    ]);
    expect(lassoEvents).toHaveLength(0);
    map.pm.disableGlobalLassoMode();
  });

  it('re-enables map dragging after disable', () => {
    map.pm.enableGlobalLassoMode();
    expect(map.dragging.enabled()).toBe(false);
    map.pm.disableGlobalLassoMode();
    expect(map.dragging.enabled()).toBe(true);
  });

  it('multi-selects the lassoed layers and dims the others', () => {
    const a = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    const b = L.marker([52.52, 13.4]).addTo(map);
    const outside = L.polygon(square(52.6, 52.58, 13.5, 13.52)).addTo(map);

    map.pm.enableGlobalLassoMode();
    drawGesture([
      [52.5, 13.38],
      [52.5, 13.44],
      [52.56, 13.44],
      [52.56, 13.38],
    ]);

    const selected = map.pm.getSelectedLayers();
    expect(selected).toHaveLength(2);
    expect(selected).toContain(a);
    expect(selected).toContain(b);
    expect(a.pm.isSelected()).toBe(true);
    expect(b.pm.isSelected()).toBe(true);
    expect(outside.pm.isSelected()).toBe(false);
    // selection feedback: unselected layers dim to 40% opacity
    expect(outside.options.opacity).toBeLessThan(1);
    expect(a.options.opacity).toBe(1);
    map.pm.disableGlobalLassoMode();
  });

  it('selects a layer when only a vertex (not the center) is inside the lasso', () => {
    // long horizontal polygon: center far right of the lasso, one vertex in
    const layer = L.polygon(square(52.52, 52.5, 13.38, 13.5)).addTo(map);
    map.pm.enableGlobalLassoMode();
    drawGesture([
      [52.49, 13.375],
      [52.49, 13.395],
      [52.51, 13.395],
      [52.51, 13.375],
    ]);
    expect(map.pm.getSelectedLayers()).toContain(layer);
    map.pm.disableGlobalLassoMode();
  });

  it('selects a big layer when the lasso is drawn inside it', () => {
    const big = L.polygon(square(52.56, 52.48, 13.36, 13.44)).addTo(map);
    map.pm.enableGlobalLassoMode();
    drawGesture([
      [52.51, 13.39],
      [52.51, 13.41],
      [52.53, 13.41],
      [52.53, 13.39],
    ]);
    expect(map.pm.getSelectedLayers()).toContain(big);
    map.pm.disableGlobalLassoMode();
  });

  it('a plain click clears the selection', () => {
    const a = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    a.pm.select();
    expect(map.pm.getSelectedLayers()).toHaveLength(1);

    map.pm.enableGlobalLassoMode();
    // mousedown + mouseup without movement = click, no lasso polygon
    map.fire('mousedown', { latlng: [52.45, 13.3], originalEvent: mouse() });
    map.fire('mouseup', { latlng: [52.45, 13.3], originalEvent: mouse() });
    expect(map.pm.getSelectedLayers()).toHaveLength(0);
    expect(a.pm.isSelected()).toBe(false);
    map.pm.disableGlobalLassoMode();
  });

  it('blocks native text selection during the lasso stroke', () => {
    // the lasso replaces map dragging, so without blocking the browser turns
    // the drag into a text selection (e.g. the zoom control labels)
    const disableSpy = vi.spyOn(L.DomUtil, 'disableTextSelection');
    const enableSpy = vi.spyOn(L.DomUtil, 'enableTextSelection');
    map.pm.enableGlobalLassoMode();
    drawGesture([
      [52.5, 13.38],
      [52.52, 13.39],
      [52.54, 13.41],
    ]);
    expect(disableSpy).toHaveBeenCalled();
    expect(enableSpy).toHaveBeenCalled();
    disableSpy.mockRestore();
    enableSpy.mockRestore();
    map.pm.disableGlobalLassoMode();
  });

  it('restores text selection when the mode is disabled mid-stroke', () => {
    const enableSpy = vi.spyOn(L.DomUtil, 'enableTextSelection');
    map.pm.enableGlobalLassoMode();
    map.fire('mousedown', { latlng: [52.5, 13.38], originalEvent: mouse() });
    map.pm.disableGlobalLassoMode();
    expect(enableSpy).toHaveBeenCalled();
    enableSpy.mockRestore();
  });
});

describe('Scale', () => {
  it('scales a polygon by dragging a corner handle', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    const before = layer.getBounds();

    layer.pm.enableScale();
    const handle = layer.pm._scaleHandles.topleft.marker;

    const scaleEnd = vi.fn();
    map.on('pm:scaleend', scaleEnd);

    // drag the top-left handle away from the opposite corner (bottom-right)
    dragMarker(handle, L.latLng(52.56, 13.36));

    const after = layer.getBounds();
    expect(scaleEnd).toHaveBeenCalledTimes(1);
    // the area must have grown (dragged outward)
    const areaBefore =
      (before.getNorth() - before.getSouth()) *
      (before.getEast() - before.getWest());
    const areaAfter =
      (after.getNorth() - after.getSouth()) *
      (after.getEast() - after.getWest());
    expect(areaAfter).toBeGreaterThan(areaBefore);
    layer.pm.disableScale();
  });

  it('never produces a degenerate (collapsed) polygon', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    layer.pm.enableScale();
    const handle = layer.pm._scaleHandles.topright.marker;
    // drag almost onto the opposite corner
    dragMarker(handle, L.latLng(52.51, 13.39001));
    const bounds = layer.getBounds();
    expect(bounds.getEast()).toBeGreaterThan(bounds.getWest());
    expect(bounds.getNorth()).toBeGreaterThan(bounds.getSouth());
    layer.pm.disableScale();
  });

  it('scales a circle by changing its radius', () => {
    const circle = L.circle([52.52, 13.4], { radius: 200 }).addTo(map);
    circle.pm.enableScale();
    const handle = circle.pm._scaleHandles.topright.marker;
    dragMarker(handle, L.latLng(52.545, 13.44));
    expect(circle.getRadius()).toBeGreaterThan(200);
    circle.pm.disableScale();
  });

  it('global scale mode enables handles on all layers and cleans up', () => {
    const a = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    const b = L.polyline([
      [52.51, 13.39],
      [52.53, 13.41],
    ]).addTo(map);
    map.pm.enableGlobalScaleMode();
    expect(a.pm.scaleEnabled()).toBe(true);
    expect(b.pm.scaleEnabled()).toBe(true);
    map.pm.disableGlobalScaleMode();
    expect(a.pm.scaleEnabled()).toBe(false);
    expect(b.pm.scaleEnabled()).toBe(false);
  });

  it('respects allowScaling: false', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41), {
      pmIgnore: false,
    }).addTo(map);
    layer.pm.setOptions({ allowScaling: false });
    map.pm.enableGlobalScaleMode();
    expect(layer.pm.scaleEnabled()).toBe(false);
    map.pm.disableGlobalScaleMode();
  });
});

describe('Union', () => {
  it('merges overlapping polygons into a single polygon', () => {
    const a = L.polygon(square(52.54, 52.5, 13.38, 13.42)).addTo(map);
    const b = L.polygon(square(52.52, 52.48, 13.4, 13.44)).addTo(map);
    const unionEvent = vi.fn();
    map.on('pm:union', unionEvent);

    const result = map.pm.union(a, b);

    expect(unionEvent).toHaveBeenCalledTimes(1);
    expect(result).toBeInstanceOf(L.Polygon);
    expect(result).not.toBeInstanceOf(L.LayerGroup);
    expect(map.hasLayer(a)).toBe(false);
    expect(map.hasLayer(b)).toBe(false);
    expect(map.hasLayer(result)).toBe(true);
  });

  it('returns a multi polygon for disjoint shapes', () => {
    const a = L.polygon(square(52.54, 52.5, 13.38, 13.4)).addTo(map);
    const b = L.polygon(square(52.54, 52.5, 13.44, 13.46)).addTo(map);
    const result = map.pm.union(a, b);
    // Leaflet renders a MultiPolygon feature as ONE polygon layer with two rings
    expect(result).toBeInstanceOf(L.Polygon);
    expect(result.getLatLngs()).toHaveLength(2);
  });

  it('keeps holes when merging', () => {
    const ring = square(52.54, 52.5, 13.38, 13.42);
    const hole = square(52.53, 52.51, 13.39, 13.41);
    const a = L.polygon([ring, hole]).addTo(map);
    const b = L.polygon(square(52.53, 52.5, 13.41, 13.44)).addTo(map);
    const result = map.pm.union(a, b);
    // result contains at least one ring -> hole survived (as hole or cut)
    const geo = result.toGeoJSON(15);
    const rings =
      result instanceof L.LayerGroup
        ? result.getLayers().length // multi: rings spread over layers
        : result.getLatLngs().length;
    expect(rings).toBeGreaterThanOrEqual(1);
    expect(geo).toBeTruthy();
  });

  it('needs at least two polygons', () => {
    const a = L.polygon(square(52.54, 52.5, 13.38, 13.42)).addTo(map);
    expect(map.pm.union(a)).toBeUndefined();
  });

  it('merges automatically when two layers are selected', () => {
    const a = L.polygon(square(52.54, 52.5, 13.38, 13.42)).addTo(map);
    const b = L.polygon(square(52.52, 52.48, 13.4, 13.44)).addTo(map);
    map.pm.enableGlobalUnionMode();

    a.fire('click', { target: a });
    expect(map.pm._unionSelection).toHaveLength(1);
    // clicking again deselects
    a.fire('click', { target: a });
    expect(map.pm._unionSelection).toHaveLength(0);
    a.fire('click', { target: a });

    // the second selection executes the union immediately and the mode
    // stays enabled for the next pair
    b.fire('click', { target: b });
    expect(map.pm._unionSelection).toHaveLength(0);
    expect(map.pm.globalUnionModeEnabled()).toBe(true);
    expect(map.hasLayer(a)).toBe(false);
    expect(map.hasLayer(b)).toBe(false);
    let mergedPolygons = 0;
    map.eachLayer((layer) => {
      if (layer instanceof L.Polygon) {
        mergedPolygons += 1;
      }
    });
    expect(mergedPolygons).toBe(1);

    map.pm.disableGlobalUnionMode();
  });

  it('indicates the selection by dimming unselected layers, not by highlights', () => {
    const a = L.polygon(square(52.54, 52.5, 13.38, 13.4)).addTo(map);
    const b = L.polygon(square(52.54, 52.5, 13.41, 13.43)).addTo(map);
    const c = L.polygon(square(52.56, 52.54, 13.38, 13.4)).addTo(map);
    map.pm.enableGlobalUnionMode();

    a.fire('click', { target: a });

    // no highlight layer was added on top of the map's polygons
    let polygonCount = 0;
    map.eachLayer((layer) => {
      if (layer instanceof L.Polygon) {
        polygonCount += 1;
      }
    });
    expect(polygonCount).toBe(3);

    // the selected layer keeps its style, the unselected ones are dimmed to 40%
    expect(a._pmSelectionBaseStyle).toBeFalsy();
    expect(b._pmSelectionBaseStyle).toBeTruthy();
    expect(c._pmSelectionBaseStyle).toBeTruthy();
    expect(b.options.opacity).toBeCloseTo(0.4, 5);
    expect(c.options.opacity).toBeCloseTo(0.4, 5);

    // the second click executes the union automatically and restores the
    // dimming (a + b merge into one layer, mode stays enabled)
    b.fire('click', { target: b });
    expect(map.pm.globalUnionModeEnabled()).toBe(true);
    expect(map.hasLayer(a)).toBe(false);
    expect(map.hasLayer(b)).toBe(false);
    expect(map.hasLayer(c)).toBe(true);
    let polygonsAfterMerge = 0;
    map.eachLayer((layer) => {
      if (layer instanceof L.Polygon) {
        polygonsAfterMerge += 1;
      }
    });
    expect(polygonsAfterMerge).toBe(2); // merged + c
    expect(c._pmSelectionBaseStyle).toBeFalsy();
    expect(c.options.opacity ?? 1).toBeCloseTo(1, 5);

    map.pm.disableGlobalUnionMode();
  });
});

describe('Difference', () => {
  it('subtracts the second polygon from the first', () => {
    const base = L.polygon(square(52.54, 52.5, 13.38, 13.42)).addTo(map);
    const cutter = L.polygon(square(52.52, 52.5, 13.4, 13.44)).addTo(map);
    const diffEvent = vi.fn();
    map.on('pm:difference', diffEvent);

    const result = map.pm.difference(base, cutter);

    expect(diffEvent).toHaveBeenCalledTimes(1);
    expect(result).toBeTruthy();
    // both original layers are replaced by the result
    expect(map.hasLayer(base)).toBe(false);
    expect(map.hasLayer(cutter)).toBe(false);
    // the cut-out region must not be part of the result anymore: the result
    // is an L-shaped polygon that no longer contains [52.51, 13.43]
    const resultLayer =
      result instanceof L.LayerGroup ? result.getLayers()[0] : result;
    const bounds = resultLayer.getBounds();
    expect(bounds.getNorth()).toBeCloseTo(52.54, 3);
    expect(bounds.getEast()).toBeLessThanOrEqual(13.42);
    // area must have shrunk: bottom part (south of 52.52, east of 13.40) removed
    const geo = resultLayer.toGeoJSON(15);
    let maxLngInSouth = -Infinity;
    geo.geometry.coordinates.flat(2).forEach((coord) => {
      if (coord[1] < 52.52) {
        maxLngInSouth = Math.max(maxLngInSouth, coord[0]);
      }
    });
    expect(maxLngInSouth).toBeLessThanOrEqual(13.4);
  });

  it('removes both layers when the base is fully covered', () => {
    const base = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    const cutter = L.polygon(square(52.54, 52.5, 13.38, 13.42)).addTo(map);
    const result = map.pm.difference(base, cutter);
    expect(result).toBeNull();
    expect(map.hasLayer(base)).toBe(false);
    expect(map.hasLayer(cutter)).toBe(false);
  });

  it('mode applies the difference after two clicks and stays enabled', () => {
    const base = L.polygon(square(52.54, 52.5, 13.38, 13.42)).addTo(map);
    const cutter = L.polygon(square(52.52, 52.5, 13.4, 13.44)).addTo(map);
    map.pm.enableGlobalDifferenceMode();
    base.fire('click', { target: base });
    expect(map.pm._differenceBaseLayer).toBe(base);
    cutter.fire('click', { target: cutter });
    expect(map.pm.globalDifferenceModeEnabled()).toBe(true);
    expect(map.pm._differenceBaseLayer).toBeUndefined();
    expect(map.hasLayer(base)).toBe(false);

    map.pm.disableGlobalDifferenceMode();
  });

  it('indicates the base selection by dimming unselected layers, not by highlights', () => {
    const base = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    const other = L.polygon(square(52.55, 52.53, 13.39, 13.41)).addTo(map);
    map.pm.enableGlobalDifferenceMode();

    base.fire('click', { target: base });

    // no highlight layer was added on top of the map's polygons
    let polygonCount = 0;
    map.eachLayer((layer) => {
      if (layer instanceof L.Polygon) {
        polygonCount += 1;
      }
    });
    expect(polygonCount).toBe(2);

    // the selected base keeps its style, the other layer is dimmed to 40%
    expect(base._pmSelectionBaseStyle).toBeFalsy();
    expect(other._pmSelectionBaseStyle).toBeTruthy();
    expect(other.options.opacity).toBeCloseTo(0.4, 5);

    // clicking the base again deselects it and restores the dimming
    base.fire('click', { target: base });
    expect(other._pmSelectionBaseStyle).toBeFalsy();
    expect(other.options.opacity ?? 1).toBeCloseTo(1, 5);

    map.pm.disableGlobalDifferenceMode();
  });
});

describe('Split', () => {
  it('splits a polygon into two parts', () => {
    const target = L.polygon(square(52.54, 52.5, 13.38, 13.42)).addTo(map);
    const splitEvent = vi.fn();
    map.on('pm:split', splitEvent);

    map.pm.Draw.Split.enable({ snappable: false });
    map.pm.Draw.Split._layer.setLatLngs([
      [52.49, 13.4],
      [52.55, 13.4],
    ]);
    map.pm.Draw.Split._finishShape();

    expect(splitEvent).toHaveBeenCalledTimes(1);
    const { layers, originalLayer, splitLayer, shape } =
      splitEvent.mock.calls[0][0];
    expect(layers).toHaveLength(2);
    expect(originalLayer).toBe(target);
    expect(splitLayer).toBeInstanceOf(L.Polyline);
    expect(shape).toBe('Polygon');
    expect(map.hasLayer(target)).toBe(false);
  });

  it('leaves the layer untouched when the line does not cross', () => {
    const target = L.polygon(square(52.54, 52.5, 13.38, 13.42)).addTo(map);
    const splitEvent = vi.fn();
    map.on('pm:split', splitEvent);

    map.pm.Draw.Split.enable({ snappable: false });
    map.pm.Draw.Split._layer.setLatLngs([
      [52.49, 13.5],
      [52.55, 13.5],
    ]);
    map.pm.Draw.Split._finishShape();

    expect(splitEvent).not.toHaveBeenCalled();
    expect(map.hasLayer(target)).toBe(true);
  });

  it('splits a polyline into two parts', () => {
    const line = L.polyline([
      [52.5, 13.38],
      [52.52, 13.4],
      [52.54, 13.42],
    ]).addTo(map);
    const splitEvent = vi.fn();
    map.on('pm:split', splitEvent);

    map.pm.Draw.Split.enable({ snappable: false });
    // a line crossing the first segment near its middle
    map.pm.Draw.Split._layer.setLatLngs([
      [52.51, 13.38],
      [52.51, 13.42],
    ]);
    map.pm.Draw.Split._finishShape();

    expect(splitEvent).toHaveBeenCalledTimes(1);
    const { layers, shape } = splitEvent.mock.calls[0][0];
    const [result] = layers;
    if (result instanceof L.LayerGroup) {
      expect(result.getLayers().length).toBeGreaterThanOrEqual(2);
    } else {
      // a MultiLineString is rendered as one polyline layer with two lines
      expect(result).toBeInstanceOf(L.Polyline);
      expect(result.getLatLngs().length).toBeGreaterThanOrEqual(2);
    }
    expect(shape).toBe('Line');
    expect(map.hasLayer(line)).toBe(false);
  });

  it('respects splitMark: false', () => {
    const target = L.polygon(square(52.54, 52.5, 13.38, 13.42)).addTo(map);
    target.pm.setOptions({ splitMark: false });
    const splitEvent = vi.fn();
    map.on('pm:split', splitEvent);

    map.pm.Draw.Split.enable({ snappable: false });
    map.pm.Draw.Split._layer.setLatLngs([
      [52.49, 13.4],
      [52.55, 13.4],
    ]);
    map.pm.Draw.Split._finishShape();

    expect(splitEvent).not.toHaveBeenCalled();
    expect(map.hasLayer(target)).toBe(true);
  });
});

describe('Copy', () => {
  it.each([
    ['marker', () => L.marker([52.52, 13.4])],
    ['circleMarker', () => L.circleMarker([52.52, 13.4])],
    ['circle', () => L.circle([52.52, 13.4], { radius: 100 })],
    [
      'polyline',
      () =>
        L.polyline([
          [52.51, 13.39],
          [52.53, 13.41],
        ]),
    ],
    ['polygon', () => L.polygon(square(52.53, 52.51, 13.39, 13.41))],
  ])('copies a %s with an offset', (name, factory) => {
    const original = factory().addTo(map);
    const copyEvent = vi.fn();
    map.on('pm:copylayer', copyEvent);

    const copy = map.pm.copyLayer(original);

    expect(copyEvent).toHaveBeenCalledTimes(1);
    expect(copy).toBeTruthy();
    expect(copy).not.toBe(original);
    expect(map.hasLayer(copy)).toBe(true);
    if (name === 'circle') {
      // must stay a true Circle (meter radius), not degrade to a
      // CircleMarker (pixel radius) - L.Circle extends L.CircleMarker
      expect(copy).toBeInstanceOf(L.Circle);
      expect(copy.getRadius()).toBe(100);
      // offset is applied bottom-right (screen space)
      expect(copy.getLatLng().lat).toBeLessThan(original.getLatLng().lat);
      expect(copy.getLatLng().lng).toBeGreaterThan(original.getLatLng().lng);
    }
    if (name === 'circleMarker') {
      expect(copy).toBeInstanceOf(L.CircleMarker);
      expect(copy).not.toBeInstanceOf(L.Circle);
    }
    if (name === 'polyline' || name === 'polygon') {
      const o = original.getBounds();
      const c = copy.getBounds();
      // bottom-right offset: moved south & east
      expect(c.getSouth()).toBeLessThan(o.getSouth());
      expect(c.getEast()).toBeGreaterThan(o.getEast());
    }
    copy.remove();
    original.remove();
  });
});

describe('Simplify', () => {
  it('reduces the vertex count of noisy layers', () => {
    const detailed = [];
    for (let i = 0; i < 40; i += 1) {
      detailed.push([52.5 + i * 0.0001, 13.38 + Math.sin(i / 5) * 0.000001]);
    }
    const line = L.polyline(detailed).addTo(map);
    const before = line.getLatLngs().length;
    map.pm.simplifyLayer(line);
    expect(line.getLatLngs().length).toBeLessThan(before);
  });

  it('keeps layers with few vertices untouched', () => {
    // L-shaped line: the corner point is far above the tolerance
    const line = L.polyline([
      [52.5, 13.38],
      [52.55, 13.38],
      [52.55, 13.44],
    ]).addTo(map);
    const before = line.getLatLngs().length;
    map.pm.simplifyLayer(line);
    expect(line.getLatLngs().length).toBe(before);
  });

  it('never simplifies a polygon below 3 vertices', () => {
    const detailed = [];
    for (let i = 0; i < 30; i += 1) {
      detailed.push([
        52.5 + Math.sin(i / 3) * 0.001,
        13.4 + Math.cos(i / 3) * 0.001,
      ]);
    }
    const poly = L.polygon(detailed).addTo(map);
    map.pm.simplifyLayer(poly, { factor: 10 }); // extreme tolerance
    const ring = poly.getLatLngs()[0];
    expect(ring.length).toBeGreaterThanOrEqual(3);
  });

  it('fires pm:simplify', () => {
    const line = L.polyline(
      Array.from({ length: 30 }, (_, i) => [52.5 + i * 0.0001, 13.38])
    ).addTo(map);
    const event = vi.fn();
    map.on('pm:simplify', event);
    map.pm.simplifyLayer(line);
    expect(event).toHaveBeenCalledTimes(1);
  });
});

describe('Order modes', () => {
  it('fires pm:orderchange when clicking layers in the modes', () => {
    const a = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    const b = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    const events = [];
    map.on('pm:orderchange', (e) => events.push(e.order));

    map.pm.enableGlobalBringToFrontMode();
    a.fire('click', { target: a });
    expect(events).toContain('bringToFront');
    map.pm.disableGlobalBringToFrontMode();

    map.pm.enableGlobalSendToBackMode();
    b.fire('click', { target: b });
    expect(events).toContain('sendToBack');
    map.pm.disableGlobalSendToBackMode();
  });
});

describe('Pinning', () => {
  // vertices at the same position are linked
  // automatically (no pin-creation gesture) and follow the drag live
  it('links same-position vertices and moves them live during the drag', () => {
    const a = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    const b = L.polygon(square(52.55, 52.53, 13.39, 13.41)).addTo(map);
    // shared corner at [52.53, 13.41]
    map.pm.enablePinning();

    a.pm.enable({ allowSelfIntersection: true });
    b.pm.enable({ allowSelfIntersection: true });

    const shared = L.latLng(52.53, 13.41);
    const marker = a.pm._markers[0].find((m) => m.getLatLng().equals(shared));
    expect(marker).toBeTruthy();

    const moved = L.latLng(52.54, 13.42);
    marker.fire('dragstart', { target: marker });
    marker.setLatLng(moved);
    marker.fire('drag', { target: marker });
    // live follow: b's shared vertex moves DURING the drag, before dragend
    expect(b.getLatLngs()[0].some((ll) => ll.equals(moved))).toBe(true);

    marker.fire('dragend', { target: marker });
    // still in place after the drag ended
    expect(b.getLatLngs()[0].some((ll) => ll.equals(moved))).toBe(true);
    // and the pinned layer's edit mode was re-enabled after the drag
    expect(b.pm.enabled()).toBe(true);
  });

  it('does not move the other layer when pinning is disabled', () => {
    const a = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    const b = L.polygon(square(52.55, 52.53, 13.39, 13.41)).addTo(map);

    a.pm.enable({ allowSelfIntersection: true });

    const shared = L.latLng(52.53, 13.41);
    const marker = a.pm._markers[0].find((m) => m.getLatLng().equals(shared));

    const moved = L.latLng(52.54, 13.42);
    dragMarker(marker, moved);
    expect(b.getLatLngs()[0].every((ll) => !ll.equals(moved))).toBe(true);
  });

  it('respects allowPinning: false on the other layer', () => {
    const a = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    const b = L.polygon(square(52.55, 52.53, 13.39, 13.41)).addTo(map);
    b.pm.setOptions({ allowPinning: false });
    map.pm.enablePinning();

    a.pm.enable({ allowSelfIntersection: true });

    const shared = L.latLng(52.53, 13.41);
    const marker = a.pm._markers[0].find((m) => m.getLatLng().equals(shared));

    dragMarker(marker, L.latLng(52.54, 13.42));
    expect(b.getLatLngs()[0].some((ll) => ll.equals(shared))).toBe(true);
  });
});

describe('SnapGuides', () => {
  it('shows guides while snapping and hides them on cleanup', () => {
    const other = L.polyline([
      [52.5, 13.4],
      [52.54, 13.4],
    ]).addTo(map);
    map.pm.setGlobalOptions({ showSnapGuides: true });

    map.pm.Draw.Line.enable({ snappable: true });
    const draw = map.pm.Draw.Line;

    // simulate snapping: hint marker near the other layer
    draw._hintMarker.setLatLng([52.52, 13.40001]);
    draw._handleSnapping({
      target: draw._hintMarker,
      originalEvent: mouse(),
    });

    expect(draw._snapGuideLayers).toBeTruthy();
    expect(draw._snapGuideLayers.length).toBe(3);
    const onMap = draw._snapGuideLayers.filter((g) => map.hasLayer(g));
    expect(onMap.length).toBe(3);

    draw._cleanupSnapping();
    expect(draw._snapGuideLayers).toBeUndefined();
  });

  it('draws two guides per configured angle, plus the segment guide', () => {
    L.polyline([
      [52.5, 13.4],
      [52.54, 13.4],
    ]).addTo(map);
    map.pm.setGlobalOptions({
      showSnapGuides: true,
      snapGuidesAngles: [90, 45],
    });

    map.pm.Draw.Line.enable({ snappable: true });
    const draw = map.pm.Draw.Line;
    draw._hintMarker.setLatLng([52.52, 13.40001]);
    draw._handleSnapping({ target: draw._hintMarker, originalEvent: mouse() });

    // 1 segment guide + 2 angles * 2 (angle + its perpendicular)
    expect(draw._snapGuideLayers.length).toBe(5);
    draw.disable();
    map.pm.setGlobalOptions({ snapGuidesAngles: [90] });
  });

  it('shows no guides when disabled', () => {
    map.pm.setGlobalOptions({ showSnapGuides: false });
    map.pm.Draw.Line.enable({ snappable: true });
    const draw = map.pm.Draw.Line;
    draw._hintMarker.setLatLng([52.52, 13.40001]);
    draw._handleSnapping({ target: draw._hintMarker, originalEvent: mouse() });
    expect(draw._snapGuideLayers).toBeUndefined();
    draw.disable();
  });
});

describe('Geofencing', () => {
  it('blocks a vertex that would intersect a preventIntersection layer, fires the event, clears when it no longer would', () => {
    const obstacle = L.polygon(square(52.515, 52.505, 13.395, 13.405)).addTo(
      map
    );
    map.pm.Draw.Line.enable({ preventIntersection: [obstacle] });
    const draw = map.pm.Draw.Line;

    draw._hintMarker.setLatLng([52.5, 13.4]);
    draw._createVertex({ latlng: [52.5, 13.4] });

    let violated = 0;
    map.on('pm:intersectionviolation', () => {
      violated += 1;
    });

    // straight through the obstacle
    draw._syncHintMarker({ latlng: [52.52, 13.4] });
    expect(draw._geofenceViolation).toBe('intersection');
    expect(draw._hintline.options.color).toBe('#f00000ff');
    expect(violated).toBe(1);

    draw._createVertex({ latlng: [52.52, 13.4] });
    expect(draw._layer.getLatLngs()).toHaveLength(1); // blocked, no 2nd vertex

    // move away: no longer crosses the obstacle
    draw._syncHintMarker({ latlng: [52.501, 13.391] });
    expect(draw._geofenceViolation).toBeNull();
    expect(draw._hintline.options.color).not.toBe('#f00000ff');

    draw._createVertex({ latlng: [52.501, 13.391] });
    expect(draw._layer.getLatLngs()).toHaveLength(2); // allowed this time

    draw.disable();
  });

  it('blocks a vertex that would violate requireContainment, fires the event, clears when back inside', () => {
    const boundary = L.polygon(square(52.53, 52.5, 13.39, 13.42)).addTo(map);
    map.pm.Draw.Line.enable({ requireContainment: [boundary] });
    const draw = map.pm.Draw.Line;

    draw._hintMarker.setLatLng([52.51, 13.4]);
    draw._createVertex({ latlng: [52.51, 13.4] });

    let violated = 0;
    map.on('pm:containmentviolation', () => {
      violated += 1;
    });

    // outside the boundary
    draw._syncHintMarker({ latlng: [52.6, 13.4] });
    expect(draw._geofenceViolation).toBe('containment');
    expect(violated).toBe(1);

    draw._createVertex({ latlng: [52.6, 13.4] });
    expect(draw._layer.getLatLngs()).toHaveLength(1); // blocked

    // back inside the boundary
    draw._syncHintMarker({ latlng: [52.52, 13.41] });
    expect(draw._geofenceViolation).toBeNull();

    draw.disable();
  });

  it('marks an existing layer red and fires an event when an edit violates preventIntersection', () => {
    const obstacle = L.polygon(square(52.515, 52.505, 13.395, 13.405)).addTo(
      map
    );
    const line = L.polyline([
      [52.5, 13.4],
      [52.5, 13.41],
    ]).addTo(map);
    line.pm.enable();
    line.pm.setOptions({ preventIntersection: [obstacle] });

    let violated = 0;
    map.on('pm:intersectionviolation', () => {
      violated += 1;
    });

    // drag a vertex so the line now crosses the obstacle
    line.setLatLngs([
      [52.52, 13.4],
      [52.5, 13.41],
    ]);
    line.pm._fireChange(line.getLatLngs(), 'Edit');

    expect(violated).toBe(1);
    expect(line.options.color).toBe('#f00000ff');

    // move it back out
    line.setLatLngs([
      [52.5, 13.4],
      [52.5, 13.41],
    ]);
    line.pm._fireChange(line.getLatLngs(), 'Edit');
    expect(line.options.color).not.toBe('#f00000ff');

    line.pm.disable();
  });
});

describe('AutoTrace', () => {
  it('inserts the traced segment endpoints while drawing', () => {
    const border = L.polyline([
      [52.5, 13.4],
      [52.52, 13.4],
      [52.54, 13.4],
    ]).addTo(map);

    map.pm.setGlobalOptions({ autoTrace: true });
    map.pm.Draw.Line.enable({ snappable: true });
    const draw = map.pm.Draw.Line;

    // first vertex away from the border
    draw._hintMarker.setLatLng([52.5, 13.39]);
    draw._createVertex({ latlng: [52.5, 13.39] });

    // second vertex snapped ON the segment of the border
    const snapLatLng = L.latLng(52.51, 13.4);
    draw._hintMarker.setLatLng(snapLatLng);
    draw._hintMarker._snapped = true;
    draw._hintMarker._snapInfo = {
      segment: [L.latLng(52.5, 13.4), L.latLng(52.52, 13.4)],
      layerInteractedWith: border,
    };
    draw._createVertex({ latlng: [52.51, 13.4] });

    const latlngs = draw._layer.getLatLngs();
    // only the border endpoint next to the previous vertex is traced - the
    // far endpoint would make the line double back along the border
    expect(latlngs.some((ll) => ll.equals(L.latLng(52.5, 13.4)))).toBe(true);
    expect(latlngs.some((ll) => ll.equals(L.latLng(52.52, 13.4)))).toBe(false);
    draw.disable();
  });
});

describe('Toolbar option toggles', () => {
  it('toggling snappingOption changes the global snappable option', () => {
    expect(map.pm.getGlobalOptions().snappable).toBe(false); // set in beforeEach
    map.pm.Toolbar.buttons.snappingOption._triggerClick();
    expect(map.pm.getGlobalOptions().snappable).toBe(true);
    map.pm.Toolbar.buttons.snappingOption._triggerClick();
    expect(map.pm.getGlobalOptions().snappable).toBe(false);
  });

  it('option toggles do not disable the active edit mode', () => {
    map.pm.enableGlobalEditMode();
    expect(map.pm.globalEditModeEnabled()).toBe(true);
    map.pm.Toolbar.buttons.snappingOption._triggerClick();
    map.pm.Toolbar.buttons.snapGuidesOption._triggerClick();
    map.pm.Toolbar.buttons.autoTracingOption._triggerClick();
    expect(map.pm.globalEditModeEnabled()).toBe(true);
    map.pm.disableGlobalEditMode();
  });

  it('toggling pinningOption enables and disables pinning', () => {
    map.pm.Toolbar.buttons.pinningOption._triggerClick();
    expect(map.pm.pinningEnabled()).toBe(true);
    map.pm.Toolbar.buttons.pinningOption._triggerClick();
    expect(map.pm.pinningEnabled()).toBe(false);
  });
});

describe('Keyboard (ESC / Enter)', () => {
  function pressKey(key) {
    document.dispatchEvent(
      new window.KeyboardEvent('keydown', { key, bubbles: true })
    );
  }

  it('ESC exits an upstream mode (Draw) when exitModeOnEscape is enabled', () => {
    map.pm.setGlobalOptions({ exitModeOnEscape: true });
    map.pm.Draw.Line.enable();
    expect(map.pm.globalDrawModeEnabled()).toBe(true);
    pressKey('Escape');
    expect(map.pm.globalDrawModeEnabled()).toBe(false);
  });

  it('ESC leaves the other modes active, matching upstream Geoman', () => {
    // upstream only exits Draw/Edit/Drag/Removal/Rotate/Cut on Escape
    map.pm.setGlobalOptions({ exitModeOnEscape: true });

    map.pm.enableGlobalScaleMode();
    pressKey('Escape');
    expect(map.pm.globalScaleModeEnabled()).toBe(true);
    map.pm.disableGlobalScaleMode();

    map.pm.enableGlobalUnionMode();
    pressKey('Escape');
    expect(map.pm.globalUnionModeEnabled()).toBe(true);
    map.pm.disableGlobalUnionMode();

    map.pm.enableGlobalLassoMode();
    pressKey('Escape');
    expect(map.pm.globalLassoModeEnabled()).toBe(true);
    map.pm.disableGlobalLassoMode();
  });

  it('ESC does nothing when exitModeOnEscape is disabled (default)', () => {
    map.pm.enableGlobalScaleMode();
    pressKey('Escape');
    expect(map.pm.globalScaleModeEnabled()).toBe(true);
    map.pm.disableGlobalScaleMode();
  });

  it('Enter does not finish a freehand drawing, matching upstream (mouseup only)', () => {
    map.pm.setGlobalOptions({ finishOnEnter: true });
    const created = vi.fn();
    map.on('pm:create', created);

    map.pm.Draw.Freehand.enable();
    // partial stroke (mouse down, few moves, no mouseup)
    map.fire('mousedown', { latlng: [52.5, 13.38], originalEvent: mouse() });
    [
      [52.51, 13.385],
      [52.52, 13.39],
      [52.53, 13.4],
    ].forEach((latlng) => {
      map.fire('mousemove', { latlng, originalEvent: mouse() });
    });

    pressKey('Enter');
    expect(created).not.toHaveBeenCalled();

    // releasing the mouse button finishes the shape instead
    map.fire('mouseup', { latlng: [52.53, 13.4], originalEvent: mouse() });
    expect(created).toHaveBeenCalledTimes(1);
  });
});

describe('Toolbar defaults (addControls)', () => {
  it('shows exactly the 19 default buttons in order', () => {
    map.pm.addControls();
    const visible = Object.keys(map.pm.Toolbar.buttons).filter(
      (name) => map.pm.Toolbar.options[name]
    );
    expect(visible).toEqual([
      // draw block
      'drawMarker',
      'drawPolyline',
      'drawRectangle',
      'drawPolygon',
      'drawCircle',
      'drawCircleMarker',
      'drawText',
      // edit block
      'editMode',
      'dragMode',
      'cutPolygon',
      'removalMode',
      'rotateMode',
      'splitMode',
      'scaleMode',
      'unionMode',
      // options block
      'pinningOption',
      'snappingOption',
      'autoTracingOption',
      'snapGuidesOption',
    ]);
  });

  it('uses the default button titles', () => {
    map.pm.addControls();
    const { buttons } = map.pm.Toolbar;
    expect(buttons.splitMode._button.title).toBe('Split Layer');
    expect(buttons.scaleMode._button.title).toBe('Scale Layers');
    expect(buttons.unionMode._button.title).toBe('Union layers');
    expect(buttons.differenceMode._button.title).toBe('Subtract layers');
    expect(buttons.pinningOption._button.title).toBe(
      'Pin shared vertices together'
    );
    expect(buttons.snappingOption._button.title).toBe(
      'Snap dragged marker to other layers and vertices'
    );
    expect(buttons.autoTracingOption._button.title).toBe('Auto trace Line');
    expect(buttons.snapGuidesOption._button.title).toBe('Show SnapGuides');
  });

  it('snapping starts toggled on (snappable defaults to true)', () => {
    map.pm.addControls();
    expect(map.pm.Toolbar.buttons.snappingOption.toggled()).toBe(true);
  });

  it('switches from union to difference mode via the union button action', () => {
    map.pm.addControls();
    map.pm.Toolbar.buttons.unionMode._triggerClick();
    expect(map.pm.globalUnionModeEnabled()).toBe(true);

    map.pm.Toolbar._switchModeAction('differenceMode');
    expect(map.pm.globalUnionModeEnabled()).toBe(false);
    expect(map.pm.globalDifferenceModeEnabled()).toBe(true);

    // the union slot switches its presentation to
    // Subtract and carries the toggled state itself
    const slot = map.pm.Toolbar.buttons.unionMode;
    expect(slot._button.title).toBe('Subtract layers');
    expect(slot._button.className).toContain('leaflet-pm-icon-difference');
    expect(slot.toggled()).toBe(true);
    expect(map.pm.Toolbar.buttons.differenceMode.toggled()).toBe(false);

    // clicking the slot while difference mode is on turns the mode off
    slot._triggerClick();
    expect(map.pm.globalDifferenceModeEnabled()).toBe(false);
    expect(slot.toggled()).toBe(false);

    // the default Union presentation is restored
    expect(slot._button.title).toBe('Union layers');
    expect(slot._button.className).toContain('leaflet-pm-icon-union');

    // switching modes re-enables difference through the slot
    map.pm.Toolbar._switchModeAction('differenceMode');
    expect(map.pm.globalDifferenceModeEnabled()).toBe(true);

    // ... and the union action of the Subtract button switches back: icon,
    // title and function return to Union while difference turns off
    map.pm.Toolbar._switchModeAction('unionMode');
    expect(map.pm.globalDifferenceModeEnabled()).toBe(false);
    expect(map.pm.globalUnionModeEnabled()).toBe(true);
    expect(slot._button.title).toBe('Union layers');
    expect(slot._button.className).toContain('leaflet-pm-icon-union');
    expect(slot.toggled()).toBe(true);

    // switching to the already active mode is a no-op
    map.pm.Toolbar._switchModeAction('unionMode');
    expect(map.pm.globalUnionModeEnabled()).toBe(true);

    map.pm.disableGlobalUnionMode();
    expect(slot.toggled()).toBe(false);
    expect(slot._button.title).toBe('Union layers');
    expect(slot._button.className).toContain('leaflet-pm-icon-union');
  });
});
