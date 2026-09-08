import Draw from './L.PM.Draw';

/**
 * Freehand Drawing.
 * Press the left mouse button and move the cursor to draw a polygon
 * free-handed. Release the button to finish the shape. Options:
 * `freehandThreshold` — min distance between captured points in pixels.
 */
Draw.Freehand = Draw.Polygon.extend({
  initialize(map) {
    this._map = map;
    this._shape = 'Freehand';
    this.toolbarButtonName = 'drawFreehand';
    // merge into a copy of the inherited options (L.Class.extend shadows options)
    L.Util.setOptions(this, { freehandThreshold: 8 });
  },
  enable(options) {
    Draw.Polygon.prototype.enable.call(this, options);
    this._map.on('mousedown', this._onFreehandDown, this);
    this._map.on('mousemove', this._onFreehandMove, this);
    this._map.on('mouseup', this._onFreehandUp, this);
    this._freehandActive = false;
  },
  disable() {
    this._map.off('mousedown', this._onFreehandDown, this);
    this._map.off('mousemove', this._onFreehandMove, this);
    this._map.off('mouseup', this._onFreehandUp, this);
    // if the mode is exited mid-stroke, restore what _onFreehandDown disabled
    if (this._freehandActive) {
      L.DomUtil.enableTextSelection();
      L.DomUtil.enableImageDrag();
    }
    this._freehandActive = false;
    // if the mode is exited mid-stroke (ESC or programmatic disable), the
    // map dragging disabled in _onFreehandDown must be restored
    if (this._freehandWasDraggable && this._map.dragging) {
      this._map.dragging.enable();
      this._freehandWasDraggable = false;
    }
    Draw.Polygon.prototype.disable.call(this);
  },
  _onFreehandDown(e) {
    if (e.originalEvent.button !== 0) {
      return;
    }
    this._freehandActive = true;
    // prevent panning the map while drawing
    if (this._map.dragging && this._map.dragging.enabled()) {
      this._map.dragging.disable();
      this._freehandWasDraggable = true;
    }
    // the stroke replaces map dragging, so like Leaflet's own drag handler we
    // have to block native text selection and image dragging ourselves
    L.DomUtil.disableTextSelection();
    L.DomUtil.disableImageDrag();
    this._syncHintMarker(e);
    this._addFreehandVertex(this._hintMarker.getLatLng());
  },
  _onFreehandMove(e) {
    if (!this._freehandActive) {
      return;
    }
    // _syncHintMarker already ran for this event via the mousemove listener
    // Draw.Line#enable registers; reuse its (possibly snapped) result
    // instead of re-running it and duplicating snap side effects.
    this._addFreehandVertex(this._hintMarker.getLatLng());
  },
  _onFreehandUp() {
    if (!this._freehandActive) {
      return;
    }
    this._freehandActive = false;
    L.DomUtil.enableTextSelection();
    L.DomUtil.enableImageDrag();

    if (this._freehandWasDraggable && this._map.dragging) {
      this._map.dragging.enable();
    }
    this._freehandWasDraggable = false;

    // only finish when enough vertices were collected, else the user can
    // continue the stroke with another press
    if (this._layer.getLatLngs().length >= 3) {
      this._finishShape();
    }
  },
  _addFreehandVertex(latlng) {
    const latlngs = this._layer.getLatLngs();
    if (latlngs.length > 0) {
      const last = latlngs[latlngs.length - 1];
      const p1 = this._map.latLngToContainerPoint(last);
      const p2 = this._map.latLngToContainerPoint(latlng);
      if (p1.distanceTo(p2) < this.options.freehandThreshold) {
        return;
      }
    }
    this._layer.addLatLng(latlng);
    const marker = this._createMarker(latlng);
    this._fireVertexAdded(marker, undefined, latlng, 'Draw');
    this._change(this._layer.getLatLngs());
  },
  // vertices are only added through the mouse handlers; without this override
  // the click event (fired after mouseup) would add a duplicate vertex
  _createVertex: L.Util.falseFn,
});

export default Draw.Freehand;
