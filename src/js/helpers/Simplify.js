/**
 * Douglas-Peucker line simplification.
 * Works on flat arrays of L.LatLng. The first and the last point are always kept.
 */
function perpendicularDistance(point, start, end) {
  const { lat: y1, lng: x1 } = start;
  const { lat: y2, lng: x2 } = end;
  const { lat: y0, lng: x0 } = point;

  const dx = x2 - x1;
  const dy = y2 - y1;

  // the segment is a point -> distance to that point
  if (dx === 0 && dy === 0) {
    return Math.sqrt((x0 - x1) ** 2 + (y0 - y1) ** 2);
  }

  // distance between point and the infinite line through start & end
  return (
    Math.abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) /
    Math.sqrt(dx ** 2 + dy ** 2)
  );
}

export function douglasPeucker(points, epsilon) {
  if (points.length <= 2) {
    return points.slice();
  }

  let maxDistance = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i += 1) {
    const distance = perpendicularDistance(points[i], points[0], points[end]);
    if (distance > maxDistance) {
      index = i;
      maxDistance = distance;
    }
  }

  if (maxDistance > epsilon) {
    const left = douglasPeucker(points.slice(0, index + 1), epsilon);
    const right = douglasPeucker(points.slice(index), epsilon);
    // the split point is contained in both parts, so drop it from the right one
    return left.slice(0, -1).concat(right);
  }

  return [points[0], points[end]];
}

/**
 * Simplifies one ring (closed polyline, e.g. a polygon ring) or an open
 * polyline. Closed rings keep at least 3 vertices, open lines at least 2.
 */
export function simplifyRing(latlngs, epsilon, { closed = false } = {}) {
  if (!latlngs || latlngs.length <= 2) {
    return latlngs;
  }
  const simplified = douglasPeucker(latlngs, epsilon);
  const minLength = closed ? 3 : 2;
  if (simplified.length < minLength) {
    return latlngs;
  }
  return simplified;
}

/**
 * Calculates a default epsilon (in degrees) for a layer, relative to the
 * size of its bounding box, so the tolerance scales with the geometry.
 */
export function defaultEpsilon(latlngs, factor = 0.003) {
  const bounds = L.latLngBounds(latlngs);
  const latDistance = bounds.getNorth() - bounds.getSouth();
  const lngDistance = bounds.getEast() - bounds.getWest();
  const diagonal = Math.sqrt(latDistance ** 2 + lngDistance ** 2);
  return diagonal * factor;
}
