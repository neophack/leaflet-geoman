// @vitest-environment jsdom
/**
 * ModeHelper: latlng <-> pixel-point conversion used by Scaling/Rotating to
 * apply a Matrix transform to a layer's coordinates.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import L from 'leaflet';
import {
  _toPoint,
  _toLatLng,
  _convertLatLng,
  _convertLatLngs,
} from '../helpers/ModeHelper';

let map;

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
});

describe('_toPoint / _toLatLng', () => {
  it('round-trips a latlng through pixel space', () => {
    const latlng = L.latLng(52.5, 13.4);
    const point = _toPoint(map, latlng);
    const back = _toLatLng(map, point);
    expect(back.lat).toBeCloseTo(latlng.lat, 6);
    expect(back.lng).toBeCloseTo(latlng.lng, 6);
  });

  it('accepts a layer and uses its getLatLng()', () => {
    const marker = L.marker([52.51, 13.41]);
    const fromLayer = _toPoint(map, marker);
    const fromLatLng = _toPoint(map, marker.getLatLng());
    expect(fromLayer.x).toBeCloseTo(fromLatLng.x);
    expect(fromLayer.y).toBeCloseTo(fromLatLng.y);
  });

  it('projects at the max zoom when the map has one', () => {
    map.setMaxZoom(18);
    const latlng = L.latLng(52.5, 13.4);
    const point = _toPoint(map, latlng);
    expect(point).toEqual(map.project(latlng, 18));
  });

  it('falls back to the current zoom when there is no max zoom', () => {
    // fresh map with no maxZoom option -> getMaxZoom() is Infinity
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
    const freeMap = L.map(container, { center: [52.52, 13.4], zoom: 10 });

    const latlng = L.latLng(52.5, 13.4);
    const point = _toPoint(freeMap, latlng);
    expect(point).toEqual(freeMap.project(latlng, 10));
    freeMap.remove();
  });
});

describe('_convertLatLng / _convertLatLngs', () => {
  it('an identity matrix leaves a latlng unchanged', () => {
    const matrix = L.PM.Matrix.init();
    const latlng = L.latLng(52.5, 13.4);
    const result = _convertLatLng(latlng, matrix, map);
    expect(result.lat).toBeCloseTo(latlng.lat, 6);
    expect(result.lng).toBeCloseTo(latlng.lng, 6);
  });

  it('a translating matrix shifts the latlng', () => {
    const matrix = L.PM.Matrix.init().translate(L.point(50, 0));
    const latlng = L.latLng(52.5, 13.4);
    const result = _convertLatLng(latlng, matrix, map);
    // shifting east in pixel-x space increases longitude
    expect(result.lng).toBeGreaterThan(latlng.lng);
    expect(result.lat).toBeCloseTo(latlng.lat, 3);
  });

  it('recurses through nested arrays (rings of a polygon) preserving shape', () => {
    const matrix = L.PM.Matrix.init();
    const ring = [
      [L.latLng(52.5, 13.38), L.latLng(52.5, 13.42)],
      [L.latLng(52.52, 13.42), L.latLng(52.52, 13.38)],
    ];
    const result = _convertLatLngs(ring, matrix, map);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(2);
    expect(result[0][0].lat).toBeCloseTo(ring[0][0].lat, 6);
    expect(result[0][0].lng).toBeCloseTo(ring[0][0].lng, 6);
  });

  it('returns null for a value that is neither an array nor a LatLng', () => {
    const matrix = L.PM.Matrix.init();
    expect(_convertLatLngs(undefined, matrix, map)).toBeNull();
  });
});
