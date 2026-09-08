// @vitest-environment jsdom
/**
 * Undo / Redo (issue #320, most requested feature).
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

function dragMarker(marker, toLatLng) {
  marker.fire('dragstart', { target: marker });
  marker.setLatLng(toLatLng);
  marker.fire('drag', { target: marker });
  marker.fire('dragend', { target: marker });
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

describe('undo/redo of layer creation', () => {
  it('undoes and redoes a drawn polygon', () => {
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

    const layer = created.mock.calls[0][0].layer;
    expect(map.hasLayer(layer)).toBe(true);

    expect(map.pm.undo()).toBe(true);
    expect(map.hasLayer(layer)).toBe(false);

    expect(map.pm.redo()).toBe(true);
    expect(map.hasLayer(layer)).toBe(true);
  });

  it('undo() returns false when the stack is empty', () => {
    expect(map.pm.undo()).toBe(false);
    expect(map.pm.redo()).toBe(false);
    expect(map.pm.hasUndo()).toBe(false);
  });
});

describe('undo/redo of layer removal (removal mode)', () => {
  it('restores a removed layer', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);

    map.pm.enableGlobalRemovalMode();
    layer.fire('click', { target: layer });
    map.pm.disableGlobalRemovalMode();
    expect(map.hasLayer(layer)).toBe(false);

    map.pm.undo();
    expect(map.hasLayer(layer)).toBe(true);

    map.pm.redo();
    expect(map.hasLayer(layer)).toBe(false);

    map.pm.undo();
    expect(map.hasLayer(layer)).toBe(true);
  });
});

describe('undo/redo of vertex edits', () => {
  it('restores the previous latlngs after a vertex drag', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    layer.pm.enable();
    const original = copyOf(layer);

    const marker = layer.pm._markers[0][0];
    dragMarker(marker, L.latLng(52.6, 13.45));
    expect(layer.getLatLngs()[0][0].lat).toBeCloseTo(52.6, 5);

    map.pm.undo();
    const restored = layer.getLatLngs()[0][0];
    expect(restored.lat).toBeCloseTo(original[0].lat, 5);
    expect(restored.lng).toBeCloseTo(original[0].lng, 5);

    map.pm.redo();
    expect(layer.getLatLngs()[0][0].lat).toBeCloseTo(52.6, 5);
  });

  it('restores a moved marker', () => {
    const marker = L.marker([52.52, 13.4]).addTo(map);
    marker.pm.enable();
    const draggable = marker.pm._marker || marker;
    // simulate the marker drag through the geoman event flow
    marker.fire('pm:markerdragend', { marker, latlng: L.latLng(52.55, 13.44) });
    marker.setLatLng([52.55, 13.44]);
    marker.pm._fireEdit(marker, 'Drag');

    map.pm.undo();
    expect(marker.getLatLng().lat).toBeCloseTo(52.52, 5);

    map.pm.redo();
    expect(marker.getLatLng().lat).toBeCloseTo(52.55, 5);
  });

  it('restores the radius of a resized circle marker (not just its position)', () => {
    const marker = L.circleMarker([52.52, 13.4], { radius: 8 }).addTo(map);
    marker.pm.enable();
    marker.setRadius(20);
    marker.pm._fireEdit(marker, 'Edit');

    map.pm.undo();
    expect(marker.getRadius()).toBe(8);

    map.pm.redo();
    expect(marker.getRadius()).toBe(20);
  });

  it('restores the radius of a scaled circle', () => {
    const circle = L.circle([52.52, 13.4], { radius: 200 }).addTo(map);
    circle.pm.enableScale();
    const handle = circle.pm._scaleHandles.topright.marker;
    dragMarker(handle, L.latLng(52.545, 13.44));
    expect(circle.getRadius()).toBeGreaterThan(200);

    map.pm.undo();
    expect(circle.getRadius()).toBeCloseTo(200, 5);
  });
});

describe('undo/redo of boolean operations', () => {
  it('restores both originals after an union', () => {
    const a = L.polygon(square(52.54, 52.5, 13.38, 13.42)).addTo(map);
    const b = L.polygon(square(52.52, 52.48, 13.4, 13.44)).addTo(map);
    const result = map.pm.union(a, b);
    expect(map.hasLayer(result)).toBe(true);

    map.pm.undo();
    expect(map.hasLayer(result)).toBe(false);
    expect(map.hasLayer(a)).toBe(true);
    expect(map.hasLayer(b)).toBe(true);

    map.pm.redo();
    expect(map.hasLayer(result)).toBe(true);
    expect(map.hasLayer(a)).toBe(false);
  });

  it('restores the original after a split', () => {
    const target = L.polygon(square(52.54, 52.5, 13.38, 13.42)).addTo(map);
    map.pm.Draw.Split.enable({ snappable: false });
    map.pm.Draw.Split._layer.setLatLngs([
      [52.49, 13.4],
      [52.55, 13.4],
    ]);
    map.pm.Draw.Split._finishShape();
    expect(map.hasLayer(target)).toBe(false);

    map.pm.undo();
    expect(map.hasLayer(target)).toBe(true);

    map.pm.redo();
    expect(map.hasLayer(target)).toBe(false);
  });

  it('removes a copied layer on undo', () => {
    const original = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    const copy = map.pm.copyLayer(original);
    expect(map.hasLayer(copy)).toBe(true);

    map.pm.undo();
    expect(map.hasLayer(copy)).toBe(false);
    expect(map.hasLayer(original)).toBe(true);
  });
});

describe('undo/redo stack behavior', () => {
  it('a new action clears the redo stack', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    // action 1: remove
    map.pm.enableGlobalRemovalMode();
    layer.fire('click', { target: layer });
    map.pm.disableGlobalRemovalMode();
    map.pm.undo(); // -> redo stack has 1 item

    // action 2: remove again -> redo stack must be cleared
    map.pm.enableGlobalRemovalMode();
    layer.fire('click', { target: layer });
    map.pm.disableGlobalRemovalMode();
    expect(map.pm.hasRedo()).toBe(false);
  });

  it('respects the history limit', () => {
    map.pm.setUndoLimit(3);
    for (let i = 0; i < 5; i += 1) {
      const layer = L.polygon(
        square(52.53 + i * 0.01, 52.51 + i * 0.01, 13.39, 13.41)
      ).addTo(map);
      map.pm.enableGlobalRemovalMode();
      layer.fire('click', { target: layer });
      map.pm.disableGlobalRemovalMode();
    }
    // only the last 3 removals can be undone
    let undoCount = 0;
    while (map.pm.undo()) {
      undoCount += 1;
    }
    expect(undoCount).toBe(3);
  });

  it('fires pm:undo and pm:redo events', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    map.pm.enableGlobalRemovalMode();
    layer.fire('click', { target: layer });
    map.pm.disableGlobalRemovalMode();

    const undoEvent = vi.fn();
    const redoEvent = vi.fn();
    map.on('pm:undo', undoEvent);
    map.on('pm:redo', redoEvent);

    map.pm.undo();
    expect(undoEvent).toHaveBeenCalledTimes(1);
    expect(undoEvent.mock.calls[0][0].commandType).toBe('remove');

    map.pm.redo();
    expect(redoEvent).toHaveBeenCalledTimes(1);
  });
});

describe('undo/redo keyboard shortcuts', () => {
  function pressKey(key, { ctrlKey = true, shiftKey = false } = {}) {
    document.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key,
        ctrlKey,
        shiftKey,
        bubbles: true,
      })
    );
  }

  it('Ctrl+Z undoes, Ctrl+Y and Ctrl+Shift+Z redo', () => {
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    map.pm.enableGlobalRemovalMode();
    layer.fire('click', { target: layer });
    map.pm.disableGlobalRemovalMode();

    pressKey('z');
    expect(map.hasLayer(layer)).toBe(true);

    pressKey('y');
    expect(map.hasLayer(layer)).toBe(false);

    pressKey('z');
    expect(map.hasLayer(layer)).toBe(true);

    pressKey('Z', { ctrlKey: true, shiftKey: true });
    expect(map.hasLayer(layer)).toBe(false);
  });
});

function copyOf(layer) {
  return layer.getLatLngs()[0].map((ll) => L.latLng(ll.lat, ll.lng));
}

describe('undo/redo of layer order (bring to front / send to back)', () => {
  it('undo restores the previous stacking, redo re-applies it', () => {
    const a = L.polygon(square(52.54, 52.5, 13.38, 13.4)).addTo(map);
    const b = L.polygon(square(52.54, 52.5, 13.41, 13.43)).addTo(map);
    const c = L.polygon(square(52.56, 52.54, 13.38, 13.4)).addTo(map);
    // visual stacking (bottom -> top) via the SVG path order
    const stacking = () => {
      const withPath = [a, b, c].filter((l) => l._path);
      return withPath
        .sort((x, y) =>
          x._path.compareDocumentPosition(y._path) &
          Node.DOCUMENT_POSITION_FOLLOWING
            ? -1
            : 1
        )
        .map((l) => L.stamp(l));
    };
    expect(stacking()).toEqual(stacking()); // sanity: comparable
    const before = stacking();
    expect(before[before.length - 1]).toBe(L.stamp(c)); // c drawn last = on top

    map.pm.enableGlobalSendToBackMode();
    c.fire('click', { target: c }); // c goes to the bottom
    expect(stacking()[0]).toBe(L.stamp(c));
    map.pm.disableGlobalSendToBackMode();

    expect(map.pm.undo()).toBe(true);
    expect(stacking()).toEqual(before); // original stacking restored

    expect(map.pm.redo()).toBe(true);
    expect(stacking()[0]).toBe(L.stamp(c)); // re-applied
  });

  it('a no-op order change (already on top) is not pushed to the stack', () => {
    const a = L.polygon(square(52.54, 52.5, 13.38, 13.4)).addTo(map);
    const b = L.polygon(square(52.54, 52.5, 13.41, 13.43)).addTo(map);
    map.pm.enableGlobalBringToFrontMode();
    b.fire('click', { target: b }); // b is already on top -> no-op
    map.pm.disableGlobalBringToFrontMode();
    expect(map.pm.hasUndo()).toBe(false);
  });
});

describe('undo/redo of category changes', () => {
  it('undo restores the previous category and its style, redo re-applies', () => {
    map.pm.setCategory('river', { pathOptions: { color: '#3388ff' } });
    map.pm.setCategory('house', { pathOptions: { color: '#e94560' } });
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);

    layer.pm.setCategory('river');
    expect(layer.pm.getCategory()).toBe('river');
    expect(layer.options.color).toBe('#3388ff');

    layer.pm.setCategory('house');
    expect(layer.pm.getCategory()).toBe('house');
    expect(layer.options.color).toBe('#e94560');

    expect(map.pm.undo()).toBe(true);
    expect(layer.pm.getCategory()).toBe('river');
    expect(layer.options.color).toBe('#3388ff');

    expect(map.pm.redo()).toBe(true);
    expect(layer.pm.getCategory()).toBe('house');
    expect(layer.options.color).toBe('#e94560');
  });

  it('undoing a category stamp on a fresh layer clears it again', () => {
    map.pm.setCategory('river', { pathOptions: { color: '#3388ff' } });
    const layer = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    layer.pm.setCategory('river');

    expect(map.pm.undo()).toBe(true);
    expect(layer.pm.getCategory()).toBeUndefined();
    expect(layer.feature.properties.pmCategory).toBeUndefined();
  });
});
