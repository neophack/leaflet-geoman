import { checkGeofencing } from '../helpers/Geofence';

/**
 * Geofencing Mixin.
 * `preventIntersection` / `requireContainment` layer options restrict where
 * a layer may be drawn or edited. Hooked into the shared `_fireChange`
 * lifecycle (Mixins/Events.js), so it runs for Draw, Edit, Rotation, Scale
 * and Drag alike. Included in the same classes as the Snapping/SnapGuides
 * mixins (Draw and Edit).
 *
 * On a violation the offending layer (or, while drawing a Line/Polygon, its
 * hintline) turns red and `pm:intersectionviolation` / `pm:containment
 * violation` fires. While drawing a Line/Polygon, placing the violating
 * vertex is blocked (mirrors the existing `allowSelfIntersection` UX).
 */
const GeofencingMixin = {
  _checkGeofencing(latlngs, source) {
    const layer = this._layer;
    if (!layer || !this.options) {
      return;
    }
    const { preventIntersection, requireContainment } = this.options;
    const hasRules =
      (preventIntersection && preventIntersection.length > 0) ||
      (requireContainment && requireContainment.length > 0);

    if (!hasRules) {
      if (this._geofenceViolation) {
        this._applyGeofenceViolation(null, source);
      }
      return;
    }

    // the working layer of a Line/Polygon draw doesn't yet include the
    // cursor position - check a throwaway layer that does, same trick used
    // by _handleSelfIntersection. Circle/CircleMarker draws pass a single
    // center latlng instead of an array and already keep `this._layer`
    // (with its current radius) up to date, so use it as-is.
    let checkLayer = layer;
    if (source === 'Draw' && Array.isArray(latlngs)) {
      if (latlngs.length < 2) {
        // not enough points yet for a meaningful line/polygon check
        this._applyGeofenceViolation(null, source);
        return;
      }
      try {
        checkLayer =
          layer instanceof L.Polygon ? L.polygon(latlngs) : L.polyline(latlngs);
      } catch (e) {
        checkLayer = layer;
      }
    }

    this._applyGeofenceViolation(
      checkGeofencing(checkLayer, this.options),
      source
    );
  },
  _applyGeofenceViolation(violation, source) {
    const layer = this._layer;
    const isDraw = source === 'Draw';
    const styledLayer = isDraw && this._hintline ? this._hintline : layer;
    const wasViolated = this._geofenceViolation;
    this._geofenceViolation = violation;

    if (violation === wasViolated) {
      return;
    }

    if (violation) {
      if (typeof styledLayer?.setStyle === 'function') {
        if (!isDraw && !this._geofenceOriginalStyle) {
          this._geofenceOriginalStyle = {
            color: layer.options.color,
            weight: layer.options.weight,
            fillColor: layer.options.fillColor,
            fillOpacity: layer.options.fillOpacity,
          };
        }
        styledLayer.setStyle({ color: '#f00000ff' });
      }
      if (violation === 'intersection') {
        this._fireIntersectionViolation(this._map, source);
      } else {
        this._fireContainmentViolation(this._map, source);
      }
    } else if (
      !this._doesSelfIntersect &&
      typeof styledLayer?.setStyle === 'function'
    ) {
      // leave self-intersection (a separate, independently-tracked red
      // state) in charge of the color if it's still active
      styledLayer.setStyle(
        isDraw
          ? this.options.hintlineStyle || {}
          : this._geofenceOriginalStyle || {}
      );
    }
  },
};

export default GeofencingMixin;
