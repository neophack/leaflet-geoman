import polygonClipping from 'polygon-clipping';

export function feature(geom) {
  const feat = { type: 'Feature' };
  feat.geometry = geom;
  return feat;
}

export function getGeometry(geojson) {
  if (geojson.type === 'Feature') return geojson.geometry;
  return geojson;
}

export function getCoords(geojson) {
  if (geojson && geojson.geometry && geojson.geometry.coordinates)
    return geojson.geometry.coordinates;
  return geojson;
}

export function turfPoint(coords, precision = -1) {
  if (precision > -1) {
    coords[0] = L.Util.formatNum(coords[0], precision);
    coords[1] = L.Util.formatNum(coords[1], precision);
  }

  return feature({ type: 'Point', coordinates: coords });
}

export function turfLineString(coords) {
  return feature({ type: 'LineString', coordinates: coords });
}

export function turfMultiLineString(coords) {
  return feature({ type: 'MultiLineString', coordinates: coords });
}

export function turfPolygon(coords) {
  return feature({ type: 'Polygon', coordinates: coords });
}

export function turfMultiPolygon(coords) {
  return feature({ type: 'MultiPolygon', coordinates: coords });
}

function doShapesIntersect(line, polygon) {
  const polygonCoords = polygon.geometry.coordinates[0];
  const lineCoords = line.geometry.coordinates[0];

  // Function to check if two line segments intersect
  function doLinesIntersect(a, b, c, d) {
    function ccw(p1, p2, p3) {
      return (p3[1] - p1[1]) * (p2[0] - p1[0]) > (p2[1] - p1[1]) * (p3[0] - p1[0]);
    }

    return (
      ccw(a, c, d) !== ccw(b, c, d) &&
      ccw(a, b, c) !== ccw(a, b, d)
    );
  }

  // Function to check if a point lies on a line segment
  function isPointOnLineSegment(p, a, b) {
    const d = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
    return Math.abs(d) < Number.EPSILON;
  }

  // Check if the line coincides with any edge of the polygon
  for (let i = 0; i < polygonCoords.length - 1; i++) {
    const p1 = polygonCoords[i];
    const p2 = polygonCoords[i + 1];
    for (let j = 0; j < lineCoords.length - 1; j++) {
      const p3 = lineCoords[j];
      const p4 = lineCoords[j + 1];

      // Check if the line coincides with an edge of the polygon
      if (isPointOnLineSegment(p3, p1, p2) && isPointOnLineSegment(p4, p1, p2)) {
        return false; // The line coincides with an edge, so it's not considered intersecting
      }
    }
  }

  // Check if any line segment of the polygon intersects with the line
  for (let i = 0; i < polygonCoords.length - 1; i++) {
    const p1 = polygonCoords[i];
    const p2 = polygonCoords[i + 1];
    for (let j = 0; j < lineCoords.length - 1; j++) {
      const p3 = lineCoords[j];
      const p4 = lineCoords[j + 1];
      if (doLinesIntersect(p1, p2, p3, p4)) {
        return true;
      }
    }
  }

  return false;
}

export function multiPolygonToPolygons(feature) {
  const result = [];

  // 遍历每个feature

    const geometry = feature.geometry;

    // 检查几何类型是否为MultiPolygon
    if (geometry && geometry.type === "MultiPolygon") {
      // 将MultiPolygon转换为多个Polygon
      geometry.coordinates.forEach((polygonCoords) => {
        result.push({
          type: "Feature",
          properties: feature.properties,
          geometry: {
            type: "Polygon",
            coordinates: polygonCoords,
          },
        });
      });
    } else {
      // 对于非MultiPolygon类型的feature，直接添加到结果中
      result.push(feature);
    }


  // 返回转换后的GeoJSON对象
  return {
    type: "FeatureCollection",
    features: result,
  };
}

// 定义函数，合并与线相邻的两个多边形
export function mergePolygonsWithLine(polygon1, polygon2, line) {
  // 调用polygon-clipping的union函数进行合并
  const mergedPolygon = polygonClipping.union(polygon1.geometry.coordinates, polygon2.geometry.coordinates);

  // 判断合并后的多边形是否与线相交
  const intersection =
    doShapesIntersect(line, feature({ type: 'Polygon', coordinates: mergedPolygon[0] }));
  if (intersection) {
    // 如果与线相交，返回合并后的多边形
    return turfPolygon(mergedPolygon[0]);
  } else {
    // 如果不相交
    return null;
  }
}
export function turfFeatureCollection(features) {
  return { type: 'FeatureCollection', features };
}

export function intersect(poly1, poly2) {
  const geom1 = getGeometry(poly1);
  const geom2 = getGeometry(poly2);

  const intersection = polygonClipping.intersection(
    geom1.coordinates,
    geom2.coordinates
  );
  if (intersection.length === 0) return null;
  if (intersection.length === 1) return turfPolygon(intersection[0]);
  return turfMultiPolygon(intersection);
}

export function difference(polygon1, polygon2) {
  const geom1 = getGeometry(polygon1);
  const geom2 = getGeometry(polygon2);

  const differenced = polygonClipping.difference(
    geom1.coordinates,
    geom2.coordinates
  );
  if (differenced.length === 0) return null;
  if (differenced.length === 1) return turfPolygon(differenced[0]);
  return turfMultiPolygon(differenced);
}

// LineString coords returns 1
// MultiLineString coords returns 2
export function getDepthOfCoords(coords) {
  if (Array.isArray(coords)) {
    return 1 + getDepthOfCoords(coords[0]);
  }
  return -1; // return -1 because this is already the lng of the lnglat (geojson) array
}

export function flattenPolyline(polyline) {
  if (polyline instanceof L.Polyline) {
    polyline = polyline.toGeoJSON(15);
  }

  const coords = getCoords(polyline);
  const depth = getDepthOfCoords(coords);
  const features = [];
  if (depth > 1) {
    coords.forEach((coord) => {
      features.push(turfLineString(coord));
    });
  } else {
    features.push(polyline);
  }

  return features;
}

export function groupToMultiLineString(group) {
  const coords = [];
  group.eachLayer((layer) => {
    coords.push(getCoords(layer.toGeoJSON(15)));
  });
  return turfMultiLineString(coords);
}

export function convertToLatLng(coords) {
  const lnglat = getCoords(coords);
  return L.latLng(lnglat[1], lnglat[0]);
}

export function convertArrayToLatLngs(arr) {
  const latlngs = [];
  if (arr.features) {
    arr.features.forEach((geojson) => {
      latlngs.push(convertToLatLng(geojson));
    });
  }
  return latlngs;
}
