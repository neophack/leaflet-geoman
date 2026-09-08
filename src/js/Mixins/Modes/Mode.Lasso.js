import merge from 'lodash/merge';

/**
 * Lasso Select Mode.
 * Draw a freehand polygon while the left mouse button is pressed. On mouseup
 * every layer matching the lasso is selected (multi-selection, like the
 * click-to-select feature: selected layers keep their style, everything else
 * dims to 40% opacity) and the `pm:lasso-select` event is fired.
 *
 * `map.pm.setLassoMode()`-family controls how a drawn lasso combines with the
 * existing selection:
 *   RESET (default) - the selection is replaced; holding Ctrl/Shift while
 *                     releasing temporarily appends instead (Ctrl)
 *   APPEND          - the hit layers are added to the selection
 *   SUBTRACT        - the hit layers are removed from the selection
 * `setLassoSelectMode()`-family controls the hit test:
 *   INTERSECT (default) - a layer matches when any part of it lies in the lasso
 *   CONTAIN             - a layer matches only when it lies completely in the lasso
 */
const LASSO_MODES = ['APPEND', 'SUBTRACT', 'RESET'];
const LASSO_SELECT_MODES = ['CONTAIN', 'INTERSECT'];

const GlobalLassoMode = {
  _globalLassoModeEnabled: false,
  _lassoMode: 'RESET',
  _lassoSelectMode: 'INTERSECT',
  enableGlobalLassoMode(options = {}) {
    if (this._globalLassoModeEnabled) {
      return;
    }
    this._globalLassoModeEnabled = true;
    if (options.mode) {
      this._setLassoMode(options.mode);
    }
    if (options.selectMode) {
      this._setLassoSelectMode(options.selectMode);
    }
    this._lassoDrawOptions = merge(
      {
        color: '#3388ff',
        weight: 2,
        dashArray: '5,5',
        fillOpacity: 0.05,
      },
      options.lassoDrawOptions
    );

    // the lasso replaces map dragging while it is active
    if (this.map.dragging && this.map.dragging.enabled()) {
      this.map.dragging.disable();
      this._lassoWasDraggable = true;
    }

    this._lassoActive = false;
    this._lassoPoints = [];

    this.map.on('mousedown', this._startLasso, this);
    this.map.on('mousemove', this._drawLasso, this);
    this.map.on('mouseup', this._endLasso, this);
    this.map.getContainer().classList.add('leaflet-pm-lasso-cursor');

    this.Toolbar.toggleButton('lassoMode', this.globalLassoModeEnabled());
    this._fireGlobalLassoModeToggled(true);
  },
  disableGlobalLassoMode() {
    if (!this._globalLassoModeEnabled) {
      return;
    }
    this._globalLassoModeEnabled = false;

    this._removeLassoLayer();
    // if the mode is exited mid-stroke, restore what _startLasso disabled
    if (this._lassoActive) {
      L.DomUtil.enableTextSelection();
      L.DomUtil.enableImageDrag();
    }
    this._lassoActive = false;
    this._lassoPoints = [];

    this.map.off('mousedown', this._startLasso, this);
    this.map.off('mousemove', this._drawLasso, this);
    this.map.off('mouseup', this._endLasso, this);
    this.map.getContainer().classList.remove('leaflet-pm-lasso-cursor');

    if (this._lassoWasDraggable && this.map.dragging) {
      this.map.dragging.enable();
    }
    this._lassoWasDraggable = false;

    this.Toolbar.toggleButton('lassoMode', this.globalLassoModeEnabled());
    this._fireGlobalLassoModeToggled(false);
  },
  globalLassoModeEnabled() {
    return !!this._globalLassoModeEnabled;
  },
  toggleGlobalLassoMode(options) {
    if (this.globalLassoModeEnabled()) {
      this.disableGlobalLassoMode();
    } else {
      this.enableGlobalLassoMode(options);
    }
  },
  /** Sets the Lasso Mode to Append. */
  setLassoAppendMode() {
    this._setLassoMode('APPEND');
  },
  /** Sets the Lasso Mode to Subtract. */
  setLassoSubtractMode() {
    this._setLassoMode('SUBTRACT');
  },
  /** Sets the Lasso Mode to Reset. */
  setLassoResetMode() {
    this._setLassoMode('RESET');
  },
  getLassoMode() {
    return this._lassoMode;
  },
  _setLassoMode(mode) {
    if (!LASSO_MODES.includes(mode)) {
      return;
    }
    this._lassoMode = mode;
  },
  /** Sets the Lasso Select Mode to Intersect. */
  setLassoIntersectSelectMode() {
    this._setLassoSelectMode('INTERSECT');
  },
  /** Sets the Lasso Select Mode to Contain. */
  setLassoContainSelectMode() {
    this._setLassoSelectMode('CONTAIN');
  },
  getLassoSelectMode() {
    return this._lassoSelectMode;
  },
  _setLassoSelectMode(selectMode) {
    if (!LASSO_SELECT_MODES.includes(selectMode)) {
      return;
    }
    this._lassoSelectMode = selectMode;
  },
  _startLasso(e) {
    if (e.originalEvent.button !== 0) {
      return;
    }
    this._lassoActive = true;
    // the lasso replaces map dragging, so like Leaflet's own drag handler we
    // have to block native text selection and image dragging ourselves
    L.DomUtil.disableTextSelection();
    L.DomUtil.disableImageDrag();
    // normalize, the latlng can also be a plain array when fired programmatically
    this._lassoPoints = [L.latLng(e.latlng)];
  },
  _drawLasso(e) {
    if (!this._lassoActive) {
      return;
    }
    const last = this._lassoPoints[this._lassoPoints.length - 1];
    // ignore micro movements (in pixels) so the polygon stays performant
    const p1 = this.map.latLngToContainerPoint(last);
    const p2 = this.map.latLngToContainerPoint(e.latlng);
    if (p1.distanceTo(p2) < 6) {
      return;
    }
    this._lassoPoints.push(L.latLng(e.latlng));
    this._updateLassoLayer();
  },
  _endLasso(e) {
    if (!this._lassoActive) {
      return;
    }
    this._lassoActive = false;
    L.DomUtil.enableTextSelection();
    L.DomUtil.enableImageDrag();

    if (this._lassoPoints.length >= 3) {
      const lassoCoords = this._lassoPoints.slice();
      const hitLayers = this._getLayersInLasso(lassoCoords);
      const prev = this.getSelectedLayers();

      let next;
      const appendKey =
        e &&
        e.originalEvent &&
        (e.originalEvent.ctrlKey || e.originalEvent.shiftKey);
      if (this._lassoMode === 'SUBTRACT') {
        next = prev.filter((layer) => !hitLayers.includes(layer));
      } else if (this._lassoMode === 'APPEND' || appendKey) {
        next = prev.concat(hitLayers.filter((layer) => !prev.includes(layer)));
      } else {
        next = hitLayers;
      }

      // layers that entered or left the selection with this lasso
      const selectionChangedLayers = next
        .filter((layer) => !prev.includes(layer))
        .concat(prev.filter((layer) => !next.includes(layer)));

      this._setSelectedLayers(next);
      this._fireLassoSelect(
        lassoCoords,
        selectionChangedLayers,
        this.getSelectedLayers()
      );
    } else {
      // a plain click (no real lasso) clears the selection
      this._setSelectedLayers([]);
    }

    this._removeLassoLayer();
    this._lassoPoints = [];
  },
  _updateLassoLayer() {
    if (!this._lassoLayer) {
      this._lassoLayer = L.polygon(this._lassoPoints, {
        interactive: false,
        pmIgnore: true,
        ...this._lassoDrawOptions,
        // the lasso is always filled (with the
        // configurable, mostly transparent fillOpacity)
        fill: true,
      });
      this._lassoLayer._pmTempLayer = true;
      this._lassoLayer.addTo(this.map);
    } else {
      this._lassoLayer.setLatLngs(this._lassoPoints);
    }
  },
  _removeLassoLayer() {
    if (this._lassoLayer) {
      this._lassoLayer.remove();
      this._lassoLayer = undefined;
    }
  },
  _getLayersInLasso(lassoPoints) {
    const inside = [];
    const contain = this._lassoSelectMode === 'CONTAIN';

    L.PM.Utils.findLayers(this.map).forEach((layer) => {
      if (layer._pmTempLayer || !layer.pm) {
        return;
      }
      // layers can be excluded from the lasso selection
      if (layer.pm.options && layer.pm.options.lassoSelectable === false) {
        return;
      }
      const match = contain
        ? this._layerContainedInLasso(layer, lassoPoints)
        : this._layerInLasso(layer, lassoPoints);
      if (match) {
        inside.push(layer);
      }
    });

    return inside;
  },
  // a layer matches the lasso when any part of it lies inside the lasso
  // area: its center, one of its vertices, or - for areal layers - the lasso
  // itself being drawn inside the layer (big layer, small lasso)
  _layerInLasso(layer, lassoPoints) {
    const testPoints = this._layerTestPoints(layer);
    if (testPoints.some((point) => pointInPolygon(point, lassoPoints))) {
      return true;
    }

    const lassoCenter = L.latLng(
      lassoPoints.reduce((sum, p) => sum + p.lat, 0) / lassoPoints.length,
      lassoPoints.reduce((sum, p) => sum + p.lng, 0) / lassoPoints.length
    );
    if (layer instanceof L.Circle) {
      // the lasso was drawn inside the circle's area
      return layer.getLatLng().distanceTo(lassoCenter) <= layer.getRadius();
    }
    if (layer instanceof L.Polygon) {
      // the lasso was drawn inside the polygon's outer ring
      const latlngs =
        (layer._map && layer._map.pm && layer._map.pm._fullLatLngsOf
          ? layer._map.pm._fullLatLngsOf(layer)
          : undefined) || layer.getLatLngs();
      const ring = latlngs[0];
      return Array.isArray(ring) && pointInPolygon(lassoCenter, ring);
    }
    return false;
  },
  // a layer matches only when it lies completely inside the lasso area
  _layerContainedInLasso(layer, lassoPoints) {
    const testPoints = this._layerTestPoints(layer);
    if (layer instanceof L.Circle) {
      // center + the four extreme points of the radius must be inside
      const center = layer.getLatLng();
      const r = layer.getRadius();
      const latDeg = r / 111320;
      const lngDeg = r / (111320 * Math.cos((center.lat * Math.PI) / 180));
      testPoints.push(
        L.latLng(center.lat + latDeg, center.lng),
        L.latLng(center.lat - latDeg, center.lng),
        L.latLng(center.lat, center.lng + lngDeg),
        L.latLng(center.lat, center.lng - lngDeg)
      );
    }
    return testPoints.every((point) => pointInPolygon(point, lassoPoints));
  },
  _layerTestPoints(layer) {
    const testPoints = [];
    if (layer.getLatLng && !(layer instanceof L.Polygon)) {
      // Marker / CircleMarker / Circle center
      testPoints.push(layer.getLatLng());
    } else {
      if (layer.getCenter) {
        testPoints.push(layer.getCenter());
      }
      if (typeof layer.getLatLngs === 'function') {
        // optimized layers are rendered with a subset - test the full
        // geometry so no vertex is missed
        const latlngs =
          (layer._map && layer._map.pm && layer._map.pm._fullLatLngsOf
            ? layer._map.pm._fullLatLngsOf(layer)
            : undefined) || layer.getLatLngs();
        (function walk(parts) {
          parts.forEach((entry) => {
            if (L.Util.isArray(entry)) {
              walk(entry);
            } else {
              testPoints.push(entry);
            }
          });
        })(latlngs);
      }
    }
    return testPoints;
  },
};

// ray casting algorithm
function pointInPolygon(latlng, polygon) {
  let inside = false;
  const x = latlng.lng;
  const y = latlng.lat;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

export default GlobalLassoMode;
