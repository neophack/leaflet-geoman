import { describe, expect, it } from 'vitest';
import { douglasPeucker, defaultEpsilon, simplifyRing } from './Simplify';

// minimal L stub for the helper (latLngBounds)
globalThis.L = {
  latLngBounds(latlngs) {
    const lats = latlngs.map((l) => l.lat);
    const lngs = latlngs.map((l) => l.lng);
    return {
      getNorth: () => Math.max(...lats),
      getSouth: () => Math.min(...lats),
      getEast: () => Math.max(...lngs),
      getWest: () => Math.min(...lngs),
    };
  },
};

describe('douglasPeucker', () => {
  it('keeps first and last point', () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 0.5, lng: 0.5 },
      { lat: 1, lng: 1 },
    ];
    const result = douglasPeucker(points, 0.1);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(points[0]);
    expect(result[1]).toEqual(points[2]);
  });

  it('keeps a point that is far away from the line', () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 0.5, lng: 5 },
      { lat: 1, lng: 1 },
    ];
    const result = douglasPeucker(points, 0.1);
    expect(result).toHaveLength(3);
  });

  it('returns the input when it has less than three points', () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
    ];
    expect(douglasPeucker(points, 1)).toEqual(points);
  });
});

describe('simplifyRing', () => {
  it('keeps rings with two or less points untouched', () => {
    const ring = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
    ];
    expect(simplifyRing(ring, 0.1)).toBe(ring);
  });

  it('returns at least three points for closed rings', () => {
    const ring = [];
    for (let i = 0; i < 50; i += 1) {
      ring.push({ lat: Math.sin(i / 10) * 0.00001, lng: i * 0.0001 });
    }
    const result = simplifyRing(ring, 10, { closed: true });
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it('allows collapsing an open line to two points', () => {
    const line = [];
    for (let i = 0; i < 50; i += 1) {
      line.push({ lat: Math.sin(i / 10) * 0.000001, lng: i * 0.0001 });
    }
    const result = simplifyRing(line, 10);
    expect(result.length).toBe(2);
  });
});

describe('defaultEpsilon', () => {
  it('scales with the bounding box diagonal', () => {
    const latlngs = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 3 },
      { lat: 4, lng: 3 },
    ];
    // diagonal = 5
    expect(defaultEpsilon(latlngs, 0.1)).toBeCloseTo(0.5);
  });
});
