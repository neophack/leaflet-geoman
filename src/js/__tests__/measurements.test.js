// @vitest-environment jsdom
/**
 * Measurements: live length / area / radius display via
 * the `measurements` global option object.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import L from 'leaflet';

let map;

function square(n, s, w, e) {
  return [
    [s, w],
    [s, e],
    [n, e],
    [n, w],
  ];
}

function enableMeasurements(options = {}) {
  map.pm.setGlobalOptions({
    measurements: { measurement: true, displayFormat: 'metric', ...options },
  });
}

beforeAll(async () => {
  globalThis.L = L;
  await import('../L.PM.js');
});

afterAll(() => {
  if (map) map.remove();
});

beforeEach(() => {
  if (map) map.remove();
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', {
    value: 800,
    configurable: true,
  });
  Object.defineProperty(container, 'clientHeight', {
    value: 600,
    configurable: true,
  });
  document.body.appendChild(container);
  map = L.map(container, { center: [52.52, 13.4], zoom: 14 });
  map.pm.setGlobalOptions({ snappable: false });
});

describe('measure helpers', () => {
  it('measures the length of a polyline', () => {
    // 0.01 lat apart = ~1112 m
    const line = L.polyline([
      [52.5, 13.4],
      [52.51, 13.4],
    ]).addTo(map);
    const m = map.pm.getMeasurement(line);
    expect(m.length).toBeGreaterThan(1000);
    expect(m.length).toBeLessThan(1130);
  });

  it('measures the area of a polygon', () => {
    // 0.01 x 0.01 degrees square at lat 52.5 ≈ 0.68 km x 1.11 km
    const poly = L.polygon(square(52.51, 52.5, 13.4, 13.41)).addTo(map);
    const m = map.pm.getMeasurement(poly);
    expect(m.area).toBeGreaterThan(700000);
    expect(m.area).toBeLessThan(800000);
    // perimeter includes the closing edge
    expect(m.length).toBeGreaterThan(3500);
  });

  it('measures the radius and area of a circle', () => {
    const circle = L.circle([52.52, 13.4], { radius: 500 }).addTo(map);
    const m = map.pm.getMeasurement(circle);
    expect(m.radius).toBe(500);
    expect(m.circumference).toBeCloseTo(2 * Math.PI * 500, 0);
    expect(m.area).toBeCloseTo(Math.PI * 500 ** 2, -3);
  });

  it("does not report a plain CircleMarker's screen-pixel radius as meters", () => {
    // e.g. the precise-position draw point: a CircleMarker with a small,
    // constant on-screen radius that has no geographic meaning
    const dot = L.circleMarker([52.52, 13.4], { radius: 6 }).addTo(map);
    const m = map.pm.getMeasurement(dot);
    expect(m.radius).toBeUndefined();
    expect(m.area).toBe(0);
  });
});

describe('measurement formatting', () => {
  it('formats distances with the metric unit table', () => {
    enableMeasurements();
    expect(map.pm._formatDistanceToString(0.5)).toMatch(/50cm/);
    expect(map.pm._formatDistanceToString(123.456)).toMatch(/123\.46m/);
    expect(map.pm._formatDistanceToString(1740)).toMatch(/1\.74km/);
  });

  it('formats areas with the metric unit table', () => {
    enableMeasurements();
    expect(map.pm._formatAreaToString(50)).toMatch(/50m²/);
    expect(map.pm._formatAreaToString(745000)).toMatch(/74\.5ha/);
    expect(map.pm._formatAreaToString(2500000)).toMatch(/2\.5km²/);
  });

  it('formats with the imperial unit table when selected', () => {
    enableMeasurements({ displayFormat: 'imperial' });
    expect(map.pm._formatDistanceToString(24145)).toMatch(/15\.01mi/);
  });
});

describe('drawing with measurements', () => {
  it('shows the live length in the draw tooltip', () => {
    enableMeasurements();
    map.pm.Draw.Line.enable();
    const draw = map.pm.Draw.Line;

    draw._hintMarker.setLatLng([52.5, 13.4]);
    draw._createVertex({ latlng: [52.5, 13.4] });

    // move the cursor 0.01 lat -> ~1112 m
    draw._syncHintMarker({ latlng: [52.51, 13.4] });

    const content = draw._hintMarker.getTooltip().getContent();
    expect(content).toContain('leaflet-geoman-measurements');
    expect(content).toMatch(/<strong>Length: <\/strong>1\.1\dkm/);
    expect(content).toMatch(/<strong>Segment length: <\/strong>1\.1\dkm/);
    expect(content).toMatch(/<strong>Position Marker: <\/strong>Lat: /);
    draw.disable();
  });

  it('shows the live area for polygons', () => {
    enableMeasurements();
    map.pm.Draw.Polygon.enable();
    const draw = map.pm.Draw.Polygon;

    [
      [52.5, 13.4],
      [52.5, 13.41],
      [52.51, 13.41],
    ].forEach((latlng) => {
      draw._hintMarker.setLatLng(latlng);
      draw._createVertex({ latlng });
    });
    draw._syncHintMarker({ latlng: [52.51, 13.4] });

    const content = draw._hintMarker.getTooltip().getContent();
    expect(content).toMatch(/<strong>Area: <\/strong>/);
    expect(content).toMatch(/<strong>Perimeter: <\/strong>/);
    draw.disable();
  });

  it('does not show measurements when the option is off', () => {
    map.pm.Draw.Line.enable();
    const draw = map.pm.Draw.Line;

    draw._hintMarker.setLatLng([52.5, 13.4]);
    draw._createVertex({ latlng: [52.5, 13.4] });
    draw._syncHintMarker({ latlng: [52.51, 13.4] });

    expect(draw._hintMarker.getTooltip().getContent()).not.toContain(
      'leaflet-geoman-measurements'
    );
    draw.disable();
  });

  it('shows the radius while drawing a circle', () => {
    enableMeasurements();
    map.pm.Draw.Circle.enable();
    const draw = map.pm.Draw.Circle;

    // place the center and drag a radius of ~500m (0.0045 lat)
    draw._hintMarker.setLatLng([52.52, 13.4]);
    map.fire('click', { latlng: L.latLng(52.52, 13.4) });
    draw._layer.setRadius(500);
    draw._fireChange(draw._centerMarker.getLatLng(), 'Draw');

    const content = draw._hintMarker.getTooltip().getContent();
    expect(content).toMatch(/<strong>Radius: <\/strong>500m/);
    draw.disable();
  });

  it('supports the legacy showMeasurements boolean alias', () => {
    map.pm.setGlobalOptions({ showMeasurements: true });
    expect(map.pm.getGlobalOptions().measurements.measurement).toBe(true);
    expect(map.pm.getGlobalOptions().showMeasurements).toBeUndefined();

    map.pm.setGlobalOptions({ showMeasurements: false });
    expect(map.pm.getGlobalOptions().measurements.measurement).toBe(false);
  });
});

describe('editing with measurements', () => {
  it('binds a measurement tooltip to layers and updates after edits', () => {
    enableMeasurements();
    const poly = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    expect(poly.getTooltip()).toBeTruthy();
    expect(poly.getTooltip().getContent()).toContain('<strong>Area: </strong>');

    // shrink the polygon -> tooltip must update
    poly.setLatLngs(square(52.52, 52.51, 13.39, 13.4));
    poly.pm._fireEdit(poly, 'Edit');
    expect(poly.getTooltip().getContent()).not.toBe('');
  });

  it('removes the tooltips when the option is disabled', () => {
    enableMeasurements();
    const poly = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    expect(poly.getTooltip()).toBeTruthy();
    map.pm.setGlobalOptions({
      measurements: { measurement: false },
    });
    expect(poly.getTooltip()).toBeFalsy();
  });

  it('never overwrites or removes a user-bound tooltip', () => {
    const poly = L.polygon(square(52.53, 52.51, 13.39, 13.41)).addTo(map);
    poly.bindTooltip('my tooltip', { permanent: true });

    map.pm.setGlobalOptions({ showMeasurements: true });
    expect(poly.getTooltip().getContent()).toBe('my tooltip');

    map.pm.setGlobalOptions({ showMeasurements: false });
    expect(poly.getTooltip()).toBeTruthy();
    expect(poly.getTooltip().getContent()).toBe('my tooltip');
  });

  it('shows the segment lengths around a dragged vertex', () => {
    enableMeasurements();
    const line = L.polyline([
      [52.5, 13.4],
      [52.51, 13.4],
      [52.51, 13.41],
    ]).addTo(map);
    line.pm.enable();

    const marker = line.pm._markers[0];
    const segments = line.pm._vertexSegmentDistances(marker);
    // the only neighbor is ~1112 m away (open line: first vertex has no
    // segment before it)
    expect(segments.before).toBeUndefined();
    expect(segments.after).toBeGreaterThan(1000);

    line.pm.disable();
  });
});
