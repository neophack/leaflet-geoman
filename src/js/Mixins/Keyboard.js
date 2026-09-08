// use function to create a new mixin object for keeping isolation
// to make it work for multiple map instances
const createKeyboardMixins = () => ({
  _lastEvents: { keydown: undefined, keyup: undefined, current: undefined },
  _initKeyListener(map) {
    this.map = map;
    L.DomEvent.on(document, 'keydown keyup', this._onKeyListener, this);
    L.DomEvent.on(window, 'blur', this._onBlur, this);
    // clean up global listeners when current map instance is destroyed
    map.once('unload', this._unbindKeyListenerEvents, this);
  },
  _handleEscapeKey(e) {
    const pm = this.map.pm;
    const globalOptions = pm.getGlobalOptions();

    // Only handle Escape if the option is enabled
    if (!globalOptions.exitModeOnEscape) {
      return false;
    }

    // Check if any mode is active
    const hasActiveMode =
      pm.globalDrawModeEnabled() ||
      pm.globalEditModeEnabled() ||
      pm.globalDragModeEnabled() ||
      pm.globalRemovalModeEnabled() ||
      pm.globalRotateModeEnabled() ||
      pm.globalCutModeEnabled();

    if (!hasActiveMode) {
      return false;
    }

    // Prevent default browser behavior (focus ring, etc.)
    e.preventDefault();

    // Disable all active modes
    // 1. Disable draw mode if active
    if (pm.globalDrawModeEnabled()) {
      pm.disableDraw();
    }

    // 2. Disable global edit mode if active
    if (pm.globalEditModeEnabled()) {
      pm.disableGlobalEditMode();
    }

    // 3. Disable global drag mode if active
    if (pm.globalDragModeEnabled()) {
      pm.disableGlobalDragMode();
    }

    // 4. Disable global removal mode if active
    if (pm.globalRemovalModeEnabled()) {
      pm.disableGlobalRemovalMode();
    }

    // 5. Disable global rotate mode if active
    if (pm.globalRotateModeEnabled()) {
      pm.disableGlobalRotateMode();
    }

    // 6. Disable global cut mode if active
    if (pm.globalCutModeEnabled()) {
      pm.disableGlobalCutMode();
    }

    return true;
  },
  _handleEnterKey(e) {
    const pm = this.map.pm;
    const globalOptions = pm.getGlobalOptions();

    // Only handle Enter if the option is enabled
    if (!globalOptions.finishOnEnter) {
      return false;
    }

    // Only handle Enter for draw mode
    const activeShape = pm.Draw.getActiveShape();
    if (!activeShape) {
      return false;
    }

    // Get the active draw instance
    const drawInstance = pm.Draw[activeShape];
    if (!drawInstance || !drawInstance._finishShape) {
      return false;
    }

    // Check if the shape can be finished (has enough vertices)
    // For shapes that support _finishShape, try to finish
    // The _finishShape method itself checks if there are enough vertices
    const canFinish = this._canFinishShape(drawInstance, activeShape);
    if (!canFinish) {
      return false;
    }

    // Prevent default behavior
    e.preventDefault();

    // Finish the shape
    drawInstance._finishShape();

    return true;
  },
  _canFinishShape(drawInstance, activeShape) {
    // Check if we can finish the current shape based on vertex count
    // Different shapes have different minimum vertex requirements

    // Shapes that don't support multi-vertex drawing
    if (['Marker', 'CircleMarker', 'Text'].includes(activeShape)) {
      return false;
    }

    // For Rectangle, check if drawing is in progress (has start point)
    if (activeShape === 'Rectangle') {
      return drawInstance._startMarker !== undefined;
    }

    // For Circle, check if center has been placed (added to layer group)
    if (activeShape === 'Circle') {
      return (
        drawInstance._centerMarker &&
        drawInstance._layerGroup?.hasLayer(drawInstance._centerMarker)
      );
    }

    // For Line, Polygon, Cut - need to check vertex count
    if (drawInstance._layer && drawInstance._layer.getLatLngs) {
      const coords = drawInstance._layer.getLatLngs();

      // Line needs at least 2 points (uses flat coords)
      if (activeShape === 'Line') {
        const flatCoords = coords.flat ? coords.flat() : coords;
        return flatCoords.length >= 2;
      }

      // Polygon and Cut need at least 3 points
      // Polygon's _finishShape checks coords.length directly (not flattened)
      if (activeShape === 'Polygon' || activeShape === 'Cut') {
        return coords.length >= 3;
      }
    }

    return false;
  },
  // Toolbar hotkeys (M/L/P/R/C/T/F/E/G/X/O/S, Shift+M, Delete) - opt-in via
  // the `keyboardShortcuts` global option. See Toolbar/L.PM.Toolbar.js's
  // SHORTCUT_KEY_LABELS for the tooltip hints shown while it's on.
  _handleToolShortcut(e) {
    const pm = this.map.pm;
    if (!pm.getGlobalOptions().keyboardShortcuts) {
      return false;
    }
    // never hijack a browser/OS shortcut (Ctrl+M, Alt+F, Cmd+..., etc.)
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return false;
    }
    // don't steal letter keys while the user types in an input / textarea
    const tag = e.target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) {
      return false;
    }
    // every map binds its own document-level listener - don't steal the
    // shortcut when the user interacts with a different map on the page
    const targetMapContainer = e.target?.closest?.('.leaflet-container');
    if (targetMapContainer && targetMapContainer !== this.map.getContainer()) {
      return false;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      // with an active selection, Delete/Backspace removes the selected
      // layers (multi-select aware, one undo step); without one, Delete
      // keeps toggling the Removal mode like before
      if (pm.getSelectedLayers().length > 0) {
        e.preventDefault();
        pm.removeSelectedLayers();
        return true;
      }
      if (e.key === 'Delete') {
        e.preventDefault();
        pm.toggleGlobalRemovalMode();
        return true;
      }
      return false;
    }

    const key = e.key.toLowerCase();

    if (e.shiftKey) {
      if (key === 'm' && pm.Draw.CircleMarker) {
        e.preventDefault();
        pm.Draw.CircleMarker.toggle();
        return true;
      }
      return false;
    }

    const drawShapes = {
      m: 'Marker',
      l: 'Line',
      p: 'Polygon',
      r: 'Rectangle',
      c: 'Circle',
      t: 'Text',
      f: 'Freehand',
    };
    if (drawShapes[key] && pm.Draw[drawShapes[key]]) {
      e.preventDefault();
      pm.Draw[drawShapes[key]].toggle();
      return true;
    }

    if (key === 'x' && pm.Draw.Cut) {
      e.preventDefault();
      // matches the toolbar's Cut button options (see L.PM.Toolbar.js)
      pm.Draw.Cut.toggle({
        snappable: true,
        cursorMarker: true,
        allowSelfIntersection: false,
      });
      return true;
    }

    const globalModes = {
      e: 'toggleGlobalEditMode',
      g: 'toggleGlobalDragMode',
      o: 'toggleGlobalRotateMode',
      s: 'toggleGlobalScaleMode',
    };
    if (globalModes[key] && typeof pm[globalModes[key]] === 'function') {
      e.preventDefault();
      pm[globalModes[key]]();
      return true;
    }

    return false;
  },
  _unbindKeyListenerEvents() {
    L.DomEvent.off(document, 'keydown keyup', this._onKeyListener, this);
    L.DomEvent.off(window, 'blur', this._onBlur, this);
  },
  _handleUndoRedoKeys(e) {
    const pm = this.map.pm;
    const isCtrlOrMeta = e.ctrlKey || e.metaKey;
    if (!isCtrlOrMeta) {
      return false;
    }
    // don't hijack shortcuts while the user types in an input / textarea
    // (f.ex. the Text layer)
    const tag = e.target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) {
      return false;
    }
    // every map binds its own document-level listener - don't steal the
    // shortcut when the user interacts with a different map on the page
    const targetMapContainer = e.target?.closest?.('.leaflet-container');
    if (targetMapContainer && targetMapContainer !== this.map.getContainer()) {
      return false;
    }

    const key = e.key.toLowerCase();
    // only take over the shortcut (and prevent the browser default) when
    // there is actually something to undo/redo, so an empty geoman history
    // doesn't swallow Ctrl+Z/Y meant for another widget on the page
    if (key === 'z' && !e.shiftKey) {
      if (!pm.hasUndo()) {
        return false;
      }
      e.preventDefault();
      return pm.undo();
    }
    if (key === 'y' || (key === 'z' && e.shiftKey)) {
      if (!pm.hasRedo()) {
        return false;
      }
      e.preventDefault();
      return pm.redo();
    }
    return false;
  },
  _onKeyListener(e) {
    let focusOn = 'document';

    // .contains only supported since IE9, if you want to use Geoman with IE8 or lower you need to implement a polyfill for .contains
    // with focusOn the user can add a check if the key was pressed while the user interacts with the map
    if (this.map.getContainer().contains(e.target)) {
      focusOn = 'map';
    }

    const data = { event: e, eventType: e.type, focusOn };
    this._lastEvents[e.type] = data;
    this._lastEvents.current = data;

    this.map.pm._fireKeyeventEvent(e, e.type, focusOn);

    // Handle special keys on keydown
    if (e.type === 'keydown') {
      // Handle Escape key to exit active modes
      if (e.key === 'Escape') {
        this._handleEscapeKey(e);
      }
      // Handle Enter key to finish drawing
      if (e.key === 'Enter') {
        this._handleEnterKey(e);
      }
      // Handle Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z for undo & redo
      this._handleUndoRedoKeys(e);
      // Handle the opt-in toolbar hotkeys (M/L/P/R/C/T/F/E/G/X/O/S/Delete)
      this._handleToolShortcut(e);
    }
  },
  _onBlur(e) {
    e.altKey = false;
    const data = { event: e, eventType: e.type, focusOn: 'document' };
    this._lastEvents[e.type] = data;
    this._lastEvents.current = data;
  },
  getLastKeyEvent(type = 'current') {
    return this._lastEvents[type];
  },
  isShiftKeyPressed() {
    return this._lastEvents.current?.event.shiftKey;
  },
  isAltKeyPressed() {
    return this._lastEvents.current?.event.altKey;
  },
  isCtrlKeyPressed() {
    return this._lastEvents.current?.event.ctrlKey;
  },
  isMetaKeyPressed() {
    return this._lastEvents.current?.event.metaKey;
  },
  getPressedKey() {
    return this._lastEvents.current?.event.key;
  },
});

export default createKeyboardMixins;
