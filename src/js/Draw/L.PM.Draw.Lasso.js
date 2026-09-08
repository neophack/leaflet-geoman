import Draw from './L.PM.Draw';

/**
 * Lasso.
 * The Lasso is selected like a draw shape (`map.pm.enableDraw('Lasso')`) but
 * implemented as the global Lasso mode - this facade forwards the Draw API
 * to `map.pm.enableGlobalLassoMode()` & co. and exposes the mode
 * constants (`Draw.Lasso.APPEND_MODE`, ...).
 */
Draw.Lasso = Draw.extend({
  initialize(map) {
    this._map = map;
    this._shape = 'Lasso';
    this.toolbarButtonName = 'lassoMode';
  },
  enable(options) {
    this._map.pm.enableGlobalLassoMode(options);
  },
  disable() {
    this._map.pm.disableGlobalLassoMode();
  },
  toggle(options) {
    if (this.enabled()) {
      this.disable();
    } else {
      this.enable(options);
    }
  },
  enabled() {
    return this._map.pm.globalLassoModeEnabled();
  },
  // the toolbar button of the Lasso is registered by the Toolbar itself
  addButton: L.Util.falseFn,
  /** Sets the Lasso Mode to Append. ⭐ */
  setAppendMode() {
    this._map.pm.setLassoAppendMode();
  },
  /** Sets the Lasso Mode to Subtract. ⭐ */
  setSubtractMode() {
    this._map.pm.setLassoSubtractMode();
  },
  /** Sets the Lasso Mode to Reset. ⭐ */
  setResetMode() {
    this._map.pm.setLassoResetMode();
  },
  /** Get current Lasso Mode. ⭐ */
  getMode() {
    return this._map.pm.getLassoMode();
  },
  /** Sets the Lasso Select Mode to Intersect. ⭐ */
  setIntersectSelectMode() {
    this._map.pm.setLassoIntersectSelectMode();
  },
  /** Sets the Lasso Select Mode to Contain. ⭐ */
  setContainSelectMode() {
    this._map.pm.setLassoContainSelectMode();
  },
  /** Get current Lasso Select Mode. ⭐ */
  getSelectMode() {
    return this._map.pm.getLassoSelectMode();
  },
  /** Deselect all selected layers. ⭐ */
  cleanupSelection() {
    this._map.pm.cleanupSelection();
  },
  /** Get all selected layers. ⭐ */
  getSelectedLayers() {
    return this._map.pm.getSelectedLayers();
  },
});

Draw.Lasso.APPEND_MODE = 'APPEND';
Draw.Lasso.SUBTRACT_MODE = 'SUBTRACT';
Draw.Lasso.RESET_MODE = 'RESET';
Draw.Lasso.CONTAIN_SELECT_MODE = 'CONTAIN';
Draw.Lasso.INTERSECT_SELECT_MODE = 'INTERSECT';

export default Draw.Lasso;
