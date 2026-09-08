import { getTranslation } from '../helpers';
import { measureArea, measureLayer } from '../helpers/Measure';

/**
 * Measurements Mixin.
 * `map.pm.setGlobalOptions({ measurements: { measurement: true } })` shows
 * live measurements while drawing (a tooltip following the cursor marker)
 * and tooltips on finished layers while editing / hovering them.
 * `displayFormat: 'metric' | 'imperial'` selects the unit table and the
 * remaining flags (`totalLength`, `segmentLength`, `area`, `radius`,
 * `perimeter`, `height`, `width`, `coordinates`) toggle individual rows.
 */

// unit tables (display only - everything is
// measured in meters / square meters)
const UNITS = {
  metric: {
    distance: [
      {
        unit: 'cm',
        calculation: (m) => Math.round(m * 100 * 100) / 100,
        until: 1,
      },
      { unit: 'm', calculation: (m) => Math.round(m * 100) / 100, until: 1000 },
      { unit: 'km', calculation: (m) => Math.round((m / 1000) * 100) / 100 },
    ],
    area: [
      {
        unit: 'cm²',
        calculation: (a) => Math.round(a * 1e4 * 100) / 100,
        until: 1,
      },
      { unit: 'm²', calculation: (a) => Math.round(a * 100) / 100, until: 1e4 },
      {
        unit: 'ha',
        calculation: (a) => Math.round((a / 1e4) * 100) / 100,
        until: 1e6,
      },
      { unit: 'km²', calculation: (a) => Math.round((a / 1e6) * 100) / 100 },
    ],
  },
  imperial: {
    distance: [
      {
        unit: 'in',
        calculation: (m) => Math.round(m * 39.37 * 100) / 100,
        until: 0.3048,
      },
      {
        unit: 'ft',
        calculation: (m) => Math.round(m * 3.281 * 100) / 100,
        until: 0.9144,
      },
      {
        unit: 'yd',
        calculation: (m) => Math.round(m * 1.094 * 100) / 100,
        until: 1609.344,
      },
      { unit: 'mi', calculation: (m) => Math.round((m / 1609) * 100) / 100 },
    ],
    area: [
      {
        unit: 'in²',
        calculation: (a) => Math.round(a * 1550 * 100) / 100,
        until: 0.092903,
      },
      {
        unit: 'ft²',
        calculation: (a) => Math.round(a * 10.764 * 100) / 100,
        until: 0.836127,
      },
      {
        unit: 'yd²',
        calculation: (a) => Math.round(a * 1.196 * 100) / 100,
        until: 2591994.816,
      },
      {
        unit: 'mi²',
        calculation: (a) => Math.round((a / 2590000) * 100) / 100,
      },
    ],
  },
};

// shapes a measurement is calculated & displayed for
const MEASURE_SHAPES = [
  'Marker',
  'CircleMarker',
  'Circle',
  'Line',
  'Polygon',
  'Rectangle',
  'Cut',
  'Freehand',
  'Point',
];

const MeasurementsMixin = {
  _initMeasurements() {
    this.map.on('pm:create', (e) => this._applyMeasurementToNewLayer(e));
    this.map.on('layeradd', ({ layer }) => {
      if (
        this._measurementsEnabled() &&
        layer.pm &&
        layer.pm._shape &&
        !layer._pmTempLayer &&
        layer._map
      ) {
        this.addMeasurementTooltipToLayer(layer);
      }
    });
  },
  _measurementsEnabled() {
    const m = this.globalOptions.measurements;
    return !!(m && m.measurement && (m.showTooltip || m.showTooltipOnHover));
  },
  /**
   * Returns { length, area } (polylines / polygons) or
   * { radius, circumference, area } (circles). Large layers are measured
   * on their full geometry, not the rendered subset.
   */
  getMeasurement(layer) {
    const full =
      typeof this._fullLatLngsOf === 'function'
        ? this._fullLatLngsOf(layer)
        : undefined;
    return measureLayer(layer, full);
  },
  /**
   * calcMeasurement that never throws: degenerate / in-progress geometry
   * (empty rings, placeholder coords from boolean ops) simply reports no
   * measurement instead of aborting the operation that caused the layer.
   */
  _safeCalcMeasurement(layer) {
    try {
      return this.calcMeasurement(layer);
    } catch (e) {
      return {};
    }
  },
  /**
   * Dispatches to the shape specific measurement (also used
   * for the tooltips). `map` is needed for CRS based distance calculations.
   */
  calcMeasurement(layer, map = this.map) {
    if (layer instanceof L.Rectangle) {
      return this._measureRectangle(layer, map);
    }
    if (layer instanceof L.CircleMarker) {
      return this._measureCircle(layer, map);
    }
    if (layer instanceof L.Polygon) {
      return this._measurePolygon(layer, map);
    }
    if (layer instanceof L.Polyline) {
      return this._measurePolyline(layer, map);
    }
    return {};
  },
  // keeps only usable coordinates - boolean-op results and in-progress
  // layers can contain empty rings / placeholder entries, and the
  // measurement must never throw on them (it would abort the operation)
  _cleanRing(ring) {
    return (Array.isArray(ring) ? ring : []).filter(
      (ll) => ll && typeof ll.lat === 'number' && typeof ll.lng === 'number'
    );
  },
  _measurePolyline(layer, map) {
    const latlngs = this._cleanRing(layer.getLatLngs().flat());
    if (latlngs.length === 0) {
      return {};
    }
    return {
      distance: this._measureDistance(latlngs, map),
      segmentdistance: this._measureDistance(latlngs.slice(-2), map),
    };
  },
  _measurePolygon(layer, map) {
    // outer ring minus holes; the ring is closed before measuring so the
    // perimeter includes the last->first edge
    const rings = L.polygon(layer.getLatLngs()).getLatLngs();
    let distance;
    let area;
    let segmentdistance;
    rings.forEach((ring) => {
      const cleaned = this._cleanRing(ring);
      if (cleaned.length < 2) {
        return;
      }
      const closed = JSON.parse(JSON.stringify(cleaned));
      closed.push(closed[0]);
      const ringDistance = this._measureDistance(closed, map);
      const ringArea = measureArea(closed);
      const ringSegment = this._measureDistance(closed.slice(-3, -1), map);
      if (distance === undefined) {
        distance = ringDistance;
        area = ringArea;
        segmentdistance = ringSegment;
      } else {
        distance += ringDistance;
        area -= ringArea;
      }
    });
    return { distance, area, segmentdistance };
  },
  _measureRectangle(layer, map) {
    const { distance, area } = this._measurePolygon(layer, map);
    const bounds = layer.getBounds();
    const nw = bounds.getNorthWest();
    const ne = bounds.getNorthEast();
    const se = bounds.getSouthEast();
    return {
      height: map.distance(ne, se),
      width: map.distance(nw, ne),
      distance,
      area,
    };
  },
  _measureCircle(layer, map) {
    const radius =
      layer instanceof L.Circle
        ? layer.getRadius()
        : L.PM.Utils.pxRadiusToMeterRadius(
            layer.getRadius(),
            map,
            layer.getLatLng()
          );
    return {
      radius,
      area: radius ** 2 * Math.PI,
      distance: 2 * radius * Math.PI,
    };
  },
  _measureDistance(latlngs, map = this.map) {
    let distance = 0;
    let prev = null;
    latlngs.forEach((latlng) => {
      if (latlng && prev) {
        distance += map.distance(prev, latlng);
      }
      prev = latlng;
    });
    return distance;
  },
  // --- formatting (unit tables & rounding) ---
  _formatUnit(value, units) {
    let selected = null;
    units
      .filter((u) => u.until)
      .forEach((u) => {
        if (
          value < u.until &&
          (selected === null || selected.until > u.until)
        ) {
          selected = u;
        }
      });
    if (!selected) {
      const openEnded = units.filter((u) => !u.until);
      selected = openEnded.length > 0 ? openEnded[0] : units[0];
    }
    if (!selected.calculation) {
      selected.calculation = (v) => v;
    }
    return selected;
  },
  _formatDistance(value) {
    if (!value) {
      return { value: 0, unit: 'm' };
    }
    const table = UNITS[this.globalOptions.measurements.displayFormat];
    if (table && table.distance.length > 0) {
      const unit = this._formatUnit(value, table.distance);
      return { value: unit.calculation(value), unit: unit.unit };
    }
    return value < 1000
      ? { value: Math.round(value), unit: 'm' }
      : { value: Math.round((value / 1000) * 100) / 100, unit: 'km' };
  },
  _formatDistanceToString(value) {
    if (!value) {
      return '';
    }
    const { value: v, unit } = this._formatDistance(value);
    return `${Number(v).toLocaleString()}${unit}`;
  },
  _formatArea(value) {
    if (!value) {
      return { value: 0, unit: 'm²' };
    }
    const table = UNITS[this.globalOptions.measurements.displayFormat];
    if (table && table.area.length > 0) {
      const unit = this._formatUnit(value, table.area);
      return { value: unit.calculation(value), unit: unit.unit };
    }
    return value < 1000
      ? { value: Math.round(value * 100) / 100, unit: 'm²' }
      : { value: Math.round((value / 1e6) * 100) / 100, unit: 'km²' };
  },
  _formatAreaToString(value) {
    if (!value) {
      return '';
    }
    const { value: v, unit } = this._formatArea(value);
    return `${Number(v).toLocaleString()}${unit}`;
  },
  _formatLatLng(latlng) {
    return latlng
      ? `Lat: ${latlng.lat.toFixed(6)}, Lon: ${latlng.lng.toFixed(6)}`
      : '';
  },
  _createInfoField(label, value, trailingBr = false) {
    if (value) {
      const field = `<strong>${label}: </strong>${value}`;
      return trailingBr ? `${field}<br>` : field;
    }
    return '';
  },
  /**
   * Builds the measurement html for `layer` and, while `marker` is given
   * (drawing / dragging), appends it to the marker's permanent tooltip.
   * The field order follows the shape specific layout.
   */
  showMeasurementTooltip(layer, marker, shape) {
    const options = this.globalOptions.measurements;
    this.unbindMeasureTooltips();
    // only geoman's own tooltip may be replaced - a tooltip the user bound
    // themselves is never touched
    if (layer.getTooltip() && layer.getTooltip() === layer._pmMeasureTooltip) {
      layer.unbindTooltip();
      layer._pmMeasureTooltip = undefined;
    }
    if (!options || !options.measurement) {
      return '';
    }

    const m = layer.pm?.measurements || this._safeCalcMeasurement(layer);
    const fields = {};
    if (options.totalLength) {
      fields.totalLength = this._createInfoField(
        getTranslation('measurements.totalLength'),
        this._formatDistanceToString(m.distance)
      );
    }
    if (options.segmentLength) {
      if (m.segmentdistance) {
        fields.segmentLength = this._createInfoField(
          getTranslation('measurements.segmentLength'),
          this._formatDistanceToString(m.segmentdistance)
        );
      } else if (m.segmentdistanceBefore || m.segmentdistanceAfter) {
        fields.segmentLength = '';
        if (m.segmentdistanceBefore) {
          fields.segmentLength += this._createInfoField(
            getTranslation('measurements.segmentLength'),
            this._formatDistanceToString(m.segmentdistanceBefore),
            !!m.segmentdistanceAfter
          );
        }
        if (m.segmentdistanceAfter) {
          fields.segmentLength += this._createInfoField(
            getTranslation('measurements.segmentLength'),
            this._formatDistanceToString(m.segmentdistanceAfter)
          );
        }
      }
    }
    if (options.area) {
      fields.area = this._createInfoField(
        getTranslation('measurements.area'),
        this._formatAreaToString(m.area)
      );
    }
    if (options.radius) {
      fields.radius = this._createInfoField(
        getTranslation('measurements.radius'),
        this._formatDistanceToString(m.radius)
      );
    }
    if (options.perimeter) {
      fields.perimeter = this._createInfoField(
        getTranslation('measurements.perimeter'),
        this._formatDistanceToString(m.distance)
      );
    }
    if (options.height) {
      fields.height = this._createInfoField(
        getTranslation('measurements.height'),
        this._formatDistanceToString(m.height)
      );
    }
    if (options.width) {
      fields.width = this._createInfoField(
        getTranslation('measurements.width'),
        this._formatDistanceToString(m.width)
      );
    }
    if (options.coordinates) {
      // `marker` may also be the dragged layer itself (a Path without
      // getLatLng) - only real markers carry the position row
      if (marker && typeof marker.getLatLng === 'function') {
        fields.coordinatesMarker = this._createInfoField(
          getTranslation('measurements.coordinatesMarker'),
          this._formatLatLng(marker.getLatLng())
        );
      }
      if (layer.getLatLng) {
        fields.coordinates = this._createInfoField(
          getTranslation('measurements.coordinates'),
          this._formatLatLng(layer.getLatLng())
        );
      }
    }

    // shape specific row order
    const shapeName =
      shape || layer.pm?._shape || (layer instanceof L.Marker ? 'Marker' : '');
    let order = [];
    switch (shapeName) {
      case 'Rectangle':
        order = ['area', 'perimeter', 'height', 'width'];
        if (marker) {
          order.push('coordinatesMarker');
        }
        break;
      case 'Polygon':
      case 'Cut':
        order = ['area', 'perimeter'];
        if (marker) {
          order.push('segmentLength', 'coordinatesMarker');
        }
        break;
      case 'Line':
      case 'Freehand':
        order = ['totalLength'];
        if (marker) {
          order.push('segmentLength', 'coordinatesMarker');
        }
        break;
      case 'Circle':
        order = ['radius', 'area', 'perimeter'];
        if (marker) {
          order.push('coordinatesMarker');
        }
        break;
      case 'Marker':
      case 'Text':
      case 'Point':
        order = ['coordinates'];
        break;
      case 'CircleMarker':
        order = this.options?.resizeableCircleMarker
          ? ['radius', 'area', 'perimeter']
          : ['coordinates'];
        if (marker && this.options?.resizeableCircleMarker) {
          order.push('coordinatesMarker');
        }
        break;
      default:
        break;
    }

    let html = `<p class='leaflet-geoman-measurements'>`;
    order.forEach((name, i) => {
      if (fields[name]) {
        html += fields[name];
        if (i < order.length) {
          html += `<br>`;
        }
      }
    });
    html += `</p>`;
    if (html === `<p class='leaflet-geoman-measurements'></p>`) {
      html = '';
    }
    if (marker && options.showTooltip) {
      this.setMeasurementTooltip(html, marker);
    }
    return html;
  },
  /**
   * Appends the measurement html to `marker`'s tooltip (replacing a
   * previous measurement block), so the draw hint text stays visible.
   * Only tooltips created here are tracked for later removal - an
   * existing tooltip (the draw hint) belongs to its owner.
   */
  setMeasurementTooltip(html, marker) {
    if (!marker) {
      return;
    }
    if (!marker.getTooltip()) {
      marker.bindTooltip('', {
        permanent: true,
        offset: L.point(0, 10),
        direction: 'bottom',
        opacity: 0.8,
      });
      this._measureTooltipLayers = [marker];
    }
    let content = marker.getTooltip().getContent();
    content =
      content
        .replace(/<p class=['"]leaflet-geoman-measurements['"]>.*?<\/p>/, '')
        .trim() + html;
    marker.setTooltipContent(content);
  },
  unbindMeasureTooltips() {
    (this._measureTooltipLayers || []).forEach((layer) => {
      layer.unbindTooltip();
    });
    this._measureTooltipLayers = [];
  },
  /**
   * Binds the measurement tooltip shown while hovering a finished layer.
   */
  addMeasurementTooltipToLayer(layer) {
    // a tooltip the user bound themselves is never overwritten or removed
    if (layer.getTooltip() && layer.getTooltip() !== layer._pmMeasureTooltip) {
      layer._measurementsBound = false;
      return;
    }
    this.unbindMeasureTooltips();
    if (layer._pmMeasureTooltip) {
      layer.unbindTooltip();
      layer._pmMeasureTooltip = undefined;
    }
    const options = this.globalOptions.measurements;
    if (
      !options ||
      !options.measurement ||
      !options.showTooltipOnHover ||
      !layer.pm?._shape
    ) {
      return;
    }
    layer._measurementsBound = true;
    layer.pm.measurements = this._safeCalcMeasurement(layer);
    const html = this.showMeasurementTooltip(layer);
    if (!html) {
      return;
    }
    layer
      .bindTooltip('', {
        offset: L.point(0, 10),
        direction: 'bottom',
        opacity: 0.8,
      })
      .openTooltip();
    layer.setTooltipContent(html);
    layer._pmMeasureTooltip = layer.getTooltip();
  },
  /**
   * Refreshes (or removes) the measurement tooltip of an existing layer,
   * e.g. after `setGlobalOptions`, while a vertex / the whole layer is
   * being dragged (`marker` given) or after an edit. `segmentDistances`
   * (`{ before, after }`, from Edit.Line#_vertexSegmentDistances) replaces
   * the single segment row with the lengths around the dragged vertex.
   */
  _updateLayerMeasurement(layer, marker, segmentDistances) {
    if (!layer || !layer.pm?._shape) {
      return;
    }
    if (!this._measurementsEnabled()) {
      this._removeLayerMeasurement(layer);
      return;
    }
    layer.pm.measurements = this._safeCalcMeasurement(layer);
    if (marker && segmentDistances) {
      delete layer.pm.measurements.segmentdistance;
      layer.pm.measurements.segmentdistanceBefore = segmentDistances.before;
      layer.pm.measurements.segmentdistanceAfter = segmentDistances.after;
    }
    if (marker) {
      this.showMeasurementTooltip(layer, marker);
    } else {
      // rebinding also refreshes the content of an already bound tooltip
      layer._measurementsBound = true;
      this.addMeasurementTooltipToLayer(layer);
    }
  },
  _removeLayerMeasurement(layer) {
    if (
      layer &&
      layer.getTooltip() &&
      layer.getTooltip() === layer._pmMeasureTooltip
    ) {
      layer.unbindTooltip();
      layer._pmMeasureTooltip = undefined;
    }
    if (layer) {
      layer._measurementsBound = false;
    }
    this.unbindMeasureTooltips();
  },
  _applyMeasurementToNewLayer({ layer }) {
    if (
      layer &&
      layer.pm &&
      !(layer instanceof L.LayerGroup) &&
      MEASURE_SHAPES.includes(layer.pm._shape) &&
      !layer._pmTempLayer
    ) {
      layer._measurementsBound = true;
      this.addMeasurementTooltipToLayer(layer);
      layer.closeTooltip();
    }
  },
};

export default MeasurementsMixin;

/**
 * Converts raw measurements (meters / square meters, MeasurementData keyed)
 * into the `Measurement` structure
 * `{ value, unit, baseValueMeter }` returned by
 * `L.PM.Utils.getMeasurements(layer, map, displayFormat)`.
 */
export function toMeasurementData(raw, displayFormat = 'metric') {
  const table = UNITS[displayFormat] || UNITS.metric;
  const convert = (value, unitTable) => {
    if (value === undefined || value === null || !isFinite(value)) {
      return undefined;
    }
    let entry = unitTable[unitTable.length - 1];
    for (const candidate of unitTable) {
      if (candidate.until === undefined || value < candidate.until) {
        entry = candidate;
        break;
      }
    }
    return {
      value: entry.calculation(value),
      unit: entry.unit,
      baseValueMeter: value,
    };
  };

  const data = {};
  ['distance', 'segmentdistance', 'radius', 'height', 'width'].forEach(
    (key) => {
      const measurement = convert(raw[key], table.distance);
      if (measurement) {
        data[key] = measurement;
      }
    }
  );
  const area = convert(raw.area, table.area);
  if (area) {
    data.area = area;
  }
  return data;
}
