/**
 * Geofencing helpers.
 * `preventIntersection` / `requireContainment` layer options restrict where a
 * layer may be drawn or edited relative to a set of boundary layers.
 */
import lineIntersect from '@turf/line-intersect';
import booleanContains from '@turf/boolean-contains';

const EARTH_RADIUS = 6371008.8; // meters (mean earth radius), matches Measure.js

// L.Circle.toGeoJSON() only reports the center as a Point (radius is stashed
// in properties, not real GeoJSON) - approximate the geographic circle as a
// polygon so it can be used in contains/intersects checks.
function circleToPolygon(circle, steps = 64) {
  const center = circle.getLatLng();
  const radius = circle.getRadius();
  const rad = Math.PI / 180;
  const kx = EARTH_RADIUS * Math.cos(center.lat * rad);
  const coords = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (radius * Math.cos(angle)) / EARTH_RADIUS / rad;
    const dLng = (radius * Math.sin(angle)) / kx / rad;
    coords.push([center.lng + dLng, center.lat + dLat]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] },
  };
}

export function toGeofenceGeoJSON(layer) {
  if (!layer) {
    return null;
  }
  if (layer instanceof L.Circle && typeof layer.getRadius === 'function') {
    return circleToPolygon(layer);
  }
  if (typeof layer.toGeoJSON !== 'function') {
    return null;
  }
  try {
    return layer.toGeoJSON(15);
  } catch (e) {
    return null;
  }
}

/**
 * Whether two GeoJSON Features/Geometries share any point, built from only
 * the turf modules already used elsewhere in this project (no new
 * dependency): boundary crossings via line-intersect, plus full containment
 * either way (line-intersect alone misses one shape sitting entirely inside
 * the other, with no crossing edges) and a direct coordinate check for
 * point-vs-point.
 */
export function geometriesIntersect(a, b) {
  const typeA = a?.geometry?.type;
  const typeB = b?.geometry?.type;
  if (!typeA || !typeB) {
    return false;
  }
  if (typeA === 'Point' || typeB === 'Point') {
    const point = typeA === 'Point' ? a : b;
    const other = typeA === 'Point' ? b : a;
    if (other.geometry.type === 'Point') {
      return (
        point.geometry.coordinates[0] === other.geometry.coordinates[0] &&
        point.geometry.coordinates[1] === other.geometry.coordinates[1]
      );
    }
    try {
      return booleanContains(other, point);
    } catch (e) {
      return false;
    }
  }
  try {
    if (lineIntersect(a, b).features.length > 0) {
      return true;
    }
  } catch (e) {
    // fall through to the containment check below
  }
  try {
    return booleanContains(a, b) || booleanContains(b, a);
  } catch (e) {
    return false;
  }
}

/**
 * Cheap lat/lng bounds of a layer, used to reject geofence candidates before
 * paying for a `toGeoJSON()` conversion and a turf call. Leaflet caches
 * `getBounds()` on Polyline/Polygon (just returns `this._bounds`), so this
 * never re-scans a layer's coordinates. Returns `null` when no bounds can be
 * determined (the caller must not skip anything in that case).
 */
function getGeofenceBounds(layer) {
  if (!layer) {
    return null;
  }
  if (typeof layer.getBounds === 'function') {
    try {
      const bounds = layer.getBounds();
      if (bounds && typeof bounds.isValid === 'function' && bounds.isValid()) {
        return bounds;
      }
    } catch (e) {
      // fall through to the point-based fallback below
    }
  }
  if (typeof layer.getLatLng === 'function') {
    try {
      const latlng = layer.getLatLng();
      if (latlng) {
        return L.latLngBounds(latlng, latlng);
      }
    } catch (e) {
      // no usable bounds
    }
  }
  return null;
}

/**
 * Whether two shapes' bounds are close enough that they could possibly
 * intersect. Only ever used to SKIP the expensive exact check - unknown
 * bounds never cause a skip, so this can't produce a false negative.
 */
function boundsMightOverlap(a, b) {
  if (!a || !b) {
    return true;
  }
  return a.intersects(b);
}

/**
 * Whether `containerBounds` can be proven to NOT contain `innerBounds`
 * (bounds containment is a necessary condition for geometry containment).
 * Only ever used to SKIP the expensive exact check for a single candidate -
 * unknown bounds never cause a skip.
 */
function boundsCannotContain(containerBounds, innerBounds) {
  if (!containerBounds || !innerBounds) {
    return false;
  }
  return !containerBounds.contains(innerBounds);
}

/**
 * Checks `layer` against its own `preventIntersection` / `requireContainment`
 * options (arrays of other layers). Returns 'intersection', 'containment' or
 * null (no violation / nothing configured).
 */
export function checkGeofencing(layer, options) {
  const geo = toGeofenceGeoJSON(layer);
  if (!geo) {
    return null;
  }
  // computed once per call, used to bounding-box pre-filter every candidate
  // below - this runs on every drag/mousemove frame, so avoiding a
  // toGeoJSON() conversion and a turf call for fences nowhere near `layer`
  // matters a lot when there are many of them
  const layerBounds = getGeofenceBounds(layer);

  const preventIntersection = options?.preventIntersection;
  if (preventIntersection && preventIntersection.length > 0) {
    const violated = preventIntersection.some((other) => {
      if (!other || other === layer) {
        return false;
      }
      const otherBounds = getGeofenceBounds(other);
      if (!boundsMightOverlap(layerBounds, otherBounds)) {
        return false;
      }
      const otherGeo = toGeofenceGeoJSON(other);
      return otherGeo && geometriesIntersect(geo, otherGeo);
    });
    if (violated) {
      return 'intersection';
    }
  }

  const requireContainment = options?.requireContainment;
  if (requireContainment && requireContainment.length > 0) {
    const contained = requireContainment.some((container) => {
      if (!container) {
        return false;
      }
      const containerBounds = getGeofenceBounds(container);
      if (boundsCannotContain(containerBounds, layerBounds)) {
        return false;
      }
      const containerGeo = toGeofenceGeoJSON(container);
      if (!containerGeo) {
        return false;
      }
      try {
        return booleanContains(containerGeo, geo);
      } catch (e) {
        return false;
      }
    });
    if (!contained) {
      return 'containment';
    }
  }

  return null;
}
