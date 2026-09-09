import lineIntersect from '@turf/line-intersect';
import lineSplit from '@turf/line-split';
import Draw from './L.PM.Draw';
import {
  difference,
  flattenPolyline,
  groupToMultiLineString,
  intersect,
  turfFeatureCollection,
  turfPolygon,
} from '../helpers/turfHelper';

/**
 * Split Mode.
 * Draw a line across polygons or polylines to split them. For polygons, the
 * split line is converted into a large rectangle covering one side of the
 * target geometry; intersect/difference with that rectangle then yields the
 * two parts (this also distributes holes to the correct part).
 */
Draw.Split = Draw.Line.extend({
  initialize(map) {
    this._map = map;
    this._shape = 'Split';
    this.toolbarButtonName = 'splitMode';
  },
  _finishShape() {
    this._editedLayers = [];

    if (
      this.options.requireSnapToFinish &&
      !this._hintMarker._snapped &&
      !this._isFirstLayer()
    ) {
      return;
    }

    // get coordinates
    const coords = this._layer.getLatLngs();
    if (coords.length < 2) {
      return;
    }

    const lineLayer = L.polyline(coords, this.options.pathOptions);
    this.split(lineLayer);

    // clean up snapping states
    this._cleanupSnapping();

    this._editedLayers.forEach(({ layer, originalLayer }) => {
      const payload = {
        layers: layer instanceof L.LayerGroup ? layer.getLayers() : [layer],
        originalLayer,
        splitLayer: lineLayer,
        shape:
          (originalLayer.pm &&
            originalLayer.pm.getShape &&
            originalLayer.pm.getShape()) ||
          (originalLayer instanceof L.Polygon ? 'Polygon' : 'Line'),
      };
      // fire pm:split on the splitted layer
      this._fireSplit(originalLayer, payload);
      // fire pm:split on the map
      this._fireSplit(this._map, payload);
      // fire edit event after split
      originalLayer.pm._fireEdit(originalLayer, 'Split');
    });
    this._editedLayers = [];

    const hintMarkerLatLng = this._hintMarker.getLatLng();

    // disable drawing
    this.disable();
    if (this.options.continueDrawing) {
      this.enable();
      this._hintMarker.setLatLng(hintMarkerLatLng);
    }
  },
  split(layer) {
    const all = this._map._layers;

    // Split API: with `splitOnlyMarkedLayers` only layers opted in
    // with `splitMark: true` are splittable, otherwise layers can be
    // excluded with `splitMark: false`
    const onlyMarked = !!this.options.splitOnlyMarkedLayers;
    const isSplittable = (l) => {
      const splitMark = l.pm.options.splitMark;
      if (onlyMarked) {
        return splitMark === true;
      }
      return splitMark !== false;
    };

    // find all layers that intersect with the drawn splitting line
    const layers = Object.keys(all)
      .map((l) => all[l])
      .filter((l) => l.pm)
      .filter((l) => !l._pmTempLayer)
      .filter(
        (l) =>
          (!L.PM.optIn && !l.options.pmIgnore) ||
          (L.PM.optIn && l.options.pmIgnore === false)
      )
      .filter((l) => l instanceof L.Polyline)
      .filter((l) => l !== layer)
      .filter(isSplittable)
      .filter((l) => !this._layerGroup.hasLayer(l))
      // only layers with intersections
      .filter((l) => {
        try {
          return (
            !!lineIntersect(layer.toGeoJSON(15), l.toGeoJSON(15)).features
              .length > 0
          );
        } catch (e) {
          return false;
        }
      });

    layers.forEach((l) => {
      let diff;
      if (l instanceof L.Polygon) {
        diff = this._splitPolygon(layer, l);
      } else {
        diff = this._splitLine(layer, l);
      }
      if (!diff) {
        return;
      }

      const resultingLayer = replaceLayersWithSplitResult(this._map, l, diff);
      this._editedLayers.push({
        layer: resultingLayer,
        originalLayer: l,
      });
    });
  },
  /**
   * Splits a polygon with the drawn line by intersecting / differencing it
   * with a large rectangle built along the line. Returns a FeatureCollection
   * with both parts or null if the line doesn't split the polygon.
   */
  _splitPolygon(lineLayer, polygonLayer) {
    const lineGeoJSON = lineLayer.toGeoJSON(15);
    const polygonGeoJSON = polygonLayer.toGeoJSON(15);

    try {
      const cutter = this._buildCutterPolygon(lineLayer, polygonLayer);
      const sideA = intersect(polygonGeoJSON, cutter);
      const sideB = difference(polygonGeoJSON, cutter);

      if (!sideA || !sideB) {
        // the line doesn't dissect the polygon into two parts
        return null;
      }

      return turfFeatureCollection([sideA, sideB]);
    } catch (e) {
      console.error(
        "Leaflet-Geoman: can't split polygons with self-intersections"
      );
      return null;
    }
  },
  /**
   * Builds a rectangle along the (extended) splitting line that is large
   * enough to cover one half of the bounding box of target + line.
   */
  _buildCutterPolygon(lineLayer, targetLayer) {
    const line = lineLayer.getLatLngs();
    const a = line[0];
    const b = line[line.length - 1];

    const bounds = L.latLngBounds(line);
    const targetLatLngs =
      targetLayer._map?.pm?._fullLatLngsOf?.(targetLayer) ||
      targetLayer.getLatLngs();
    flattenLatLngs(targetLatLngs).forEach((latlng) => {
      bounds.extend(latlng);
    });

    // extension length: bbox diagonal is always enough to reach beyond the target
    const diag = Math.sqrt(
      (bounds.getNorth() - bounds.getSouth()) ** 2 +
        (bounds.getEast() - bounds.getWest()) ** 2
    );

    // extend the line beyond the bbox, continuing along the direction of its
    // first/last segment so the actual (possibly bent) path is preserved
    const afterA = line.length > 1 ? line[1] : b;
    const beforeB = line.length > 1 ? line[line.length - 2] : a;

    let dxStart = a.lng - afterA.lng;
    let dyStart = a.lat - afterA.lat;
    const lenStart = Math.sqrt(dxStart ** 2 + dyStart ** 2) || 1;
    dxStart /= lenStart;
    dyStart /= lenStart;
    const a0 = L.latLng(a.lat + dyStart * diag, a.lng + dxStart * diag);

    let dxEnd = b.lng - beforeB.lng;
    let dyEnd = b.lat - beforeB.lat;
    const lenEnd = Math.sqrt(dxEnd ** 2 + dyEnd ** 2) || 1;
    dxEnd /= lenEnd;
    dyEnd /= lenEnd;
    const b0 = L.latLng(b.lat + dyEnd * diag, b.lng + dxEnd * diag);

    // perpendicular offset (to one side, so the cutter covers a half-plane),
    // based on the overall start-to-end direction of the drawn line
    let dx = b.lng - a.lng;
    let dy = b.lat - a.lat;
    const len = Math.sqrt(dx ** 2 + dy ** 2) || 1;
    dx /= len;
    dy /= len;
    const px = -dy * diag;
    const py = dx * diag;

    // polygon whose inner edge follows the entire drawn line (extended
    // beyond the bbox at both ends), closed with a far offset loop to one side
    const ring = [
      [a0.lng, a0.lat],
      ...line.map((latlng) => [latlng.lng, latlng.lat]),
      [b0.lng, b0.lat],
      [b0.lng + px, b0.lat + py],
      [a0.lng + px, a0.lat + py],
      [a0.lng, a0.lat],
    ];
    return turfPolygon([ring]);
  },
  _splitLine(lineLayer, targetLayer) {
    const features = flattenPolyline(targetLayer);
    const splitParts = [];

    features.forEach((feature) => {
      const splitter = lineLayer.toGeoJSON(15);
      const lineDiff = lineSplit(feature, splitter);
      if (lineDiff && lineDiff.features.length > 1) {
        lineDiff.features.forEach((part) => splitParts.push(part));
      } else {
        splitParts.push(feature);
      }
    });

    if (splitParts.length < 2) {
      return null;
    }
    return groupToMultiLineString(L.geoJSON(turfFeatureCollection(splitParts)));
  },
  _change: L.Util.falseFn,
});

function flattenLatLngs(latlngs, result = []) {
  if (L.Util.isArray(latlngs[0])) {
    latlngs.forEach((part) => flattenLatLngs(part, result));
  } else {
    latlngs.forEach((latlng) => result.push(latlng));
  }
  return result;
}

function replaceLayersWithSplitResult(map, originalLayer, geojson) {
  let resultLayer = L.geoJSON(geojson, originalLayer.options);
  if (resultLayer.getLayers().length === 1) {
    [resultLayer] = resultLayer.getLayers();
  }
  const panes = map.pm.globalOptions.panes;
  resultLayer.options.pane = (panes && panes.layerPane) || 'overlayPane';
  const resultingLayer = resultLayer.addTo(map.pm._getContainingLayer());

  resultingLayer.pm.enable(originalLayer.pm.options);
  resultingLayer.pm.disable();

  originalLayer._pmTempLayer = true;
  originalLayer.remove();
  originalLayer.removeFrom(map.pm._getContainingLayer());

  if (resultingLayer instanceof L.LayerGroup) {
    resultingLayer.eachLayer((_layer) => {
      _layer._drawnByGeoman = true;
    });
  }
  resultingLayer._drawnByGeoman = true;

  return resultingLayer;
}
