// @vitest-environment jsdom
/**
 * handleLayerAdditionInGlobalRotateMode() used to call
 * _isRelevantForRemoval() (copy-pasted from Mode.Removal.js) instead of
 * _isRelevantForRotate(), so any non-Polyline layer (e.g. a Marker) added
 * while global rotate mode was active would have enableRotate() called on
 * it, which throws since Markers have no getLatLngs().
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import L from 'leaflet';

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

function waitForThrottle() {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

describe('global rotate mode: layers added while active', () => {
  it('does not throw when a Marker is added while global rotate mode is active', async () => {
    map.pm.enableGlobalRotateMode();

    expect(() => {
      L.marker([52.52, 13.4]).addTo(map);
    }).not.toThrow();

    await waitForThrottle();

    map.pm.disableGlobalRotateMode();
  });

  it('enables rotate on a relevant Polyline added while global rotate mode is active', async () => {
    map.pm.enableGlobalRotateMode();

    const polyline = L.polyline([
      [52.5, 13.3],
      [52.55, 13.5],
    ]).addTo(map);

    await waitForThrottle();

    expect(polyline.pm.rotateEnabled()).toBe(true);

    map.pm.disableGlobalRotateMode();
  });
});
