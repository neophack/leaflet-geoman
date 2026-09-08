/**
 * Geodesic measurement helpers (issue #351: display area/distance while
 * drawing). Distances use the haversine formula, areas an equirectangular
 * projection around the shape latitude (accurate enough for display).
 */

const EARTH_RADIUS = 6371008.8; // meters (mean earth radius)

export function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function flattenLatLngs(latlngs, result = []) {
  if (!latlngs || !Array.isArray(latlngs)) {
    return result;
  }
  if (L.Util.isArray(latlngs[0])) {
    latlngs.forEach((part) => flattenLatLngs(part, result));
  } else {
    latlngs.forEach((ll) => result.push(ll));
  }
  return result;
}

function isLatLngLike(v) {
  return v && typeof v.lat === 'number' && typeof v.lng === 'number';
}

// length of one flat ring; `closed` adds the last->first edge
function ringLength(ring, closed) {
  let length = 0;
  for (let i = 1; i < ring.length; i += 1) {
    length += distanceMeters(ring[i - 1], ring[i]);
  }
  if (closed && ring.length > 1) {
    length += distanceMeters(ring[ring.length - 1], ring[0]);
  }
  return length;
}

// shoelace area of one flat ring (equirectangular approximation)
function ringArea(ring) {
  if (!ring || ring.length < 3) {
    return 0;
  }
  const latRad = (ring[0].lat * Math.PI) / 180;
  const kx = 111320 * Math.cos(latRad); // meters per lng degree
  const ky = 110540; // meters per lat degree

  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const x1 = ring[j].lng * kx;
    const y1 = ring[j].lat * ky;
    const x2 = ring[i].lng * kx;
    const y2 = ring[i].lat * ky;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

/**
 * Total line length. Nested coordinate arrays (multi-part lines) are summed
 * per part - no phantom jump segments between parts.
 */
export function measureLength(latlngs) {
  if (!latlngs || !Array.isArray(latlngs) || latlngs.length === 0) {
    return 0;
  }
  if (isLatLngLike(latlngs[0])) {
    return ringLength(latlngs, false);
  }
  return latlngs.reduce((sum, part) => sum + measureLength(part), 0);
}

/**
 * Perimeter of a (multi-)polygon: every ring contributes its closed length.
 */
export function measurePerimeter(latlngs) {
  if (!latlngs || !Array.isArray(latlngs) || latlngs.length === 0) {
    return 0;
  }
  if (isLatLngLike(latlngs[0])) {
    return ringLength(latlngs, true);
  }
  return latlngs.reduce((sum, part) => sum + measurePerimeter(part), 0);
}

/**
 * Area of a (multi-)polygon. Holes (2nd+ ring of a polygon part) are
 * subtracted, parts of a MultiPolygon are summed.
 */
export function measureArea(latlngs) {
  if (!latlngs || !Array.isArray(latlngs) || latlngs.length === 0) {
    return 0;
  }
  if (isLatLngLike(latlngs[0])) {
    // a single ring
    return ringArea(latlngs);
  }
  if (
    Array.isArray(latlngs[0]) &&
    latlngs[0].length > 0 &&
    isLatLngLike(latlngs[0][0])
  ) {
    // rings of one polygon: outer ring minus holes
    let area = ringArea(latlngs[0]);
    for (let i = 1; i < latlngs.length; i += 1) {
      area -= ringArea(latlngs[i]);
    }
    return Math.max(0, area);
  }
  // array of polygon parts (MultiPolygon)
  return latlngs.reduce((sum, part) => sum + measureArea(part), 0);
}

export function formatLength(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

export function formatArea(sqMeters) {
  if (sqMeters < 10000) {
    return `${Math.round(sqMeters)} m²`;
  }
  if (sqMeters < 1000000) {
    return `${(sqMeters / 10000).toFixed(2)} ha`;
  }
  return `${(sqMeters / 1000000).toFixed(2)} km²`;
}

/**
 * Public API: returns the measurement of any layer.
 * { length, area, radius, circumference } - depending on the layer type.
 * `coordsOverride` are full coordinates for layers rendered with a subset.
 */
export function measureLayer(layer, coordsOverride) {
  // only L.Circle's radius is a geographic (meter) radius - a plain
  // L.CircleMarker's getRadius() is a screen-pixel radius and must not be
  // reported as a real-world measurement
  if (layer instanceof L.Circle && typeof layer.getRadius === 'function') {
    const radius = layer.getRadius();
    return {
      radius,
      circumference: 2 * Math.PI * radius,
      area: Math.PI * radius ** 2,
    };
  }
  // markers and other layers without multi-coordinates have no measurement
  if (typeof layer.getLatLngs !== 'function') {
    return { length: 0, area: 0 };
  }
  const latlngs = coordsOverride ?? layer.getLatLngs();
  if (layer instanceof L.Polygon) {
    return {
      length: measurePerimeter(latlngs),
      area: measureArea(latlngs),
    };
  }
  if (layer instanceof L.Polyline) {
    return { length: measureLength(latlngs), area: 0 };
  }
  return { length: 0, area: 0 };
}

/**
 * Tooltip text for the drawing phase. `latlngs` are the current working
 * coordinates (including the cursor position). `closed` treats the shape as
 * a polygon (area + closed perimeter), needed because the working layer of a
 * polygon draw is a plain polyline.
 */
export function measureDrawText(layer, latlngs, { closed = false } = {}) {
  if (!layer) {
    return '';
  }
  if (layer instanceof L.Circle) {
    const radius = layer.getRadius();
    if (!radius) {
      return '';
    }
    const circleArea = Math.PI * radius ** 2;
    return `${formatLength(radius)} · ${formatArea(circleArea)}`;
  }
  // a plain L.CircleMarker (e.g. the precise-position draw point) has a
  // fixed screen-pixel radius, not a geographic one - nothing to measure
  if (layer instanceof L.CircleMarker) {
    return '';
  }
  const flat = flattenLatLngs(latlngs);
  if (flat.length < 2) {
    return '';
  }
  const length = measureLength(flat);
  if (closed || layer instanceof L.Polygon) {
    // polygon: close the ring for area & perimeter
    const closedRing = flat.concat([flat[0]]);
    return `${formatLength(measureLength(closedRing))} · ${formatArea(measureArea(closedRing))}`;
  }
  return formatLength(length);
}
