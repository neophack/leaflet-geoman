// @vitest-environment jsdom
/**
 * L.PM.Matrix: the 2D affine transform used by scaling/rotating layers
 * (Mixins/Scaling.js, Mixins/Rotating.js). Registered on `L.PM.Matrix` when
 * `L.PM.js` is imported, so the class itself must be exercised through that
 * global rather than importing the module directly.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import L from 'leaflet';

beforeAll(async () => {
  globalThis.L = L;
  await import('../L.PM.js');
});

function identity() {
  return L.PM.Matrix.init();
}

describe('Matrix', () => {
  it('init() returns the identity matrix (transform is a no-op)', () => {
    const p = identity().transform(L.point(3, 4));
    expect(p.x).toBe(3);
    expect(p.y).toBe(4);
  });

  it('translate(point) shifts every transformed point', () => {
    const m = identity().translate(L.point(5, 10));
    const p = m.transform(L.point(0, 0));
    expect(p.x).toBe(5);
    expect(p.y).toBe(10);
  });

  it('translate(number) applies the same offset to x and y', () => {
    const m = identity().translate(7);
    const p = m.transform(L.point(1, 1));
    expect(p.x).toBe(8);
    expect(p.y).toBe(8);
  });

  it('translate() with no argument returns the current translation', () => {
    const m = identity().translate(L.point(2, 3));
    const t = m.translate();
    expect(t.x).toBe(2);
    expect(t.y).toBe(3);
  });

  it('scale(factor) scales around the origin by default', () => {
    const m = identity().scale(2);
    const p = m.transform(L.point(3, 4));
    expect(p.x).toBe(6);
    expect(p.y).toBe(8);
  });

  it('scale(factor, origin) leaves the origin point fixed', () => {
    const origin = L.point(10, 10);
    const m = identity().scale(2, origin);
    const p = m.transform(origin.clone());
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(10);
  });

  it('scale() with no argument returns the current scale', () => {
    const m = identity().scale(L.point(2, 3));
    const s = m.scale();
    expect(s.x).toBe(2);
    expect(s.y).toBe(3);
  });

  it('rotate(angle) rotates around the origin by default', () => {
    const m = identity().rotate(Math.PI / 2);
    const p = m.transform(L.point(1, 0));
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(-1);
  });

  it('rotate(angle, origin) paired with flip() leaves the origin fixed', () => {
    // Rotating.js always chains .rotate(angle, origin).flip() (the flip
    // compensates for Leaflet's y-down pixel space) - that's the pairing
    // that actually rotates a shape in place around `origin`. `rotate()`
    // alone is not origin-preserving, so it's not tested in isolation.
    const origin = L.point(5, 5);
    const m = identity()
      .rotate(Math.PI / 2, origin)
      .flip();
    const p = m.transform(origin.clone());
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(5);

    // a point 1px to the right of the origin ends up 1px below it
    const rotated = m.transform(L.point(origin.x + 1, origin.y));
    expect(rotated.x).toBeCloseTo(5);
    expect(rotated.y).toBeCloseTo(6);
  });

  it('flip() inverts the rotation/skew components in place', () => {
    const m = new L.PM.Matrix(2, 3, 4, 5, 6, 7);
    const returned = m.flip();
    expect(returned).toBe(m); // mutates & returns self
    expect(m._matrix).toEqual([2, -3, -4, 5, 6, 7]);
  });

  it('clone() copies the current values into an independent instance', () => {
    const m = identity().translate(L.point(1, 2));
    const c = m.clone();
    expect(c._matrix).toEqual(m._matrix);

    c.translate(L.point(100, 100));
    expect(m.translate()).toEqual(L.point(1, 2)); // original untouched
  });

  it('untransform() inverts a pure translate', () => {
    const m = identity().translate(L.point(5, 10));
    const p = m.untransform(L.point(15, 20));
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(10);
  });

  it('untransform() inverts a pure scale', () => {
    const m = identity().scale(2);
    const p = m.untransform(L.point(10, 10));
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(5);
  });

  it('untransform() round-trips a composed scale+rotate+translate matrix', () => {
    const m = identity()
      .scale(2)
      .rotate(Math.PI / 3)
      .translate(L.point(10, -4));
    const original = L.point(7, -2);
    const roundTripped = m.untransform(m.transform(original.clone()));
    expect(roundTripped.x).toBeCloseTo(original.x);
    expect(roundTripped.y).toBeCloseTo(original.y);
  });

  it('composes chained scale + rotate + translate calls into one matrix', () => {
    // each call folds into the same underlying matrix rather than being
    // applied as separate sequential steps: a later translate's offset is
    // carried through the linear part already accumulated by scale/rotate,
    // so it does not simply add (10, 0) to the scale+rotate result.
    const m = identity()
      .scale(2)
      .rotate(Math.PI / 2)
      .translate(L.point(10, 0));
    const p = m.transform(L.point(1, 0));
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(18);
  });
});
