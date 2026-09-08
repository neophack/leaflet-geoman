// @vitest-environment jsdom
/**
 * Layer selection: clicking a layer selects it and fades every other
 * Geoman-tracked layer to 40% opacity, so the selected one stands out.
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

// dispatch a genuine DOM click on the layer element - the selection is
// bound on the element, not as a Leaflet event
function click(layer) {
  const element = layer.getElement ? layer.getElement() : null;
  if (!element) {
    throw new Error('layer has no rendered element to click');
  }
  element.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true })
  );
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

describe('click-to-select', () => {
  it('dims every other layer to 40% opacity, leaving the clicked one untouched', () => {
    const a = L.polygon(square(52.54, 52.52, 13.38, 13.4), {
      opacity: 1,
      fillOpacity: 0.5,
    }).addTo(map);
    const b = L.polygon(square(52.54, 52.52, 13.41, 13.43), {
      opacity: 1,
      fillOpacity: 0.5,
    }).addTo(map);

    click(a);

    expect(a.options.opacity).toBe(1);
    expect(a.options.fillOpacity).toBe(0.5);
    expect(b.options.opacity).toBeCloseTo(0.4);
    expect(b.options.fillOpacity).toBeCloseTo(0.2);
  });

  it('moving the selection to another layer swaps which one is dimmed', () => {
    const a = L.polygon(square(52.54, 52.52, 13.38, 13.4), {
      opacity: 1,
      fillOpacity: 0.5,
    }).addTo(map);
    const b = L.polygon(square(52.54, 52.52, 13.41, 13.43), {
      opacity: 1,
      fillOpacity: 0.5,
    }).addTo(map);

    click(a);
    click(b);

    expect(a.options.opacity).toBeCloseTo(0.4);
    expect(a.options.fillOpacity).toBeCloseTo(0.2);
    expect(b.options.opacity).toBe(1);
    expect(b.options.fillOpacity).toBe(0.5);
    expect(map.pm.getSelectedLayer()).toBe(b);
  });

  it('dims markers via setOpacity, not setStyle', () => {
    const marker = L.marker([52.53, 13.4]).addTo(map);
    const polygon = L.polygon(square(52.54, 52.52, 13.38, 13.4)).addTo(map);

    click(polygon);

    expect(marker.options.opacity).toBeCloseTo(0.4);
  });

  it('is a no-op while a global mode (f.ex. Draw) is active', () => {
    const a = L.polygon(square(52.54, 52.52, 13.38, 13.4), {
      opacity: 1,
    }).addTo(map);
    const b = L.polygon(square(52.54, 52.52, 13.41, 13.43), {
      opacity: 1,
    }).addTo(map);

    map.pm.Draw.Polygon.enable();
    click(a);

    expect(map.pm.getSelectedLayer()).toBeNull();
    expect(b.options.opacity).toBe(1);

    map.pm.Draw.Polygon.disable();
  });

  it('does nothing when selectableLayers is disabled', () => {
    map.pm.setGlobalOptions({ selectableLayers: false });
    const a = L.polygon(square(52.54, 52.52, 13.38, 13.4)).addTo(map);
    const b = L.polygon(square(52.54, 52.52, 13.41, 13.43), {
      opacity: 1,
    }).addTo(map);

    click(a);

    expect(map.pm.getSelectedLayer()).toBeNull();
    expect(b.options.opacity).toBe(1);
  });
});

describe('layer.pm select API', () => {
  it('select()/unselect()/isSelected() keep state in sync', () => {
    const a = L.polygon(square(52.54, 52.52, 13.38, 13.4)).addTo(map);

    expect(a.pm.isSelected()).toBe(false);
    a.pm.select();
    expect(a.pm.isSelected()).toBe(true);
    expect(map.pm.getSelectedLayer()).toBe(a);

    a.pm.unselect();
    expect(a.pm.isSelected()).toBe(false);
    expect(map.pm.getSelectedLayer()).toBeNull();
  });

  it('map.pm.unselectAll() clears the selection', () => {
    const a = L.polygon(square(52.54, 52.52, 13.38, 13.4)).addTo(map);
    a.pm.select();

    map.pm.unselectAll();

    expect(a.pm.isSelected()).toBe(false);
    expect(map.pm.getSelectedLayer()).toBeNull();
  });

  it('fires pm:selectionadd / pm:selectionremove on both the layer and the map', () => {
    const a = L.polygon(square(52.54, 52.52, 13.38, 13.4)).addTo(map);
    const layerSelect = vi.fn();
    const mapSelect = vi.fn();
    const mapUnselect = vi.fn();
    a.on('pm:selectionadd', layerSelect);
    map.on('pm:selectionadd', mapSelect);
    map.on('pm:selectionremove', mapUnselect);

    a.pm.select();
    expect(layerSelect).toHaveBeenCalledTimes(1);
    expect(mapSelect).toHaveBeenCalledTimes(1);
    expect(mapSelect.mock.calls[0][0].layer).toBe(a);

    a.pm.unselect();
    expect(mapUnselect).toHaveBeenCalledTimes(1);
  });
});

describe('cleanup', () => {
  it('clears the selection (and undims everyone) if the selected layer is removed', () => {
    const a = L.polygon(square(52.54, 52.52, 13.38, 13.4)).addTo(map);
    const b = L.polygon(square(52.54, 52.52, 13.41, 13.43), {
      opacity: 1,
    }).addTo(map);

    a.pm.select();
    expect(b.options.opacity).toBeCloseTo(0.4);

    map.removeLayer(a);

    expect(map.pm.getSelectedLayer()).toBeNull();
    expect(b.options.opacity).toBe(1);
  });
});

describe('selectionEffect option (dim / outline)', () => {
  it("selectionEffect: 'outline' draws a black bounding rectangle instead of dimming", () => {
    map.pm.setGlobalOptions({ selectionEffect: 'outline' });
    const a = L.polygon(square(52.54, 52.52, 13.38, 13.4), {
      opacity: 1,
    }).addTo(map);
    const b = L.marker([52.53, 13.42]).addTo(map);
    const other = L.polygon(square(52.54, 52.52, 13.44, 13.46), {
      opacity: 1,
    }).addTo(map);

    map.pm._setSelectedLayers([a, b]);

    // nothing is dimmed in outline mode
    expect(other.options.opacity).toBe(1);
    // vector shapes get a black RECTANGLE around their bounds (not a stroked
    // copy of their outline), markers a CSS outline class
    expect(map.pm._selectionOutlines).toHaveLength(1);
    const frame = map.pm._selectionOutlines[0];
    expect(frame).toBeInstanceOf(L.Rectangle);
    expect(frame.options.color).toBe('#000000');
    expect(frame.options.fill).toBe(false);
    expect(frame.getBounds().equals(a.getBounds())).toBe(true);
    expect(
      b.getElement().classList.contains('pm-selection-outline-element')
    ).toBe(true);

    map.pm.unselectAll();
    expect(map.pm._selectionOutlines).toHaveLength(0);
    expect(
      b.getElement().classList.contains('pm-selection-outline-element')
    ).toBe(false);
  });

  it("selectionEffect: 'outline' frames a text marker around its label box, not a dot on its 0x0 icon", () => {
    map.pm.setGlobalOptions({ selectionEffect: 'outline' });
    const text = L.marker([52.53, 13.42], {
      textMarker: true,
      text: 'City Center',
    }).addTo(map);

    // jsdom has no layout engine: fake the on-screen boxes of the map and
    // the label (the textarea the 0x0 icon element overflows)
    map.getContainer().getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
    });
    text.pm.textArea.getBoundingClientRect = () => ({
      left: 300,
      top: 200,
      right: 420,
      bottom: 240,
      width: 120,
      height: 40,
    });

    map.pm._setSelectedLayers([text]);

    // the text marker gets the same black rectangle as vector layers - the
    // CSS outline class on its 0x0 icon element would collapse to a dot
    expect(
      text.getElement().classList.contains('pm-selection-outline-element')
    ).toBe(false);
    expect(map.pm._selectionOutlines).toHaveLength(1);
    const frame = map.pm._selectionOutlines[0];
    expect(frame).toBeInstanceOf(L.Rectangle);
    expect(frame.options.color).toBe('#000000');
    expect(frame.options.fill).toBe(false);

    // the frame wraps the label box, grown by 1px so the 2px stroke stays
    // clear of the label's white background
    const b = frame.getBounds();
    const nw = map.latLngToContainerPoint(b.getNorthWest());
    const se = map.latLngToContainerPoint(b.getSouthEast());
    expect(nw.x).toBeCloseTo(299);
    expect(nw.y).toBeCloseTo(199);
    expect(se.x).toBeCloseTo(421);
    expect(se.y).toBeCloseTo(241);

    map.pm.unselectAll();
    expect(map.pm._selectionOutlines).toHaveLength(0);
  });

  it('selectionOutlineStyle dashes the selection frames, never the layers', () => {
    map.pm.setGlobalOptions({ selectionEffect: 'outline' });
    const a = L.polygon(square(52.54, 52.52, 13.38, 13.4)).addTo(map);
    const b = L.marker([52.53, 13.42]).addTo(map);

    map.pm._setSelectedLayers([a, b]);
    // default 'solid': no dashArray on the rectangle, no dashed class
    expect(map.pm._selectionOutlines[0].options.dashArray).toBeUndefined();
    expect(
      map.getContainer().classList.contains('pm-selection-outline-dashed')
    ).toBe(false);

    // 'dashed': the SVG rectangle carries the dashArray, markers dash via
    // the container class (see layers.css)
    map.pm.setGlobalOptions({ selectionOutlineStyle: 'dashed' });
    expect(map.pm._selectionOutlines[0].options.dashArray).toBe('8,6');
    expect(
      map.getContainer().classList.contains('pm-selection-outline-dashed')
    ).toBe(true);

    // unknown values fall back to solid
    map.pm.setGlobalOptions({ selectionOutlineStyle: 'whatever' });
    expect(map.pm._selectionOutlines[0].options.dashArray).toBeUndefined();
    expect(
      map.getContainer().classList.contains('pm-selection-outline-dashed')
    ).toBe(false);

    // the option styles only the frames - the selected layers keep their
    // own style (no dash attribute on their rendered elements)
    expect(a.getElement().getAttribute('stroke-dasharray')).toBeNull();
    expect(b.getElement().getAttribute('stroke-dasharray')).toBeNull();

    map.pm.unselectAll();
  });

  it('switching the effect re-applies to the current selection', () => {
    const a = L.polygon(square(52.54, 52.52, 13.38, 13.4), {
      opacity: 1,
    }).addTo(map);
    const other = L.polygon(square(52.54, 52.52, 13.44, 13.46), {
      opacity: 1,
    }).addTo(map);

    a.pm.select();
    expect(other.options.opacity).toBeCloseTo(0.4); // dim (default)

    map.pm.setGlobalOptions({ selectionEffect: 'outline' });
    expect(other.options.opacity).toBe(1); // undimmed again
    expect(map.pm._selectionOutlines).toHaveLength(1);

    map.pm.setGlobalOptions({ selectionEffect: 'dim' });
    expect(other.options.opacity).toBeCloseTo(0.4);
    expect(map.pm._selectionOutlines).toHaveLength(0);

    map.pm.unselectAll();
  });
});
