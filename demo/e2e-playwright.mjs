// E2E browser test: drives a real browser (headless Chromium) through every
// Geoman UI interaction of demo/index.html (the 19 default toolbar buttons +
// sidebar + keyboard + test cases).
//
// Run: node demo/e2e-playwright.mjs
//  - needs a static server serving the repository root (default
//    http://127.0.0.1:5500, `pnpm dev`); override with DEMO_URL
//  - playwright is resolved from the project dependencies first, otherwise
//    the npx cache is searched (npm exec playwright)
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  // not a project dependency - look through the npx cache
  const require = createRequire(import.meta.url);
  const npxDir = path.join(
    os.homedir(),
    'AppData',
    'Local',
    'npm-cache',
    '_npx'
  );
  let resolved;
  if (existsSync(npxDir)) {
    for (const entry of readdirSync(npxDir)) {
      const candidate = path.join(npxDir, entry, 'node_modules', 'playwright');
      if (existsSync(candidate)) {
        resolved = candidate;
        break;
      }
    }
  }
  if (!resolved) {
    console.error(
      'playwright not found - run: npm exec --package playwright -- playwright install chromium'
    );
    process.exit(1);
  }
  ({ chromium } = require(resolved));
}

const BASE = process.env.DEMO_URL || 'http://127.0.0.1:5500/demo/index.html';
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(
    `${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`
  );
};

async function launchChromium() {
  try {
    return await chromium.launch();
  } catch (e) {
    // the bundled build may be missing - fall back to the installed browsers
    for (const channel of ['chrome', 'msedge']) {
      try {
        return await chromium.launch({ channel });
      } catch {
        /* try the next */
      }
    }
    throw e;
  }
}

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Failed to load resource'))
    errors.push(m.text());
});

await page.goto(BASE);
await page.waitForSelector('.leaflet-pm-toolbar', { timeout: 15000 });
await page.waitForTimeout(2000);

// ---------- Helpers ----------
// Toolbar buttons (excludes the mode-switch icons of the action menus,
// .pm-action-button-mode)
const tool = (name) =>
  page.locator(
    `.leaflet-pm-toolbar .button-container > a .leaflet-pm-icon-${name}`
  );
const enableTool = async (name) => {
  await tool(name).click();
  await page.waitForTimeout(400);
  if (!(await page.evaluate('window.map.pm.globalDrawModeEnabled()'))) {
    await tool(name).click();
    await page.waitForTimeout(500);
  }
};
const mapState = async () =>
  page.evaluate(`(() => {
    const m = window.map;
    return {
      layers: m.pm.getGeomanDrawLayers().length,
      draw: m.pm.globalDrawModeEnabled(),
      activeShape: m.pm.Draw.getActiveShape ? m.pm.Draw.getActiveShape() : null,
      edit: m.pm.globalEditModeEnabled(),
      drag: m.pm.globalDragModeEnabled(),
      removal: m.pm.globalRemovalModeEnabled(),
      cut: m.pm.globalCutModeEnabled(),
      rotate: m.pm.globalRotateModeEnabled(),
      scale: m.pm.globalScaleModeEnabled(),
      union: m.pm.globalUnionModeEnabled(),
      difference: m.pm.globalDifferenceModeEnabled(),
    };
  })()`);
const layerCount = async () => (await mapState()).layers;
const mapBox = async () => {
  const b = await page.locator('#map').boundingBox();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
};
const mapClick = async (x, y) => {
  const b = await mapBox();
  await page.mouse.click(b.x + x, b.y + y);
};
const mapDrag = async (path) => {
  const b = await mapBox();
  await page.mouse.move(b.x + path[0][0], b.y + path[0][1]);
  await page.mouse.down();
  for (let i = 1; i < path.length; i++) {
    await page.mouse.move(b.x + path[i][0], b.y + path[i][1], { steps: 8 });
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
};
const latlngToMapPx = async (lat, lng) => {
  const b = await mapBox();
  const p = await page.evaluate(`(() => {
    const p = window.map.latLngToContainerPoint(L.latLng([${lat}, ${lng}]));
    return [p.x, p.y];
  })()`);
  return [b.x + p[0], b.y + p[1]];
};
const disableAllModes = async () => {
  await page.evaluate(`(() => {
    const pm = window.map.pm;
    const active = pm.Draw.getActiveShape && pm.Draw.getActiveShape();
    if (active && pm.Draw[active]) pm.Draw[active].disable();
    if (pm.globalEditModeEnabled()) pm.disableGlobalEditMode();
    if (pm.globalDragModeEnabled()) pm.disableGlobalDragMode();
    if (pm.globalRemovalModeEnabled()) pm.disableGlobalRemovalMode();
    if (pm.globalCutModeEnabled()) pm.disableGlobalCutMode();
    if (pm.globalRotateModeEnabled()) pm.disableGlobalRotateMode();
    if (pm.globalScaleModeEnabled()) pm.disableGlobalScaleMode();
    if (pm.globalUnionModeEnabled()) pm.disableGlobalUnionMode();
    if (pm.globalDifferenceModeEnabled()) pm.disableGlobalDifferenceMode();
  })()`);
  await page.waitForTimeout(400);
};
const cancelActions = async () => {
  const c = page.getByRole('button', { name: 'Cancel', exact: true });
  if (await c.count()) {
    await c.click().catch(() => {});
    await page.waitForTimeout(300);
  }
};
const loadCase = async (name) => {
  await page.locator(`[data-testcase="${name}"]`).click();
  await page.waitForTimeout(1000);
};
const finishDraw = async () => {
  const fin = page.getByRole('button', { name: 'Finish', exact: true });
  if (await fin.count()) {
    await fin.click({ timeout: 3000 }).catch(() => {});
  } else {
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(600);
};
const activeToolbarTitles = async () =>
  page.evaluate(`Array.from(document.querySelectorAll('.leaflet-pm-toolbar .button-container.active'))
    .map((el) => el.getAttribute('title'))`);

// ---------- Toolbar default state (19 buttons) ----------
{
  const expected = [
    'Draw Marker',
    'Draw Polyline',
    'Draw Rectangle',
    'Draw Polygons',
    'Draw Circle',
    'Draw Circle Marker',
    'Draw Text',
    'Edit Layers',
    'Drag Layers',
    'Cut Layers',
    'Remove Layers',
    'Rotate Layers',
    'Split Layer',
    'Scale Layers',
    'Union layers',
    'Pin shared vertices together',
    'Snap dragged marker to other layers and vertices',
    'Auto trace Line',
    'Show SnapGuides',
  ];
  const titles = await page.evaluate(
    `Array.from(document.querySelectorAll('.leaflet-pm-toolbar .button-container'))
      .map((el) => el.getAttribute('title'))`
  );
  ok(
    'toolbar-default-19-buttons',
    JSON.stringify(titles) === JSON.stringify(expected),
    `${titles.length} buttons`
  );

  for (const t of titles) {
    const hasIcon =
      await page.evaluate(`!!document.querySelector('.leaflet-pm-toolbar .button-container[title="${t}"] .control-icon') &&
      getComputedStyle(document.querySelector('.leaflet-pm-toolbar .button-container[title="${t}"] .control-icon')).backgroundImage !== 'none'`);
    ok(`toolbar-icon:${t}`, hasIcon);
  }

  // snapping is on by default -> its button starts active
  const active = await activeToolbarTitles();
  ok(
    'toolbar-snapping-initially-active',
    active.includes('Snap dragged marker to other layers and vertices'),
    active.join(',')
  );
}

// ---------- Draw modes (with live measurements) ----------
await enableTool('marker');
await mapClick(320, 260);
await page.waitForTimeout(400);
ok('draw-marker', (await layerCount()) === 1, `${await layerCount()} layers`);
await cancelActions();

await enableTool('circle-marker');
await mapClick(360, 260);
await page.waitForTimeout(400);
ok('draw-circlemarker', (await layerCount()) === 2);
await cancelActions();

await enableTool('polyline');
await mapClick(240, 340);
await page.waitForTimeout(250);
// While drawing, the cursor tooltip appends the measurements
// (Length / Segment length / Position Marker)
{
  // the measurement block is driven by cursor movement (_fireChange),
  // so move the mouse once first
  const b = await mapBox();
  await page.mouse.move(b.x + 280, b.y + 355, { steps: 4 });
  await page.waitForTimeout(300);
  const content = await page.evaluate(
    `window.map.pm.Draw.Line._hintMarker.getTooltip().getContent()`
  );
  ok(
    'draw-polyline-live-measurements',
    /leaflet-geoman-measurements/.test(content) &&
      /<strong>Length: <\/strong>/.test(content) &&
      /<strong>Segment length: <\/strong>/.test(content) &&
      /<strong>Position Marker: <\/strong>Lat: /.test(content),
    String(content)
      .replace(/<[^>]+>/g, ' ')
      .slice(0, 60)
  );
}
await mapClick(320, 370);
await page.waitForTimeout(400);
await finishDraw();
await page.waitForTimeout(600);
ok('draw-polyline', (await layerCount()) === 3);
await cancelActions();

await enableTool('rectangle');
await mapClick(380, 200);
await page.waitForTimeout(250);
await mapClick(460, 260);
await page.waitForTimeout(600);
ok('draw-rectangle', (await layerCount()) === 4);
await cancelActions();

await enableTool('polygon');
await mapClick(240, 120);
await page.waitForTimeout(250);
await mapClick(480, 120);
await page.waitForTimeout(250);
await mapClick(480, 330);
await page.waitForTimeout(250);
await mapClick(240, 120);
await page.waitForTimeout(900);
ok('draw-polygon', (await layerCount()) === 5);
await cancelActions();

await enableTool('circle');
await mapClick(500, 330);
await page.waitForTimeout(250);
await mapClick(550, 330);
await page.waitForTimeout(600);
ok('draw-circle', (await layerCount()) === 6);
await cancelActions();

await enableTool('text');
await mapClick(560, 240);
await page.waitForTimeout(500);
await page.keyboard.type('hello geoman');
await page.keyboard.press('Enter');
await page.waitForTimeout(700);
ok('draw-text', (await layerCount()) === 7);
await cancelActions();

// measurement hover tooltip on finished layers (measurements are on by
// default in the demo)
{
  const hasTooltip = await page.evaluate(`(() => {
    const line = window.map.pm
      .getGeomanDrawLayers()
      .find((l) => l instanceof L.Polyline && !(l instanceof L.Polygon));
    return !!line && !!line._measurementsBound && !!line.getTooltip();
  })()`);
  ok('finished-layer-measurement-tooltip', hasTooltip);
}

// ---------- Edit modes ----------
await loadCase('boolean-ops');
ok('case-boolean-ops', (await layerCount()) === 2);

await tool('edit').click();
await page.waitForTimeout(800);
let st = await mapState();
const vMarkers = await page.locator('.leaflet-marker-icon').count();
ok('edit-mode-enable', st.edit && vMarkers > 0, `${vMarkers} markers`);
{
  const [x, y] = await latlngToMapPx(51.505, -0.11);
  const before = await page.evaluate(
    `window.map.pm.getGeomanDrawLayers()[0].getLatLngs()[0][0].lat`
  );
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 30, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await page.evaluate(
    `window.map.pm.getGeomanDrawLayers()[0].getLatLngs()[0][0].lat`
  );
  ok(
    'edit-vertex-drag',
    Math.abs(after - before) > 0.0005,
    `lat ${before.toFixed(5)} -> ${after.toFixed(5)}`
  );
}
await disableAllModes();
ok('edit-mode-disable', !(await mapState()).edit);

await tool('drag').click();
await page.waitForTimeout(600);
st = await mapState();
ok('drag-mode-enable', st.drag);
{
  const [x, y] = await latlngToMapPx(51.5175, -0.085);
  const before = await page.evaluate(
    `JSON.stringify(window.map.pm.getGeomanDrawLayers().map(l => l.getBounds().getWest()))`
  );
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 60, y + 40, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await page.evaluate(
    `JSON.stringify(window.map.pm.getGeomanDrawLayers().map(l => l.getBounds().getWest()))`
  );
  ok('drag-move-layer', before !== after, `wests ${before} -> ${after}`);
}
await disableAllModes();

await loadCase('boolean-ops');
await tool('rotate').click();
await page.waitForTimeout(700);
st = await mapState();
ok('rotate-mode-enable', st.rotate);
{
  const [x, y] = await latlngToMapPx(51.505, -0.11);
  const before = await page.evaluate(
    `JSON.stringify(window.map.pm.getGeomanDrawLayers().map(l => l.getLatLngs()[0].slice(0,2)))`
  );
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 70, y + 50, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await page.evaluate(
    `JSON.stringify(window.map.pm.getGeomanDrawLayers().map(l => l.getLatLngs()[0].slice(0,2)))`
  );
  ok('rotate-layer', before !== after);
}
await disableAllModes();

await tool('scale').click();
await page.waitForTimeout(700);
st = await mapState();
ok('scale-mode-enable', st.scale);
{
  const before = await page.evaluate(
    `JSON.stringify(window.map.pm.getGeomanDrawLayers().map(l => l.getBounds().toBBoxString()))`
  );
  const handle = page.locator('.leaflet-pm-scale-handle').first();
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x - 40, hb.y - 30, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await page.evaluate(
    `JSON.stringify(window.map.pm.getGeomanDrawLayers().map(l => l.getBounds().toBBoxString()))`
  );
  ok('scale-layer', before !== after);
}
await disableAllModes();

await loadCase('boolean-ops');
await tool('cut').click();
await page.waitForTimeout(600);
st = await mapState();
ok('cut-mode-enable', st.cut);
{
  // a cut line crossing polygon 1 fully from south to north
  // (lng~-0.08, avoiding polygon 2)
  const [x1, y1] = await latlngToMapPx(51.498, -0.08);
  const [x2, y2] = await latlngToMapPx(51.515, -0.082);
  const [x3, y3] = await latlngToMapPx(51.535, -0.078);
  await page.mouse.click(x1, y1);
  await page.waitForTimeout(250);
  await page.mouse.click(x2, y2);
  await page.waitForTimeout(250);
  await page.mouse.click(x3, y3);
  await page.waitForTimeout(400);
  await page.mouse.click(x1, y1);
  await page.waitForTimeout(1800);
  const types = await page.evaluate(
    `JSON.stringify(window.map.pm.getGeomanDrawLayers().map(l => l.toGeoJSON().geometry.type))`
  );
  ok(
    'cut-polygon',
    types.includes('MultiPolygon'),
    `${await layerCount()} layers, types=${types}`
  );
}
await disableAllModes();

await loadCase('boolean-ops');
await tool('split').click();
await page.waitForTimeout(600);
{
  const [x1, y1] = await latlngToMapPx(51.515, -0.095);
  const [x2, y2] = await latlngToMapPx(51.52, -0.075);
  const [x3, y3] = await latlngToMapPx(51.525, -0.06);
  await page.mouse.click(x1, y1);
  await page.waitForTimeout(250);
  await page.mouse.click(x2, y2);
  await page.waitForTimeout(250);
  await page.mouse.click(x3, y3);
  await page.waitForTimeout(400);
  await page.mouse.click(x1, y1);
  await page.waitForTimeout(1800);
  ok(
    'split-polygon',
    (await layerCount()) >= 3,
    `${await layerCount()} layers`
  );
}
await disableAllModes();

// Union: select two polygons (no highlight on the selected one, the others
// dim to 40%), the union action merges them
await loadCase('boolean-ops');
await tool('union').click();
await page.waitForTimeout(600);
{
  const [x1, y1] = await latlngToMapPx(51.508, -0.098);
  const [x2, y2] = await latlngToMapPx(51.533, -0.055);
  await page.mouse.click(x1, y1);
  await page.waitForTimeout(400);

  // selection indicator: no extra highlight layer; the unselected polygon
  // is dimmed to 40% opacity
  const dim = await page.evaluate(`(() => {
    const layers = window.map.pm.getGeomanDrawLayers();
    let polygonLayers = 0;
    window.map.eachLayer((l) => { if (l instanceof L.Polygon && !l._pmTempLayer) polygonLayers += 1; });
    const base = layers.find((l) => l._pmSelectionBaseStyle === undefined && l instanceof L.Polygon);
    const other = layers.find((l) => l._pmSelectionBaseStyle !== undefined);
    return { polygonLayers, baseOpacity: base && base.options.opacity, otherOpacity: other && other.options.opacity };
  })()`);
  ok(
    'union-selection-dims-others',
    dim.polygonLayers === 2 &&
      dim.otherOpacity !== undefined &&
      Math.abs(dim.otherOpacity - 0.4) < 0.01 &&
      (dim.baseOpacity === undefined || dim.baseOpacity >= 0.99),
    JSON.stringify(dim)
  );

  await page.mouse.click(x2, y2);
  await page.waitForTimeout(400);
  // the union executes automatically once exactly two layers are selected
  // (no extra Union action click needed)
  const sel = await page.evaluate(`window.map.pm._unionSelection.length`);
  ok('union-selection', sel === 0, `selection=${sel} (auto-executed)`);
  await page.waitForTimeout(1000);
  ok('union-merge', (await layerCount()) === 1, `${await layerCount()} layers`);
  // after the merge the mode stays enabled and opacities are restored
  st = await mapState();
  const restored = await page.evaluate(
    `window.map.pm.getGeomanDrawLayers().every((l) => l._pmSelectionBaseStyle === undefined)`
  );
  ok('union-dimming-restored', restored);
  ok('union-mode-stays-enabled', st.union);
}
await disableAllModes();

// Subtract switch action of the Union button -> Difference mode
await loadCase('boolean-ops');
await tool('union').click();
await page.waitForTimeout(600);
{
  const switchAction = page.locator('a.action-differenceMode');
  ok('union-has-subtract-action', (await switchAction.count()) === 1);
  await switchAction.click({ force: true });
  await page.waitForTimeout(600);
  st = await mapState();
  ok(
    'subtract-action-switches-mode',
    st.difference && !st.union,
    JSON.stringify({ union: st.union, difference: st.difference })
  );

  const geoBefore = await page.evaluate(
    `JSON.stringify(window.map.pm.getGeomanDrawLayers().map(l => JSON.stringify(l.getLatLngs())))`
  );
  const [x1, y1] = await latlngToMapPx(51.508, -0.098);
  const [x2, y2] = await latlngToMapPx(51.533, -0.055);
  await page.mouse.click(x1, y1);
  await page.waitForTimeout(400);

  // once the base layer is selected: the other layers are dimmed (no highlight)
  const dim = await page.evaluate(`(() => {
    let polygonLayers = 0;
    window.map.eachLayer((l) => { if (l instanceof L.Polygon && !l._pmTempLayer) polygonLayers += 1; });
    const other = window.map.pm.getGeomanDrawLayers().find((l) => l._pmSelectionBaseStyle !== undefined);
    return { polygonLayers, otherOpacity: other && other.options.opacity };
  })()`);
  ok(
    'difference-selection-dims-others',
    dim.polygonLayers === 2 && Math.abs(dim.otherOpacity - 0.4) < 0.01,
    JSON.stringify(dim)
  );

  await page.mouse.click(x2, y2);
  await page.waitForTimeout(1000);
  const geoAfter = await page.evaluate(
    `JSON.stringify(window.map.pm.getGeomanDrawLayers().map(l => JSON.stringify(l.getLatLngs())))`
  );
  ok('difference-subtract', geoBefore !== geoAfter);
}
await disableAllModes();

await loadCase('boolean-ops');
await tool('delete').click();
await page.waitForTimeout(600);
{
  const [x, y] = await latlngToMapPx(51.508, -0.098);
  await page.mouse.click(x, y);
  await page.waitForTimeout(700);
  ok(
    'removal-mode',
    (await layerCount()) === 1,
    `${await layerCount()} layers`
  );
}
await disableAllModes();

// ---------- Pinning (toolbar button + edit mode + shared-vertex drag) ----------
{
  await loadCase('pinning');
  await tool('pin').click();
  await page.waitForTimeout(400);
  const pinningOn = await page.evaluate(
    `window.map.pm.getGlobalOptions().pinning`
  );
  ok('toolbar-pinning-toggle', pinningOn === true, `pinning=${pinningOn}`);

  await tool('edit').click();
  await page.waitForTimeout(800);
  // the two squares share the corner [51.53, -0.06]; dragging it must move
  // that vertex of both layers
  const [x, y] = await latlngToMapPx(51.53, -0.06);
  const before = await page.evaluate(
    `JSON.stringify(window.map.pm.getGeomanDrawLayers().map(l => JSON.stringify(l.getLatLngs())))`
  );
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 30, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await page.evaluate(
    `JSON.stringify(window.map.pm.getGeomanDrawLayers().map(l => JSON.stringify(l.getLatLngs())))`
  );
  ok('pinning-shared-vertex-follows', before !== after, 'geometry changed');

  // dragging a shared vertex must not produce a zero-length edge
  // (regression: shared-vertex pinning bug)
  const minEdge = await page.evaluate(`(() => {
    let min = Infinity;
    window.map.pm.getGeomanDrawLayers().forEach((l) => {
      if (!(l instanceof L.Polygon)) return;
      const ring = l.getLatLngs()[0];
      for (let i = 0; i < ring.length; i++) {
        const d = window.map.distance(ring[i], ring[(i + 1) % ring.length]);
        if (d < min) min = d;
      }
    });
    return min;
  })()`);
  ok(
    'pinning-no-zero-length-edge',
    minEdge > 1,
    `minEdge=${minEdge.toFixed(1)}m`
  );

  await disableAllModes();
  await tool('pin')
    .click()
    .catch(() => {});
  await page.waitForTimeout(300);
  await page.evaluate(`window.map.pm.setGlobalOptions({ pinning: false })`);
}

// ---------- Option buttons (snapping / snap guides / auto trace / measurements) ----------
{
  // snapping is active by default; the first click turns it off
  await tool('snapping').click();
  await page.waitForTimeout(400);
  const off = await page.evaluate(`window.map.pm.getGlobalOptions().snappable`);
  const activeAfterOff = (await activeToolbarTitles()).includes(
    'Snap dragged marker to other layers and vertices'
  );
  await tool('snapping').click();
  await page.waitForTimeout(300);
  const on = await page.evaluate(`window.map.pm.getGlobalOptions().snappable`);
  ok(
    'toolbar-snapping-toggle',
    off === false && on === true && !activeAfterOff,
    `snappable ${on}<-${off}`
  );

  await tool('snapguides').click();
  await page.waitForTimeout(400);
  const sg = await page.evaluate(
    `window.map.pm.getGlobalOptions().showSnapGuides`
  );
  await tool('snapguides').click();
  await page.waitForTimeout(300);
  ok('toolbar-snapguides-toggle', sg === true, `showSnapGuides=${sg}`);

  await tool('autotrace').click();
  await page.waitForTimeout(400);
  const at = await page.evaluate(`window.map.pm.getGlobalOptions().autoTrace`);
  await tool('autotrace').click();
  await page.waitForTimeout(300);
  ok('toolbar-autotrace-toggle', at === true, `autoTrace=${at}`);

  // measurements is a default global option of the demo; also verify that
  // there is no measurement button besides the union button
  const measOpt = await page.evaluate(
    `window.map.pm.getGlobalOptions().measurements`
  );
  ok(
    'measurements-global-option',
    !!measOpt &&
      measOpt.measurement === true &&
      measOpt.displayFormat === 'metric',
    JSON.stringify(
      measOpt && {
        measurement: measOpt.measurement,
        displayFormat: measOpt.displayFormat,
      }
    )
  );
  const measBtn = await page.evaluate(
    `!!document.querySelector('.leaflet-pm-icon-measurement')`
  );
  ok('measurement-button-not-in-default-toolbar', measBtn === false);
}

// ---------- Keyboard shortcuts (sidebar toggles keyboardShortcuts /
// exitModeOnEscape / finishOnEnter) ----------
{
  await page.locator('label.toggle:has(#opt-keyboardShortcuts)').click();
  await page.waitForTimeout(400);
  // click the map background first to move focus away from form controls
  await mapClick(600, 200);
  await page.waitForTimeout(300);
  await page.keyboard.press('m');
  await page.waitForTimeout(500);
  st = await mapState();
  ok(
    'keyboard-m-starts-marker-draw',
    st.draw && st.activeShape === 'Marker',
    JSON.stringify({ draw: st.draw, shape: st.activeShape })
  );
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(
    `window.map.pm.Draw.Marker && window.map.pm.Draw.Marker.disable()`
  );
  await page.locator('label.toggle:has(#opt-keyboardShortcuts)').click();
  await page.waitForTimeout(300);

  await page.locator('label.toggle:has(#opt-exitModeOnEscape)').click();
  await page.waitForTimeout(300);
  await page.evaluate(`window.map.pm.Draw.Line.enable()`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  ok('keyboard-esc-exits-draw', !(await mapState()).draw);
  await page.locator('label.toggle:has(#opt-exitModeOnEscape)').click();
  await page.waitForTimeout(300);
}

// ---------- Sidebar toggles ----------
{
  await page.locator('label.toggle:has(#opt-snapGuides)').click();
  await page.waitForTimeout(400);
  const sg = await page.evaluate(
    `window.map.pm.getGlobalOptions().showSnapGuides`
  );
  await page.locator('label.toggle:has(#opt-snapGuides)').click();
  await page.waitForTimeout(300);
  ok('sidebar-snapguides', sg === true, `showSnapGuides=${sg}`);

  await page.locator('label.toggle:has(#opt-autoTrace)').click();
  await page.waitForTimeout(400);
  const at = await page.evaluate(`window.map.pm.getGlobalOptions().autoTrace`);
  await page.locator('label.toggle:has(#opt-autoTrace)').click();
  await page.waitForTimeout(300);
  ok('sidebar-autotrace', at === true, `autoTrace=${at}`);

  await page.locator('label.toggle:has(#opt-pinning)').click();
  await page.waitForTimeout(400);
  const pin = await page.evaluate(`window.map.pm.getGlobalOptions().pinning`);
  await page.locator('label.toggle:has(#opt-pinning)').click();
  await page.waitForTimeout(300);
  ok('sidebar-pinning', pin === true, `pinning=${pin}`);

  await page.locator('.sidebar #opt-snapDistance').fill('25');
  await page.locator('.sidebar #opt-snapDistance').dispatchEvent('change');
  const sd = await page.evaluate(
    `window.map.pm.getGlobalOptions().snapDistance`
  );
  ok('sidebar-snapdistance', sd === 25, `snapDistance=${sd}`);

  await page.locator('label.toggle:has(#opt-snapTo90)').click();
  await page.waitForTimeout(300);
  const s90 = await page.evaluate(`window.map.pm.getGlobalOptions().snapTo90`);
  await page.locator('label.toggle:has(#opt-snapTo90)').click();
  ok('sidebar-snapto90', s90 === true, `snapTo90=${s90}`);

  // measurement toggle (legacy showMeasurements alias ->
  // measurements.measurement)
  await page.locator('label.toggle:has(#opt-showMeasurements)').click();
  await page.waitForTimeout(300);
  const measOff = await page.evaluate(
    `window.map.pm.getGlobalOptions().measurements.measurement`
  );
  await page.locator('label.toggle:has(#opt-showMeasurements)').click();
  await page.waitForTimeout(300);
  const measOn = await page.evaluate(
    `window.map.pm.getGlobalOptions().measurements.measurement`
  );
  ok(
    'sidebar-measurements',
    measOff === false && measOn === true,
    `${measOff} -> ${measOn}`
  );
}

// ---------- Undo / Redo ----------
{
  await loadCase('empty');
  await enableTool('marker');
  await mapClick(320, 260);
  await page.waitForTimeout(600);
  await cancelActions();
  const afterDraw = await layerCount();
  await page.locator('#btn-undo').click();
  await page.waitForTimeout(600);
  const undone = await layerCount();
  await page.locator('#btn-redo').click();
  await page.waitForTimeout(600);
  const redone = await layerCount();
  ok(
    'undo-redo',
    afterDraw === 1 && redone === afterDraw && undone !== afterDraw,
    `${afterDraw} -> ${undone} -> ${redone}`
  );
}

// ---------- Remaining tools (not default buttons, enabled via API) ----------
{
  await page.evaluate(`window.map.pm.addControls({
    drawPoint: true, drawFreehand: true, lassoMode: true, copyLayerMode: true,
    lineSimplificationMode: true, bringToFrontMode: true, sendToBackMode: true
  })`);
  await page.waitForTimeout(800);
  await loadCase('basic-shapes');
  const before = await layerCount();

  // Point
  await enableTool('point');
  await mapClick(320, 260);
  await page.waitForTimeout(400);
  ok(
    'draw-point',
    (await layerCount()) === before + 1,
    `${await layerCount()} layers`
  );
  await cancelActions();

  // Freehand
  await enableTool('freehand');
  await mapDrag([
    [240, 430],
    [280, 460],
    [330, 440],
    [380, 470],
    [430, 450],
  ]);
  await page.waitForTimeout(900);
  ok(
    'draw-freehand',
    (await layerCount()) === before + 2,
    `${await layerCount()} layers`
  );
  await cancelActions();

  // lasso / copy / simplify / front / back: toggleable without errors
  for (const t of ['lasso', 'copy', 'simplify', 'front', 'back']) {
    await tool(t).click();
    await page.waitForTimeout(500);
    const errBefore = errors.length;
    await page.mouse.click(500, 300);
    await page.waitForTimeout(300);
    ok(`toolbar-${t}-usable`, errors.length === errBefore, 'no errors');
    await tool(t)
      .click()
      .catch(() => {});
    await page.waitForTimeout(200);
  }
}

// ---------- Test case buttons ----------
for (const c of [
  'empty',
  'basic-shapes',
  'complex-polygon',
  'layer-groups',
  'circles',
  'self-intersecting',
  'categories',
  'pinning',
  'boolean-ops',
]) {
  await loadCase(c);
  const n = await layerCount();
  const expected = {
    empty: 0,
    'basic-shapes': 5,
    'complex-polygon': 2,
    'layer-groups': 5,
    circles: 8,
    'self-intersecting': 2,
    categories: 3,
    pinning: 2,
    'boolean-ops': 2,
  }[c];
  ok(`testcase-${c}`, n === expected, `${n}/${expected} layers`);
}

// ---------- Page errors ----------
ok(
  'no-page-errors',
  errors.length === 0,
  errors.slice(0, 3).join(' | ').slice(0, 200)
);

// ---------- Summary ----------
const passed = results.filter((r) => r.pass).length;
console.log(`\n===== ${passed}/${results.length} PASS =====`);
await page.screenshot({ path: 'demo/.e2e-final.png', fullPage: false });
await browser.close();
process.exit(passed === results.length ? 0 : 1);
