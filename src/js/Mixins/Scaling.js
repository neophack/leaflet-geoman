import { copyLatLngs } from '../helpers';

/**
 * Scale Mixin.
 * Adds four draggable handles to the corners of the layer bounding box.
 * Dragging a handle scales the layer uniformly around the opposite corner.
 * Included in L.PM.Edit like the Rotate mixin.
 */
const ScaleMixin = {
  _onScaleStart(e) {
    const map = this._layer._map;
    this._scaleOriginLatLng = this._scaleHandles[
      e.target._scaleHandleId
    ].opposite
      .getLatLng()
      .clone();
    this._scaleOriginPoint = map.project(this._scaleOriginLatLng);
    this._scaleStartHandlePoint = map.project(e.target.getLatLng());
    this._scaleStartDistance =
      this._scaleStartHandlePoint.distanceTo(this._scaleOriginPoint) || 1;

    if (this._layer instanceof L.Circle) {
      this._scaleStartRadius = this._layer.getRadius();
    } else {
      this._initialScaleLatLngs = copyLatLngs(this._layer);
    }

    const originLatLngs =
      this._layer instanceof L.Circle ? undefined : copyLatLngs(this._layer);
    this._fireScaleStart(this._layer, originLatLngs);
    this._fireScaleStart(this._layer._map, originLatLngs);
  },
  _onScale(e) {
    const map = this._layer._map;
    const currentPoint = map.project(e.target.getLatLng());
    const distance = currentPoint.distanceTo(this._scaleOriginPoint);

    let factor = distance / this._scaleStartDistance;
    if (!isFinite(factor) || factor < 0.02) {
      factor = 0.02;
    }

    if (this._layer instanceof L.Circle) {
      this._layer.setRadius(this._scaleStartRadius * factor);
    } else {
      this._layer.setLatLngs(
        this._scaleLatLngs(
          this._initialScaleLatLngs,
          this._scaleOriginPoint,
          factor,
          map
        )
      );
      this._refreshScaleHandles(e.target);
    }

    this._scaleFactor = factor;
    this._fireScale(
      this._layer,
      factor,
      this._initialScaleLatLngs,
      this._layer.getLatLngs && this._layer.getLatLngs()
    );
    this._fireScale(
      this._layer._map,
      factor,
      this._initialScaleLatLngs,
      this._layer.getLatLngs && this._layer.getLatLngs()
    );
    if (this._layer.getLatLngs) {
      this._fireChange(this._layer.getLatLngs(), 'Scale');
    }
  },
  _onScaleEnd() {
    const factor = this._scaleFactor;
    const originLatLngs = this._initialScaleLatLngs;
    const newLatLngs =
      (this._layer.getLatLngs && this._layer.getLatLngs()) || undefined;
    delete this._scaleOriginLatLng;
    delete this._scaleOriginPoint;
    delete this._scaleStartHandlePoint;
    delete this._scaleStartDistance;
    delete this._initialScaleLatLngs;
    delete this._scaleStartRadius;
    delete this._scaleFactor;

    this._fireScaleEnd(this._layer, factor, originLatLngs, newLatLngs);
    this._fireScaleEnd(this._layer._map, factor, originLatLngs, newLatLngs);
    this._fireEdit(this._layer, 'Scale');
  },
  _scaleLatLngs(latlngs, originPoint, factor, map) {
    if (L.Util.isArray(latlngs[0])) {
      return latlngs.map((part) =>
        this._scaleLatLngs(part, originPoint, factor, map)
      );
    }
    const fx = typeof factor === 'number' ? factor : factor.x;
    const fy = typeof factor === 'number' ? factor : factor.y;
    return latlngs.map((latlng) => {
      const point = map.project(latlng);
      const delta = point.subtract(originPoint);
      const scaled = originPoint.add(L.point(delta.x * fx, delta.y * fy));
      return map.unproject(scaled);
    });
  },

  /*
   * Public API: layer.pm.enableScale() / disableScale()
   */
  enableScale() {
    if (!this.options.allowScaling || this.scaleEnabled()) {
      return;
    }
    if (
      !(this._layer instanceof L.Polyline) &&
      !(this._layer instanceof L.Circle)
    ) {
      return;
    }

    this._scaleHandles = {};
    this._scaleEnabled = true;

    // a large layer is rendered with a decimated/culled subset - scale the
    // full geometry instead (issue #366). Only resume on disable when the
    // scaling itself suspended the optimization.
    const optimizeState = this._layer._pmOptimize;
    if (optimizeState && !optimizeState.suspended) {
      this._layer._map?.pm?._suspendOptimization?.(this._layer);
      this._scaleResumesOptimization = true;
    }

    const corners = this._getScaleCorners();
    const map = this._layer._map;
    const cornerKeys = ['topleft', 'topright', 'bottomright', 'bottomleft'];

    cornerKeys.forEach((key, i) => {
      const marker = L.marker(corners[i], {
        draggable: true,
        icon: L.divIcon({ className: 'leaflet-pm-scale-handle' }),
        pmIgnore: true,
        zIndexOffset: 1000,
      });
      marker._pmTempLayer = true;
      marker._scaleHandleId = key;
      marker.addTo(map);

      marker.on('dragstart', this._onScaleStart, this);
      marker.on('drag', this._onScale, this);
      marker.on('dragend', this._onScaleEnd, this);

      this._scaleHandles[key] = {
        marker,
        opposite: undefined,
      };
    });

    this._scaleHandles.topleft.opposite = this._scaleHandles.bottomright.marker;
    this._scaleHandles.topright.opposite = this._scaleHandles.bottomleft.marker;
    this._scaleHandles.bottomright.opposite = this._scaleHandles.topleft.marker;
    this._scaleHandles.bottomleft.opposite = this._scaleHandles.topright.marker;

    this._layer.on('remove', this.disableScale, this);
    // snapshot for layer.pm.cancel() / map.pm.cancelGlobalScaleMode()
    this._scaleCancelSnapshot = this._getScaleSnapshot();
    this._fireScaleEnable(this._layer);
    this._fireScaleEnable(this._layer._map);
  },
  // geometry of the layer as it was when Scale was enabled
  _getScaleSnapshot() {
    if (this._layer instanceof L.Circle) {
      return { radius: this._layer.getRadius() };
    }
    // optimized layers are suspended at this point, but ask for the full
    // geometry anyway so the snapshot never depends on the render state
    const mapPm = this._layer._map?.pm;
    const fullLatLngs = mapPm?._fullLatLngsOf?.(this._layer);
    return { latlngs: copyLatLngs(this._layer, fullLatLngs) };
  },
  /**
   * Reverts the layer to the state before it was changed by Scale.
   */
  cancel() {
    if (!this._scaleCancelSnapshot) {
      return;
    }
    const { latlngs, radius } = this._scaleCancelSnapshot;
    if (latlngs) {
      this._layer.setLatLngs(latlngs);
      // the restored geometry is the new source of truth for optimized layers
      if (this._layer._pmOptimize) {
        this._layer._pmOptimize.full = latlngs;
        this._layer._pmOptimize.displayActive = false;
        if (
          !this._layer._pmOptimize.suspended &&
          this._layer._map?.pm?._processLayer
        ) {
          this._layer._map.pm._processLayer(this._layer);
        }
      }
    } else if (radius !== undefined && this._layer instanceof L.Circle) {
      this._layer.setRadius(radius);
    }
    if (this.scaleEnabled()) {
      this._refreshScaleHandles();
    }
    if (this.enabled()) {
      this._initMarkers();
    }
    this.__fire(this._layer, 'pm:cancel', { layer: this._layer }, 'Scale');
    if (this._layer._map) {
      this.__fire(
        this._layer._map,
        'pm:cancel',
        { layer: this._layer },
        'Scale'
      );
    }
  },
  /**
   * Scales the layer programmatically.
   * `percent` scales the layer by that percentage - `50` grows it to 150%,
   * `-50` shrinks it to 50% - or pass `{ w, h }` to scale the axes
   * independently (also in percent). The layer is scaled around its center.
   */
  scaleLayer(percent) {
    if (
      !(this._layer instanceof L.Polyline) &&
      !(this._layer instanceof L.Circle)
    ) {
      return;
    }
    const map = this._layer._map;
    if (!map) {
      return;
    }

    let factor;
    if (typeof percent === 'number' && isFinite(percent)) {
      factor = Math.max(1 + percent / 100, 0.02);
    } else if (percent && typeof percent === 'object') {
      factor = {
        x: Math.max(1 + (percent.w || 0) / 100, 0.02),
        y: Math.max(1 + (percent.h || 0) / 100, 0.02),
      };
    } else {
      return;
    }

    // large layers are rendered with a subset - scale the full geometry and
    // hand the optimization back afterwards (issue #366)
    const optimizeState = this._layer._pmOptimize;
    let resumesOptimization = false;
    if (
      optimizeState &&
      !optimizeState.suspended &&
      map.pm?._suspendOptimization
    ) {
      map.pm._suspendOptimization(this._layer);
      resumesOptimization = true;
    }

    const originLatLngs = copyLatLngs(this._layer);
    const center = this._layer.getCenter();
    const originPoint = map.project(center);

    this._fireScaleStart(this._layer, originLatLngs);
    this._fireScaleStart(map, originLatLngs);

    if (this._layer instanceof L.Circle) {
      const radiusFactor =
        typeof factor === 'number' ? factor : (factor.x + factor.y) / 2;
      this._layer.setRadius(this._layer.getRadius() * radiusFactor);
    } else {
      this._layer.setLatLngs(
        this._scaleLatLngs(originLatLngs, originPoint, factor, map)
      );
      if (this.scaleEnabled()) {
        this._refreshScaleHandles();
      }
    }

    const newLatLngs =
      (this._layer.getLatLngs && this._layer.getLatLngs()) || undefined;
    if (resumesOptimization) {
      map.pm._resumeOptimization(this._layer);
    }
    const radiusFactor =
      typeof factor === 'number' ? factor : (factor.x + factor.y) / 2;
    this._fireScale(this._layer, radiusFactor, originLatLngs, newLatLngs);
    this._fireScale(map, radiusFactor, originLatLngs, newLatLngs);
    this._fireScaleEnd(this._layer, radiusFactor, originLatLngs, newLatLngs);
    this._fireScaleEnd(map, radiusFactor, originLatLngs, newLatLngs);
    this._fireEdit(this._layer, 'Scale');
  },
  disableScale() {
    if (!this.scaleEnabled()) {
      return;
    }
    Object.values(this._scaleHandles).forEach(({ marker }) => {
      marker.remove();
    });
    this._scaleHandles = undefined;
    this._scaleEnabled = false;

    this._layer.off('remove', this.disableScale, this);

    if (this._scaleResumesOptimization) {
      this._scaleResumesOptimization = false;
      this._layer._map?.pm?._resumeOptimization?.(this._layer);
    }
    delete this._scaleCancelSnapshot;

    this._fireScaleDisable(this._layer);
    this._fireScaleDisable(this._layer._map);
  },
  scaleEnabled() {
    return !!this._scaleEnabled;
  },
  _getScaleCorners() {
    if (this._layer instanceof L.Circle) {
      const center = this._layer.getLatLng();
      const radius = this._layer.getRadius();
      // convert meter radius to approx degrees
      const latDeg = radius / 111320;
      const lngDeg = radius / (111320 * Math.cos((center.lat * Math.PI) / 180));
      return [
        L.latLng(center.lat + latDeg, center.lng - lngDeg), // topleft
        L.latLng(center.lat + latDeg, center.lng + lngDeg), // topright
        L.latLng(center.lat - latDeg, center.lng + lngDeg), // bottomright
        L.latLng(center.lat - latDeg, center.lng - lngDeg), // bottomleft
      ];
    }
    const fullLatLngs =
      this._layer._map?.pm?._fullLatLngsOf?.(this._layer) ||
      this._layer.getLatLngs();
    const bounds = L.latLngBounds(this._getFlatLatLngs(fullLatLngs));
    return [
      bounds.getNorthWest(), // topleft
      bounds.getNorthEast(), // topright
      bounds.getSouthEast(), // bottomright
      bounds.getSouthWest(), // bottomleft
    ];
  },
  _refreshScaleHandles(excludeMarker) {
    if (!this.scaleEnabled()) {
      return;
    }
    const corners = this._getScaleCorners();
    const cornerKeys = ['topleft', 'topright', 'bottomright', 'bottomleft'];
    cornerKeys.forEach((key, i) => {
      const handle = this._scaleHandles[key];
      if (handle.marker !== excludeMarker) {
        handle.marker.setLatLng(corners[i]);
      }
    });
  },
  _getFlatLatLngs(latlngs = this._layer.getLatLngs(), result = []) {
    if (latlngs === undefined) {
      // L.Circle
      return [this._layer.getLatLng()];
    }
    if (L.Util.isArray(latlngs[0])) {
      latlngs.forEach((part) => this._getFlatLatLngs(part, result));
    } else {
      latlngs.forEach((latlng) => result.push(latlng));
    }
    return result;
  },
};

export default ScaleMixin;
