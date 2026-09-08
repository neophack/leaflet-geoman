// @vitest-environment jsdom
/**
 * Edit.ImageOverlay#disable() had an inverted condition guarding
 * pm:disable/pm:update: it fired those events only when the layer was
 * NOT enabled (and skipped them when it genuinely was enabled).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
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

describe('Edit.ImageOverlay disable() events', () => {
  it('fires pm:disable when a genuinely enabled layer is disabled', () => {
    const layer = L.imageOverlay('https://example.com/image.png', [
      [52.5, 13.3],
      [52.55, 13.5],
    ]).addTo(map);

    const disabled = vi.fn();
    layer.on('pm:disable', disabled);

    layer.pm.enable();
    expect(layer.pm.enabled()).toBe(true);

    layer.pm.disable();

    expect(disabled).toHaveBeenCalledTimes(1);
  });

  it('does not fire pm:disable when disabling a layer that was never enabled', () => {
    const layer = L.imageOverlay('https://example.com/image.png', [
      [52.5, 13.3],
      [52.55, 13.5],
    ]).addTo(map);

    const disabled = vi.fn();
    layer.on('pm:disable', disabled);

    layer.pm.disable();

    expect(disabled).not.toHaveBeenCalled();
  });
});
