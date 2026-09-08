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
 * Checks `layer` against its own `preventIntersection` / `requireContainment`
 * options (arrays of other layers). Returns 'intersection', 'containment' or
 * null (no violation / nothing configured).
 */
export function checkGeofencing(layer, options) {
  const geo = toGeofenceGeoJSON(layer);
  if (!geo) {
    return null;
  }

  const preventIntersection = options?.preventIntersection;
  if (preventIntersection && preventIntersection.length > 0) {
    const violated = preventIntersection.some((other) => {
      if (!other || other === layer) {
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
