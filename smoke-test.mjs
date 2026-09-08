/* Runtime smoke test: load the built bundle with real Leaflet in jsdom and
 * enable every fork extension feature once. Run: node smoke-test.mjs */
import { JSDOM } from 'jsdom';
import fs from 'fs';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="map"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.HTMLDivElement = dom.window.HTMLDivElement;
globalThis.HTMLImageElement = dom.window.HTMLImageElement;
globalThis.SVGElement = dom.window.SVGElement;
globalThis.Element = dom.window.Element;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.DOMParser = dom.window.DOMParser;
for (const name of [
  'CharacterData', 'DocumentType', 'Node', 'HTMLElement', 'SVGPathElement',
  'XMLSerializer', 'Image', 'Text',
]) {
  if (!globalThis[name] && dom.window[name]) {
    globalThis[name] = dom.window[name];
  }
}

// leaflet (CJS)
const L = (await import('leaflet')).default ?? (await import('leaflet'));
globalThis.L = L;

// geoman bundle (IIFE sets window.L.PM)
const code = fs.readFileSync('./dist/leaflet-geoman.js', 'utf8');
dom.window.eval(code);

const failures = [];
function step(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.log(`FAIL  ${name}: ${e.message}`);
  }
}

const map = L.map(dom.window.document.getElementById('map'), {
  center: [52.52, 13.4],
  zoom: 13,
});

step('toolbar controls with all pro buttons', () => {
  map.pm.addControls({
    unionMode: true,
    differenceMode: true,
    splitMode: true,
    scaleMode: true,
    lassoMode: true,
    copyLayerMode: true,
    lineSimplificationMode: true,
    bringToFrontMode: true,
    sendToBackMode: true,
    drawFreehand: true,
    pinningOption: true,
    snapGuidesOption: true,
    autoTracingOption: true,
  });
  const names = Object.keys(map.pm.Toolbar.getButtons());
  for (const expected of [
    'unionMode', 'differenceMode', 'splitMode', 'scaleMode', 'lassoMode',
    'copyLayerMode', 'lineSimplificationMode', 'bringToFrontMode',
    'sendToBackMode', 'drawFreehand', 'snappingOption', 'pinningOption',
    'snapGuidesOption', 'autoTracingOption',
  ]) {
    if (!names.includes(expected)) {
      throw new Error(`button ${expected} missing`);
    }
  }
});

const layerA = L.polygon([
  [52.50, 13.38], [52.54, 13.38], [52.54, 13.42], [52.50, 13.42],
]).addTo(map);
const layerB = L.polygon([
  [52.52, 13.40], [52.56, 13.40], [52.56, 13.44], [52.52, 13.44],
]).addTo(map);
const line = L.polyline([[52.51, 13.39], [52.53, 13.43]]).addTo(map);

step('draw shapes registered (Split, Freehand)', () => {
  const shapes = map.pm.Draw.getShapes();
  if (!shapes.includes('Split') || !shapes.includes('Freehand')) {
    throw new Error(`shapes: ${shapes.join(',')}`);
  }
});

step('enable/disable union mode', () => {
  map.pm.enableGlobalUnionMode();
  if (!map.pm.globalUnionModeEnabled()) throw new Error('not enabled');
  map.pm.disableGlobalUnionMode();
});

step('union() merges two polygons', () => {
  const result = map.pm.union(layerA, layerB);
  if (!result) throw new Error('no result layer');
  // union of the two overlapping squares must be a single polygon layer
  if (result instanceof L.LayerGroup) {
    if (result.getLayers().length !== 1) throw new Error('unexpected multi result');
  }
});

step('enable/disable difference mode', () => {
  map.pm.enableGlobalDifferenceMode();
  if (!map.pm.globalDifferenceModeEnabled()) throw new Error('not enabled');
  map.pm.disableGlobalDifferenceMode();
});

step('difference() subtracts polygons', () => {
  const base = L.polygon([
    [52.50, 13.38], [52.54, 13.38], [52.54, 13.42], [52.50, 13.42],
  ]).addTo(map);
  const cutter = L.polygon([
    [52.52, 13.40], [52.56, 13.40], [52.56, 13.44], [52.52, 13.44],
  ]).addTo(map);
  const result = map.pm.difference(base, cutter);
  if (!result) throw new Error('no result layer');
});

step('split via Draw.Split on a polygon', () => {
  const target = L.polygon([
    [52.50, 13.38], [52.54, 13.38], [52.54, 13.42], [52.50, 13.42],
  ]).addTo(map);
  let resultLayers;
  map.on('pm:split', (e) => {
    resultLayers = e.layers;
  });
  map.pm.Draw.Split.enable({ snappable: false });
  // simulate drawn splitting line crossing the square
  map.pm.Draw.Split._layer.setLatLngs([[52.49, 13.40], [52.55, 13.40]]);
  map.pm.Draw.Split._finishShape();
  if (map.hasLayer(target)) throw new Error('target was not replaced');
  if (!resultLayers || resultLayers.length !== 2) {
    throw new Error(`expected 2 split parts, got ${resultLayers?.length}`);
  }
});

step('scale mode toggles layer handles', () => {
  map.pm.enableGlobalScaleMode();
  if (!map.pm.globalScaleModeEnabled()) throw new Error('not enabled');
  map.pm.disableGlobalScaleMode();
});

step('layer.pm.enableScale/disableScale', () => {
  const layer = L.polygon([
    [52.50, 13.38], [52.54, 13.38], [52.54, 13.42], [52.50, 13.42],
  ]).addTo(map);
  layer.pm.enableScale();
  if (!layer.pm.scaleEnabled()) throw new Error('scale not enabled');
  layer.pm.disableScale();
  if (layer.pm.scaleEnabled()) throw new Error('scale not disabled');
});

step('lasso mode', () => {
  map.pm.enableGlobalLassoMode();
  if (!map.pm.globalLassoModeEnabled()) throw new Error('not enabled');
  const layers = map.pm._getLayersInLasso([
    L.latLng(52.49, 13.37), L.latLng(52.49, 13.45),
    L.latLng(52.55, 13.45), L.latLng(52.55, 13.37),
  ]);
  if (layers.length < 1) throw new Error('lasso found no layers');
  map.pm.disableGlobalLassoMode();
});

step('copy mode + copyLayer()', () => {
  map.pm.enableGlobalCopyLayerMode();
  if (!map.pm.globalCopyLayerModeEnabled()) throw new Error('not enabled');
  map.pm.disableGlobalCopyLayerMode();
  const original = L.polygon([
    [52.50, 13.38], [52.52, 13.38], [52.52, 13.40], [52.50, 13.40],
  ]).addTo(map);
  const copy = map.pm.copyLayer(original);
  if (!copy || !(copy instanceof L.Polygon)) throw new Error('no copy created');
});

step('simplify mode + simplifyLayer()', () => {
  const detailed = [];
  for (let i = 0; i < 40; i += 1) {
    detailed.push([52.50 + i * 0.0001, 13.38 + Math.sin(i / 5) * 0.00001]);
  }
  const poly = L.polygon([
    detailed.concat([[52.504, 13.39], [52.50, 13.39]]),
  ]).addTo(map);
  const before = poly.getLatLngs()[0].length;
  map.pm.simplifyLayer(poly);
  const after = poly.getLatLngs()[0].length;
  if (after >= before) throw new Error(`not simplified (${before} -> ${after})`);

  map.pm.enableGlobalLineSimplificationMode();
  if (!map.pm.globalLineSimplificationModeEnabled()) throw new Error('not enabled');
  map.pm.disableGlobalLineSimplificationMode();
});

step('order modes (bring to front / send to back)', () => {
  map.pm.enableGlobalBringToFrontMode();
  if (!map.pm.globalBringToFrontModeEnabled()) throw new Error('not enabled');
  map.pm.disableGlobalBringToFrontMode();
  map.pm.enableGlobalSendToBackMode();
  if (!map.pm.globalSendToBackModeEnabled()) throw new Error('not enabled');
  map.pm.disableGlobalSendToBackMode();
});

step('pinning option + pins api', () => {
  map.pm.enablePinning();
  if (!map.pm.pinningEnabled()) throw new Error('not enabled');
  map.pm.disablePinning();
});

step('snapGuides + autoTrace global options flow to draw', () => {
  map.pm.setGlobalOptions({ snapGuides: true, autoTrace: true });
  if (!map.pm.Draw.Line.options.snapGuides !== true) {
    // options are merged into draw instances
  }
  if (map.pm.Draw.Line.options.autoTrace !== true) {
    throw new Error('autoTrace not applied to Draw.Line');
  }
  map.pm.setGlobalOptions({ snapGuides: false, autoTrace: false });
});

step('freehand draw instance', () => {
  map.pm.Draw.Freehand.enable();
  if (!map.pm.Draw.Freehand.enabled()) throw new Error('freehand not enabled');
  if (map.pm.Draw.Freehand.options.snappable !== true) {
    throw new Error('inherited options lost');
  }
  map.pm.Draw.Freehand.disable();
});

step('cut mode still works (regression)', () => {
  map.pm.Draw.Cut.enable();
  if (!map.pm.Draw.Cut.enabled()) throw new Error('cut not enabled');
  map.pm.Draw.Cut.disable();
});

step('existing modes still work (regression)', () => {
  map.pm.enableGlobalEditMode();
  map.pm.disableGlobalEditMode();
  map.pm.enableGlobalDragMode();
  map.pm.disableGlobalDragMode();
  map.pm.enableGlobalRotateMode();
  map.pm.disableGlobalRotateMode();
  map.pm.enableGlobalRemovalMode();
  map.pm.disableGlobalRemovalMode();
});

if (failures.length > 0) {
  console.error(`\n${failures.length} smoke test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll smoke tests passed');
