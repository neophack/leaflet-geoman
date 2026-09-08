// @vitest-environment jsdom
/**
 * Opt-in toolbar hotkeys (M/L/P/R/C/T/F/E/G/X/O/S, Shift+M, Delete) behind
 * the `keyboardShortcuts` global option (default off) - see
 * Mixins/Keyboard.js#_handleToolShortcut and
 * Toolbar/L.PM.Toolbar.js#updateShortcutHints.
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
  map.pm.addControls();
});

function pressKey(key, opts = {}) {
  document.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      key,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      bubbles: true,
      cancelable: true,
      ...opts,
    })
  );
}

describe('toolbar hotkeys (off by default)', () => {
  it('does nothing when keyboardShortcuts is not enabled', () => {
    pressKey('p');
    expect(map.pm.Draw.Polygon.enabled()).toBeFalsy();
  });
});

describe('toolbar hotkeys (keyboardShortcuts: true)', () => {
  beforeEach(() => {
    map.pm.setGlobalOptions({ keyboardShortcuts: true });
  });

  it('toggles each draw shape on and back off', () => {
    const cases = [
      ['m', 'Marker'],
      ['l', 'Line'],
      ['p', 'Polygon'],
      ['r', 'Rectangle'],
      ['c', 'Circle'],
      ['t', 'Text'],
      ['f', 'Freehand'],
    ];
    cases.forEach(([key, shape]) => {
      expect(map.pm.Draw[shape].enabled()).toBeFalsy();
      pressKey(key);
      expect(map.pm.Draw[shape].enabled()).toBe(true);
      pressKey(key);
      expect(map.pm.Draw[shape].enabled()).toBe(false);
    });
  });

  it('Shift+M toggles CircleMarker, plain M toggles Marker', () => {
    pressKey('m', { shiftKey: true });
    expect(map.pm.Draw.CircleMarker.enabled()).toBe(true);
    expect(map.pm.Draw.Marker.enabled()).toBeFalsy();
    pressKey('m', { shiftKey: true });
    expect(map.pm.Draw.CircleMarker.enabled()).toBe(false);

    pressKey('m');
    expect(map.pm.Draw.Marker.enabled()).toBe(true);
  });

  it('X toggles Cut mode', () => {
    pressKey('x');
    expect(map.pm.globalCutModeEnabled()).toBe(true);
    pressKey('x');
    expect(map.pm.globalCutModeEnabled()).toBe(false);
  });

  it('E/G/O/S toggle Edit/Drag/Rotate/Scale global modes', () => {
    pressKey('e');
    expect(map.pm.globalEditModeEnabled()).toBe(true);
    pressKey('e');
    expect(map.pm.globalEditModeEnabled()).toBe(false);

    pressKey('g');
    expect(map.pm.globalDragModeEnabled()).toBe(true);
    pressKey('g');
    expect(map.pm.globalDragModeEnabled()).toBe(false);

    pressKey('o');
    expect(map.pm.globalRotateModeEnabled()).toBe(true);
    pressKey('o');
    expect(map.pm.globalRotateModeEnabled()).toBe(false);

    pressKey('s');
    expect(map.pm.globalScaleModeEnabled()).toBe(true);
    pressKey('s');
    expect(map.pm.globalScaleModeEnabled()).toBe(false);
  });

  it('Delete toggles Removal mode', () => {
    pressKey('Delete');
    expect(map.pm.globalRemovalModeEnabled()).toBe(true);
    pressKey('Delete');
    expect(map.pm.globalRemovalModeEnabled()).toBe(false);
  });

  it('Delete / Backspace remove the selected layers as one undo step', () => {
    const a = L.polygon([
      [52.51, 13.39],
      [52.51, 13.41],
      [52.53, 13.41],
      [52.53, 13.39],
    ]).addTo(map);
    const b = L.marker([52.52, 13.4]).addTo(map);
    const survivor = L.marker([52.6, 13.5]).addTo(map);
    map.pm._setSelectedLayers([a, b]);

    pressKey('Backspace');
    expect(map.hasLayer(a)).toBe(false);
    expect(map.hasLayer(b)).toBe(false);
    expect(map.hasLayer(survivor)).toBe(true);
    expect(map.pm.getSelectedLayers()).toHaveLength(0);

    // a single undo restores the whole multi-delete
    map.pm.undo();
    expect(map.hasLayer(a)).toBe(true);
    expect(map.hasLayer(b)).toBe(true);
    expect(map.hasLayer(survivor)).toBe(true);
  });

  it('Delete falls back to Removal mode when nothing is selected', () => {
    L.marker([52.52, 13.4]).addTo(map);
    expect(map.pm.getSelectedLayers()).toHaveLength(0);
    pressKey('Delete');
    expect(map.pm.globalRemovalModeEnabled()).toBe(true);
    pressKey('Delete');
    expect(map.pm.globalRemovalModeEnabled()).toBe(false);
  });

  it('ignores the key when a modifier is held (Ctrl/Meta/Alt)', () => {
    pressKey('p', { ctrlKey: true });
    expect(map.pm.Draw.Polygon.enabled()).toBeFalsy();
    pressKey('p', { metaKey: true });
    expect(map.pm.Draw.Polygon.enabled()).toBeFalsy();
    pressKey('p', { altKey: true });
    expect(map.pm.Draw.Polygon.enabled()).toBeFalsy();
  });

  it('ignores the key while typing in an input', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    // dispatched on the input itself, so e.target is the input (bubbles up
    // to the document-level listener registered by _initKeyListener)
    input.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: 'p',
        bubbles: true,
        cancelable: true,
      })
    );
    expect(map.pm.Draw.Polygon.enabled()).toBeFalsy();
  });

  it('disabling the option again stops the hotkeys', () => {
    map.pm.setGlobalOptions({ keyboardShortcuts: false });
    pressKey('p');
    expect(map.pm.Draw.Polygon.enabled()).toBeFalsy();
  });
});

describe('toolbar tooltip hints', () => {
  it('appends the shortcut to the button title once enabled, and removes it once disabled', () => {
    const button = map.pm.Toolbar.buttons.drawPolygon;
    const baseTitle = button._button.title;

    map.pm.setGlobalOptions({ keyboardShortcuts: true });
    expect(button._button.title).toBe(`${baseTitle} (P)`);

    map.pm.setGlobalOptions({ keyboardShortcuts: false });
    expect(button._button.title).toBe(baseTitle);
  });

  it('uses Shift+M for the circle marker button and Delete for removal', () => {
    map.pm.setGlobalOptions({ keyboardShortcuts: true });
    expect(map.pm.Toolbar.buttons.drawCircleMarker._button.title).toMatch(
      / \(Shift\+M\)$/
    );
    expect(map.pm.Toolbar.buttons.removalMode._button.title).toMatch(
      / \(Delete\)$/
    );
  });
});
