// Feature demo: opens a (visible) browser and walks through every
// Leaflet-Geoman feature one by one. Each feature gets an on-page banner
// explaining it, and assertions run alongside the demo.
//
// Usage:
//   node demo/feature-demo.mjs            # single run (visible browser)
//   node demo/feature-demo.mjs --headless # single run (headless, for verification)
//   node demo/feature-demo.mjs loop       # loop until a feature fails
//   demo-feature.bat [loop]               # one-click run on Windows (auto-starts the dev server)
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
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
      'playwright not available - run first: npm exec --package playwright -- playwright install chromium'
    );
    process.exit(1);
  }
  ({ chromium } = require(resolved));
}

const BASE = process.env.DEMO_URL || 'http://127.0.0.1:5500/demo/index.html';
const args = process.argv.slice(2);
const LOOP = args.some((a) => a === 'loop' || a === '--loop' || a === '-l');
const HEADED = !args.includes('--headless');

const results = [];
let failed = false;
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(
    `  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` (${detail})` : ''}`
  );
  if (!pass) {
    failed = true;
  }
};

async function launchChromium() {
  const opts = { headless: !HEADED };
  if (HEADED) {
    opts.slowMo = 40; // demo pacing: slow every step down
  }
  try {
    return await chromium.launch(opts);
  } catch (e) {
    for (const channel of ['chrome', 'msedge']) {
      try {
        return await chromium.launch({ ...opts, channel });
      } catch {
        /* try the next */
      }
    }
    throw e;
  }
}

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1360, height: 820 } });
const pageErrors = [];
page.on('pageerror', (e) =>
  pageErrors.push(String(e.stack || e).slice(0, 220))
);

// ---------- Generic helpers ----------
const $ = (sel) => page.locator(sel).first();
const tool = (name) =>
  page.locator(`.leaflet-pm-toolbar .button-container[title="${name}"] > a`);
let mapBox;
const refreshBox = async () => {
  mapBox = await page.locator('.leaflet-container').first().boundingBox();
};
const cx = () => mapBox.x + mapBox.width / 2;
const cy = () => mapBox.y + mapBox.height / 2;
const at = (dx, dy) => [cx() + dx, cy() + dy];
const clickAt = async (dx, dy, wait = HEADED ? 700 : 350) => {
  const [x, y] = at(dx, dy);
  await page.mouse.click(x, y);
  await page.waitForTimeout(wait);
};
const moveAt = async (dx, dy) => {
  const [x, y] = at(dx, dy);
  await page.mouse.move(x, y, { steps: 10 });
  await page.waitForTimeout(HEADED ? 500 : 300);
};
const dragAt = async (dx1, dy1, dx2, dy2) => {
  const [x1, y1] = at(dx1, dy1);
  const [x2, y2] = at(dx2, dy2);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(HEADED ? 900 : 500);
};
// Lasso gesture: drag once around the four sides of the rectangle to form a
// closed lasso polygon (dragging corner to corner only draws a thin line)
const lassoDrag = async (dx1, dy1, dx2, dy2) => {
  await page.mouse.move(...at(dx1, dy1));
  await page.mouse.down();
  for (const [px, py] of [
    [dx2, dy1],
    [dx2, dy2],
    [dx1, dy2],
    [dx1, dy1],
  ]) {
    await page.mouse.move(...at(px, py), { steps: 8 });
    await page.waitForTimeout(HEADED ? 60 : 30);
  }
  await page.mouse.up();
  await page.waitForTimeout(HEADED ? 900 : 500);
};
const clickBtn = async (title) => {
  await tool(title).click();
  await page.waitForTimeout(HEADED ? 700 : 400);
};
const latlngOffsets = async (lat, lng) => {
  const p = await page.evaluate(
    `(() => { const p = window.map.latLngToContainerPoint(L.latLng([${lat}, ${lng}])); const size = window.map.getSize(); return [p.x - size.x / 2, p.y - size.y / 2]; })()`
  );
  return p;
};
const layers = () =>
  page.evaluate(`(() => {
    const ls = window.map.pm.getGeomanDrawLayers();
    return {
      count: ls.length,
      types: ls.map((l) => l.toGeoJSON().geometry.type),
      vertices: ls.map((l) => (l.getLatLngs ? l.getLatLngs().flat().length : 1)),
    };
  })()`);
const option = (name) =>
  page.evaluate(`window.map.pm.getGlobalOptions().${name}`);
const showBanner = async (title, desc) => {
  console.log(`\n■ ${title}${desc ? ` — ${desc}` : ''}`);
  await page
    .evaluate(
      ({ t, d }) => {
        let b = document.getElementById('__demo_banner');
        if (!b) {
          b = document.createElement('div');
          b.id = '__demo_banner';
          b.style.cssText =
            'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:99999;background:rgba(15,20,40,.93);color:#fff;padding:10px 24px;border-radius:10px;font:600 15px/1.45 system-ui;box-shadow:0 6px 22px rgba(0,0,0,.4);pointer-events:none;text-align:center;max-width:82%';
          document.body.appendChild(b);
        }
        b.innerHTML =
          `<div style="color:#7ec8ff">▶ ${t}</div>` +
          (d
            ? `<div style="font-weight:400;font-size:12.5px;color:#c9d4ee;margin-top:2px">${d}</div>`
            : '');
      },
      { t: title, d: desc }
    )
    .catch(() => {});
  await page.waitForTimeout(HEADED ? 1100 : 300);
};
const loadCase = async (name) => {
  await page.locator(`[data-testcase="${name}"]`).click();
  await page.waitForTimeout(HEADED ? 1200 : 800);
};

// ---------- Demo flow ----------
async function runDemo(iteration) {
  failed = false;
  pageErrors.length = 0;
  console.log(
    `\n${'='.repeat(64)}\nDemo run #${iteration}  ${new Date().toLocaleTimeString()}\n${'='.repeat(64)}`
  );
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.leaflet-pm-toolbar .button-container', {
    timeout: 30000,
  });
  await page.waitForTimeout(HEADED ? 2000 : 1000);
  await refreshBox();

  // 1. Toolbar
  await showBanner(
    'Toolbar',
    'The 19 default buttons (7 draw + 8 edit + 4 options)'
  );
  const buttonCount = await page.evaluate(
    `document.querySelectorAll('.leaflet-pm-toolbar .button-container').length`
  );
  check(
    'toolbar has 19 default buttons',
    buttonCount === 19,
    `${buttonCount} buttons`
  );
  const snappingActive = await page.evaluate(
    `!!document.querySelector('.button-container[title="Snap dragged marker to other layers and vertices"].active, .button-container.active[title="Snap dragged marker to other layers and vertices"]') ||
     Array.from(document.querySelectorAll('.button-container.active')).some(el => (el.getAttribute('title')||'').includes('Snap dragged'))`
  );
  check('snapping on by default (button highlighted)', snappingActive);

  // 2. Polyline + live measurements
  await showBanner(
    'Draw Polyline + Live Measurements',
    'Click several vertices to draw a polyline; the cursor tooltip shows Length / Segment length / Position Marker live'
  );
  await clickBtn('Draw Polyline');
  await clickAt(-160, -60);
  await clickAt(-20, -90);
  await moveAt(60, -20);
  const tip = await page.evaluate(
    `(() => {
      const t = Array.from(document.querySelectorAll('.leaflet-tooltip')).find((el) => el.textContent.includes('Length'));
      return t ? t.textContent.replace(/\\s+/g, ' ').trim() : '';
    })()`
  );
  check(
    'live measurements while drawing',
    /Length/.test(tip) &&
      /Segment length/.test(tip) &&
      /Position Marker/.test(tip),
    tip.slice(0, 60)
  );
  await clickAt(60, -20); // 3rd segment: continue to the lower right
  await clickAt(140, 40); // 4th segment
  await page
    .getByRole('button', { name: 'Finish', exact: true })
    .click()
    .catch(() => {});
  await page.waitForTimeout(HEADED ? 800 : 400);
  const polylineVerts = (await layers()).vertices[0];
  check(
    'polyline is multi-segment (>= 4 vertices)',
    polylineVerts >= 4,
    `vertices=${polylineVerts}`
  );

  // 3. Polygon + area / perimeter
  await showBanner(
    'Draw Polygon',
    'Shows Area and Perimeter live; close on the first vertex to finish'
  );
  await clickBtn('Draw Polygons');
  await clickAt(-180, 60);
  await clickAt(-60, 60);
  await clickAt(-110, 160);
  await moveAt(-140, 100);
  const areaTip = await page.evaluate(
    `(() => {
      const t = Array.from(document.querySelectorAll('.leaflet-tooltip')).find((el) => el.textContent.includes('Area'));
      return t ? t.textContent.replace(/\\s+/g, ' ').trim() : '';
    })()`
  );
  check(
    'polygon live area/perimeter',
    /Area/.test(areaTip) && /Perimeter/.test(areaTip),
    areaTip.slice(0, 50)
  );
  await clickAt(-180, 60); // close
  await page.waitForTimeout(HEADED ? 900 : 500);

  // 4. Rectangle + height / width
  await showBanner(
    'Draw Rectangle',
    'Shows all four measurements: Area / Perimeter / Height / Width'
  );
  await clickBtn('Draw Rectangle');
  await clickAt(60, -60);
  await moveAt(180, 30);
  await clickAt(180, 30);
  check('rectangle drawn', (await layers()).count >= 3);
  await page.waitForTimeout(HEADED ? 600 : 300);

  // 5. Circle + radius
  await showBanner(
    'Draw Circle',
    'Shows Radius / Area / Perimeter live; drag to set the radius'
  );
  await clickBtn('Draw Circle');
  await clickAt(210, -160);
  await moveAt(290, -160);
  await clickAt(290, -160);
  check(
    'circle drawn',
    (await layers()).types.includes('Polygon') ||
      (await layers()).types.includes('Circle')
  );
  await page.waitForTimeout(HEADED ? 600 : 300);

  // 6. Marker / CircleMarker / Point
  await showBanner(
    'Marker shapes',
    'Marker (click to place) / CircleMarker (screen-pixel radius, size stays constant while zooming)'
  );
  await clickBtn('Draw Marker');
  await clickAt(-40, 150);
  check('marker placed', (await layers()).count >= 4);
  await clickBtn('Draw Circle Marker');
  await clickAt(10, 150);
  check('circlemarker placed', (await layers()).count >= 5);

  // 7. Text
  await showBanner('Text', 'Click the map to place text, type and press Enter');
  await clickBtn('Draw Text');
  await clickAt(80, 150);
  await page.keyboard.type('Geoman');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(HEADED ? 800 : 400);
  check('text created', (await layers()).count >= 6);

  // 8. Snapping
  await showBanner(
    'Vertex Snapping',
    'Vertices drawn near existing vertices snap automatically (on by default, toggleable in the toolbar)'
  );
  const snapBefore = await option('snappable');
  check('snappable on by default', snapBefore === true);

  // 9. Snap guides
  await showBanner(
    'Snap Guides',
    'Dashed 90° guide lines appear while snapping to help alignment'
  );
  await clickBtn('Show SnapGuides');
  check('showSnapGuides enabled', (await option('showSnapGuides')) === true);
  await clickBtn('Show SnapGuides');
  await page.waitForTimeout(HEADED ? 400 : 200);

  // 10. Auto trace
  await showBanner(
    'Auto Trace',
    'Click near the middle of an existing border and the border corner vertices are inserted automatically - the line follows the border (more vertices than clicks)'
  );
  await loadCase('pinning'); // tidy squares: clear borders and corners
  await clickBtn('Auto trace Line');
  await clickBtn('Draw Polyline');
  // Click at 30% of the bottom edge and 40% of the right edge of the big
  // square (snapping to the segment, not a vertex); tracing inserts the SW
  // corner and the shared SE corner respectively
  const tracePts = await page.evaluate(`(() => {
    const ring = window.map.pm.getGeomanDrawLayers()[0].getLatLngs()[0];
    const toOff = (ll) => {
      const p = window.map.latLngToContainerPoint(ll);
      const s = window.map.getSize();
      return [p.x - s.x / 2, p.y - s.y / 2];
    };
    const a = L.latLng(ring[0]); // SW
    const b = L.latLng(ring[1]); // SE
    const c = L.latLng(ring[2]); // NE
    const p1 = L.latLng(a.lat + (b.lat - a.lat) * 0.3, a.lng + (b.lng - a.lng) * 0.3);
    const p2 = L.latLng(b.lat + (c.lat - b.lat) * 0.4, b.lng + (c.lng - b.lng) * 0.4);
    return [toOff(p1), toOff(p2)];
  })()`);
  await clickAt(...tracePts[0]);
  await clickAt(...tracePts[1]);
  await page
    .getByRole('button', { name: 'Finish', exact: true })
    .click()
    .catch(() => {});
  await page.waitForTimeout(HEADED ? 900 : 500);
  await clickBtn('Auto trace Line'); // off
  const traceInfo = await page.evaluate(`(() => {
    const lines = window.map.pm
      .getGeomanDrawLayers()
      .filter((l) => l instanceof L.Polyline && !(l instanceof L.Polygon));
    const l = lines[lines.length - 1];
    const ring = window.map.pm.getGeomanDrawLayers()[0].getLatLngs()[0];
    const has = (v) => l.getLatLngs().some((x) => x.equals(L.latLng(v)));
    return { vertices: l.getLatLngs().length, hasSW: has(ring[0]), hasSE: has(ring[1]) };
  })()`);
  check(
    'auto trace works (2 clicks -> >= 4 vertices)',
    traceInfo.vertices >= 4,
    `vertices=${traceInfo.vertices}`
  );
  check(
    'traced line passes the border corners (SW/SE)',
    traceInfo.hasSW && traceInfo.hasSE,
    JSON.stringify(traceInfo)
  );

  // 11. Edit mode + live measurement updates
  await showBanner(
    'Edit Mode',
    'Drag vertices to reshape; measurements refresh live'
  );
  await loadCase('basic-shapes');
  await clickBtn('Edit Layers');
  const markersVisible = await page.evaluate(
    `document.querySelectorAll('.leaflet-marker-icon').length`
  );
  check(
    'vertex markers visible',
    markersVisible > 0,
    `${markersVisible} markers`
  );
  const before = await page.evaluate(
    `window.map.pm.getGeomanDrawLayers()[0].getLatLngs()[0][0].lat`
  );
  // drag the first vertex of the first layer (snapping grabs the vertex marker)
  const [vx, vy] = await page.evaluate(`(() => {
    const ll = window.map.pm.getGeomanDrawLayers()[0].getLatLngs()[0][0];
    const p = window.map.latLngToContainerPoint(ll);
    const size = window.map.getSize();
    return [p.x - size.x / 2, p.y - size.y / 2];
  })()`);
  await dragAt(vx, vy, vx + 45, vy + 30);
  const after = await page.evaluate(
    `window.map.pm.getGeomanDrawLayers()[0].getLatLngs()[0][0].lat`
  );
  check(
    'vertex drag works',
    Math.abs(after - before) > 0.0004,
    `${before.toFixed(5)} → ${after.toFixed(5)}`
  );
  await clickBtn('Edit Layers');

  // 12. Drag whole layer
  await showBanner('Drag Mode', 'Move a whole layer');
  await clickBtn('Drag Layers');
  const westBefore = await page.evaluate(
    `JSON.stringify(window.map.pm.getGeomanDrawLayers().map((l) => (l.getBounds ? l.getBounds().getWest() : (l.getLatLng ? l.getLatLng().lng : null))))`
  );
  const [px, py] = await page.evaluate(`(() => {
    const c = window.map.pm.getGeomanDrawLayers()[0].getBounds().getCenter();
    const p = window.map.latLngToContainerPoint(c);
    const size = window.map.getSize();
    return [p.x - size.x / 2, p.y - size.y / 2];
  })()`);
  await dragAt(px, py, px + 70, py + 45);
  const westAfter = await page.evaluate(
    `JSON.stringify(window.map.pm.getGeomanDrawLayers().map((l) => (l.getBounds ? l.getBounds().getWest() : (l.getLatLng ? l.getLatLng().lng : null))))`
  );
  check('whole-layer drag works', westBefore !== westAfter);
  await clickBtn('Drag Layers');

  // 13. Rotate & Scale
  await showBanner(
    'Rotate / Scale',
    'Rotate: drag a rotation handle at a vertex to rotate around the center; Scale: drag a bounding-box corner handle to resize'
  );
  await clickBtn('Rotate Layers');
  const rotActive = await page.evaluate(
    `Array.from(document.querySelectorAll('.button-container.active')).some(el => (el.getAttribute('title')||'').includes('Rotate'))`
  );
  check('rotate mode active', rotActive);
  // rotation handles = markers at each layer vertex: drag a vertex handle of
  // the first layer (the triangle)
  const rotHandle = await latlngOffsets(
    ...(await page.evaluate(
      `(() => { const ll = window.map.pm.getGeomanDrawLayers()[0].getLatLngs()[0][0]; return [ll.lat, ll.lng]; })()`
    ))
  );
  await dragAt(
    rotHandle[0],
    rotHandle[1],
    rotHandle[0] + 85,
    rotHandle[1] + 55
  );
  const angle = await page.evaluate(
    `window.map.pm.getGeomanDrawLayers()[0].pm.getAngle()`
  );
  check(
    'shape rotated (angle changed)',
    angle > 5 && angle < 355,
    `angle=${Number(angle).toFixed(1)}°`
  );
  await clickBtn('Rotate Layers');
  await clickBtn('Scale Layers');
  const scaleActive = await page.evaluate(
    `Array.from(document.querySelectorAll('.button-container.active')).some(el => (el.getAttribute('title')||'').includes('Scale'))`
  );
  check('scale mode active', scaleActive);
  const scaleSpan = () =>
    page.evaluate(`(() => {
      const b = window.map.pm.getGeomanDrawLayers()[0].getBounds();
      return window.map.distance(b.getNorthWest(), b.getNorthEast()) + window.map.distance(b.getNorthWest(), b.getSouthWest());
    })()`);
  const scaleHandle = await page.evaluate(`(() => {
    const layer = window.map.pm.getGeomanDrawLayers()[0];
    const h = layer.pm._scaleHandles && layer.pm._scaleHandles.topleft;
    const ll = h ? h.marker.getLatLng() : layer.getBounds().getNorthWest();
    const p = window.map.latLngToContainerPoint(ll);
    const s = window.map.getSize();
    return [p.x - s.x / 2, p.y - s.y / 2];
  })()`);
  const sizeBefore = await scaleSpan();
  await dragAt(
    scaleHandle[0],
    scaleHandle[1],
    scaleHandle[0] - 70,
    scaleHandle[1] - 45
  );
  const sizeAfter = await scaleSpan();
  check(
    'shape scaled (bounding box grew)',
    sizeAfter > sizeBefore * 1.15,
    `${sizeBefore.toFixed(0)}m → ${sizeAfter.toFixed(0)}m`
  );
  await clickBtn('Scale Layers');

  // 14. Cut
  await showBanner(
    'Cut',
    'Draw a cut line to split a polygon in two (result is a MultiPolygon)'
  );
  await loadCase('boolean-ops');
  await clickBtn('Cut Layers');
  await clickAt(-100, 30);
  await clickAt(0, 60);
  await clickAt(70, 130);
  await clickAt(-100, 30); // close the cut line
  await page.waitForTimeout(HEADED ? 1600 : 900);
  const types = (await layers()).types;
  check(
    'cut produces a MultiPolygon',
    types.includes('MultiPolygon'),
    types.join(',')
  );

  // 15. Split
  await showBanner(
    'Split',
    'A split line divides a polygon into two independent layers'
  );
  await loadCase('boolean-ops');
  const splitBefore = (await layers()).count;
  await clickBtn('Split Layer');
  await clickAt(-100, 30);
  await clickAt(0, 60);
  await clickAt(70, 130);
  // finish via the action button: a closing click back on the start point is
  // unreliable here because vertex snapping can shift the first click's
  // actual position, so the closing click no longer matches it exactly
  await page
    .getByRole('button', { name: 'Finish', exact: true })
    .click()
    .catch(() => {});
  await page.waitForTimeout(HEADED ? 1600 : 900);
  check(
    'split adds layers',
    (await layers()).count >= splitBefore + 1,
    `${splitBefore} → ${(await layers()).count}`
  );

  // 16. Union
  await showBanner(
    'Union',
    'Click two polygons and they merge automatically; the mode stays enabled'
  );
  await loadCase('boolean-ops');
  await clickBtn('Union layers');
  await clickAt(-90, 30);
  await clickAt(50, 90);
  await page.waitForTimeout(HEADED ? 1400 : 800);
  const unionCount = (await layers()).count;
  check('auto-merged into one layer', unionCount === 1, `${unionCount} layers`);
  await clickBtn('Union layers'); // off

  // 17. Difference
  await showBanner(
    'Difference',
    'The Subtract icon of the Union menu switches to difference (icon and function switch together); the Union icon of the Subtract menu switches back; click the base layer, then the cutting layer'
  );
  await loadCase('boolean-ops');
  await clickBtn('Union layers');
  await page.locator('a.action-differenceMode').click({ force: true });
  await page.waitForTimeout(HEADED ? 700 : 400);
  check(
    'switched to difference mode',
    await page.evaluate(`window.map.pm.globalDifferenceModeEnabled()`)
  );
  // the Union button switches in place to the Subtract icon/title and stays active
  const boolSlot = () =>
    page.evaluate(`(() => {
      const c = Array.from(document.querySelectorAll('.leaflet-pm-toolbar .button-container')).find((b) => {
        const i = b.querySelector('.control-icon');
        return i && (i.className.includes('leaflet-pm-icon-union') || i.className.includes('leaflet-pm-icon-difference'));
      });
      if (!c) return null;
      const i = c.querySelector('.control-icon');
      return { title: c.getAttribute('title'), icon: i.className, active: c.classList.contains('active') };
    })()`);
  const slotDiff = await boolSlot();
  check(
    'button icon switched to Subtract',
    !!slotDiff &&
      slotDiff.title === 'Subtract layers' &&
      slotDiff.icon.includes('leaflet-pm-icon-difference') &&
      slotDiff.active,
    JSON.stringify(slotDiff)
  );
  await clickAt(-90, 30);
  await clickAt(50, 90);
  await page.waitForTimeout(HEADED ? 1400 : 800);
  check(
    'difference done (two layers merged into one result)',
    (await layers()).count === 1
  );
  // switch back to Union: the Union icon inside the Subtract button menu
  // (icon and function switch both ways)
  await page.locator('a.action-unionMode').click({ force: true });
  await page.waitForTimeout(HEADED ? 700 : 400);
  check(
    'menu switched back to Union mode',
    (await page.evaluate(`window.map.pm.globalUnionModeEnabled()`)) &&
      !(await page.evaluate(`window.map.pm.globalDifferenceModeEnabled()`))
  );
  const slotBack = await boolSlot();
  check(
    'icon switched back to Union (active)',
    !!slotBack &&
      slotBack.title === 'Union layers' &&
      slotBack.icon.includes('leaflet-pm-icon-union') &&
      slotBack.active,
    JSON.stringify(slotBack)
  );
  // click the (now Union) button to disable the mode
  await clickBtn('Union layers');
  await page.waitForTimeout(HEADED ? 700 : 400);
  check(
    'button click disables the mode',
    !(await page.evaluate(`window.map.pm.globalDifferenceModeEnabled()`)) &&
      !(await page.evaluate(`window.map.pm.globalUnionModeEnabled()`))
  );
  const slotUnion = await boolSlot();
  check(
    'Union icon kept after disabling (inactive)',
    !!slotUnion &&
      slotUnion.title === 'Union layers' &&
      slotUnion.icon.includes('leaflet-pm-icon-union') &&
      !slotUnion.active,
    JSON.stringify(slotUnion)
  );

  // 18. Removal
  await showBanner('Removal Mode', 'Click a layer to delete it');
  await loadCase('boolean-ops');
  await clickBtn('Remove Layers');
  await clickAt(-90, 30);
  await page.waitForTimeout(HEADED ? 900 : 500);
  check('removal works', (await layers()).count === 1);
  await clickBtn('Remove Layers');

  // 19. Pinning
  await showBanner(
    'Pinning',
    'Two squares share the corner [51.53,-0.06]; in edit mode dragging it moves the vertices of both layers (with zero-length edge protection)'
  );
  await loadCase('pinning');
  await clickBtn('Pin shared vertices together');
  check('pinning enabled', (await option('pinning')) === true);
  await clickBtn('Edit Layers');
  // open terrain east of the shared corner: drag the shared vertex east,
  // away from the edges of both layers (to avoid snapping interference)
  const corner = await latlngOffsets(51.53, -0.06);
  const cornerTarget = [corner[0] + 55, corner[1] - 8];
  await dragAt(corner[0], corner[1], cornerTarget[0], cornerTarget[1]);
  const pinState = await page.evaluate(
    `(() => {
      const old = L.latLng([51.53, -0.06]);
      const size = window.map.getSize();
      const target = window.map.containerPointToLatLng([size.x / 2 + ${cornerTarget[0]}, size.y / 2 + ${cornerTarget[1]}]);
      const polys = window.map.pm.getGeomanDrawLayers().filter((l) => l instanceof L.Polygon);
      const distTo = (l, ref) => Math.min(...l.getLatLngs()[0].map((v) => window.map.distance(v, ref)));
      return {
        fromOld: polys.map((l) => distTo(l, old)),
        toTarget: polys.map((l) => distTo(l, target)),
      };
    })()`
  );
  check(
    'shared vertex left its old position (both layers moved)',
    pinState.fromOld.length === 2 && pinState.fromOld.every((d) => d > 20),
    `dist from old corner=${pinState.fromOld.map((d) => d.toFixed(0)).join(',')}m`
  );
  check(
    'vertices of both layers moved to the new position',
    pinState.toTarget.every((d) => d < 30),
    `dist to target=${pinState.toTarget.map((d) => d.toFixed(0)).join(',')}m`
  );
  const minEdge = await page.evaluate(`(() => {
    let min = Infinity;
    window.map.pm.getGeomanDrawLayers().forEach((l) => {
      if (!(l instanceof L.Polygon)) return;
      const ring = l.getLatLngs()[0];
      for (let i = 0; i < ring.length; i++) {
        min = Math.min(min, window.map.distance(ring[i], ring[(i + 1) % ring.length]));
      }
    });
    return min;
  })()`);
  check(
    'no zero-length edge (regression protection)',
    minEdge > 1,
    `shortest edge=${minEdge.toFixed(0)}m`
  );
  await clickBtn('Edit Layers');
  await clickBtn('Pin shared vertices together');

  // 20. Undo / Redo (fork addition)
  await showBanner(
    'Undo / Redo (fork enhancement)',
    'Ctrl+Z / Ctrl+Y undo and redo: draws, edits, boolean ops, layer order changes and category changes'
  );
  await loadCase('empty');
  await clickBtn('Draw Marker');
  await clickAt(0, 0);
  const drawn = (await layers()).count;
  await $('#btn-undo').click();
  await page.waitForTimeout(HEADED ? 700 : 400);
  const undone = (await layers()).count;
  await $('#btn-redo').click();
  await page.waitForTimeout(HEADED ? 700 : 400);
  const redone = (await layers()).count;
  check(
    'undo/redo works',
    drawn === 1 && undone === 0 && redone === 1,
    `${drawn}→${undone}→${redone}`
  );

  // 21. Categories (fork addition)
  await showBanner(
    'Categories (fork addition)',
    'Preset category styles (river=blue, house=orange) applied automatically to new draws; Ctrl+click changes the category'
  );
  await loadCase('categories');
  await page.locator('#opt-category').selectOption('river');
  await page.waitForTimeout(HEADED ? 400 : 200);
  await clickBtn('Draw Polygons');
  await clickAt(-80, -40);
  await clickAt(60, -40);
  await clickAt(10, 60);
  await clickAt(-80, -40);
  const catColor = await page.evaluate(
    `window.map.pm.getGeomanDrawLayers().slice(-1)[0].options.color`
  );
  check(
    'category style applied automatically',
    catColor === '#3388ff',
    `color=${catColor}`
  );

  // 22. Extensions toggle + Freehand / Point / Simplify (fork extensions)
  await showBanner(
    'Extensions Toggle (Pro Extensions)',
    'The sidebar toggle shows/hides the extension toolbar buttons in one click: lasso, layer front/back, freehand, point, copy, simplify'
  );
  const buttonsBeforeExt = await page.evaluate(
    `document.querySelectorAll('.leaflet-pm-toolbar .button-container').length`
  );
  await page.locator('label.toggle:has(#opt-proExtensions)').click();
  await page.waitForTimeout(HEADED ? 900 : 500);
  const buttonsAfterExt = await page.evaluate(
    `document.querySelectorAll('.leaflet-pm-toolbar .button-container').length`
  );
  check(
    'extension buttons toggled on in one click (+7)',
    buttonsAfterExt === buttonsBeforeExt + 7,
    `${buttonsBeforeExt} → ${buttonsAfterExt}`
  );

  // Freehand: hold and drag to sketch, release to finish
  await showBanner(
    'Freehand Draw',
    'Hold the mouse and drag to sketch a polygon; releasing closes and finishes it (vertices are collected along the path)'
  );
  const countBeforeFreehand = (await layers()).count;
  await clickBtn('Freehand Draw');
  await page.mouse.move(...at(150, -160));
  await page.mouse.down();
  for (const [dx, dy] of [
    [200, -120],
    [240, -60],
    [190, -30],
    [130, -70],
    [155, -140],
  ]) {
    await page.mouse.move(...at(dx, dy), { steps: 4 });
    await page.waitForTimeout(HEADED ? 40 : 20);
  }
  await page.mouse.up();
  await page.waitForTimeout(HEADED ? 900 : 500);
  await clickBtn('Freehand Draw');
  const freehandInfo = await page.evaluate(`(() => {
    const ls = window.map.pm.getGeomanDrawLayers();
    const l = ls[ls.length - 1];
    return {
      count: ls.length,
      type: l.toGeoJSON().geometry.type,
      vertices: l.getLatLngs().flat().length,
    };
  })()`);
  check(
    'freehand produces a polygon (path vertices)',
    freehandInfo.count === countBeforeFreehand + 1 &&
      freehandInfo.type === 'Polygon' &&
      freehandInfo.vertices >= 8,
    `vertices=${freehandInfo.vertices}`
  );

  // Point: click to place a small dot
  await showBanner(
    'Point Draw',
    'Click to place a small dot at an exact position (screen-pixel radius, size stays constant while zooming)'
  );
  await clickBtn('Draw Point');
  await clickAt(230, 160);
  await clickBtn('Draw Point');
  const pointInfo = await page.evaluate(`(() => {
    const ls = window.map.pm.getGeomanDrawLayers();
    const l = ls[ls.length - 1];
    return { type: l.toGeoJSON().geometry.type, radius: l.getRadius() };
  })()`);
  check(
    'point draw works (GeoJSON Point)',
    pointInfo.type === 'Point' && pointInfo.radius === 6,
    `type=${pointInfo.type}, r=${pointInfo.radius}px`
  );

  // Simplify: click the freehand polygon to reduce vertices (Douglas-Peucker)
  await showBanner(
    'Simplify',
    'Click a shape to reduce its vertices with the Douglas-Peucker algorithm (simplificationFactor controls the strength)'
  );
  await page.evaluate(
    `window.map.pm.setGlobalOptions({ simplificationFactor: 0.06 })`
  );
  const freehandCenter = await page.evaluate(`(() => {
    const ls = window.map.pm.getGeomanDrawLayers();
    const polys = ls.filter((l) => l instanceof L.Polygon);
    const b = polys[polys.length - 1].getBounds();
    const p = window.map.latLngToContainerPoint(b.getCenter());
    const s = window.map.getSize();
    return [p.x - s.x / 2, p.y - s.y / 2];
  })()`);
  const simplifyCount = () =>
    page.evaluate(`(() => {
      const ls = window.map.pm.getGeomanDrawLayers();
      const polys = ls.filter((l) => l instanceof L.Polygon);
      return polys[polys.length - 1].getLatLngs().flat().length;
    })()`);
  const simplifyBefore = await simplifyCount();
  await clickBtn('Remove multiple vertices at once');
  await clickAt(...freehandCenter);
  await page.waitForTimeout(HEADED ? 900 : 500);
  await clickBtn('Remove multiple vertices at once');
  const simplifyAfter = await simplifyCount();
  check(
    'simplify reduces vertices',
    simplifyAfter < simplifyBefore,
    `${simplifyBefore} → ${simplifyAfter}`
  );
  await page.evaluate(
    `window.map.pm.setGlobalOptions({ simplificationFactor: 0.003 })`
  );

  // 23. Layer order front/back (fork extension)
  await showBanner(
    'Layer Order (fork extension)',
    'Send layer to back / Bring layer to front: click a layer to change its SVG stacking order; changes are undoable'
  );
  // DOM ranks of the vector layers (inside the same SVG container, higher = on top)
  const stackRanks = () =>
    page.evaluate(`(() => {
      const ls = window.map.pm
        .getGeomanDrawLayers()
        .filter((l) => l._path && l._path.parentNode);
      const parent = ls[0]._path.parentNode;
      return ls.map((l) => Array.prototype.indexOf.call(parent.children, l._path));
    })()`);
  // target: the polygon drawn in the categories section (river blue, center area)
  const drawnCenter = await page.evaluate(`(() => {
    const ls = window.map.pm.getGeomanDrawLayers();
    const poly = ls.find((l) => l instanceof L.Polygon && !(l instanceof L.Rectangle));
    const p = window.map.latLngToContainerPoint(poly.getBounds().getCenter());
    const s = window.map.getSize();
    return [p.x - s.x / 2, p.y - s.y / 2];
  })()`);
  await clickBtn('Send layer to back');
  await clickAt(...drawnCenter);
  await page.waitForTimeout(HEADED ? 700 : 400);
  const ranksBack = await stackRanks();
  const drawnIdx = await page.evaluate(
    `window.map.pm.getGeomanDrawLayers().findIndex((l) => l instanceof L.Polygon && !(l instanceof L.Rectangle))`
  );
  check(
    'moved to the bottom (DOM rank = 0)',
    ranksBack[drawnIdx] === 0,
    `rank=${ranksBack.join(',')}`
  );
  await clickBtn('Bring layer to front');
  const frontActive = await page.evaluate(
    `Array.from(document.querySelectorAll('.button-container.active')).some(el => (el.getAttribute('title')||'').includes('front'))`
  );
  check('front mode available', frontActive);
  await clickAt(...drawnCenter);
  await page.waitForTimeout(HEADED ? 700 : 400);
  const ranksFront = await stackRanks();
  check(
    'moved to the top (DOM rank highest)',
    ranksFront[drawnIdx] === Math.max(...ranksFront),
    `rank=${ranksFront.join(',')}`
  );
  await clickBtn('Bring layer to front');

  // 24. Lasso multi-select (fork extension)
  await showBanner(
    'Lasso Multi-Select',
    'Drag to select multiple shapes: selected keep their look, the rest dim; click empty ground to clear the selection (Shift+drag appends)'
  );
  await loadCase('basic-shapes');
  await clickBtn('Lasso Select');
  // circle the bounding box of the triangle (first polygon), padded by 25px:
  // what is inside gets selected, what is outside dims
  const lassoBox = await page.evaluate(`(() => {
    const ls = window.map.pm.getGeomanDrawLayers();
    const poly = ls.find((l) => l instanceof L.Polygon);
    const b = poly.getBounds();
    const size = window.map.getSize();
    const nw = window.map.latLngToContainerPoint(b.getNorthWest());
    const se = window.map.latLngToContainerPoint(b.getSouthEast());
    const pad = 25;
    return [
      nw.x - pad - size.x / 2,
      nw.y - pad - size.y / 2,
      se.x + pad - size.x / 2,
      se.y + pad - size.y / 2,
    ];
  })()`);
  await lassoDrag(...lassoBox);
  const lassoSel = await page.evaluate(`(() => {
    const sel = window.map.pm.getSelectedLayers();
    const all = window.map.pm.getGeomanDrawLayers();
    return {
      selected: sel.length,
      all: all.length,
      allSelected: sel.every((l) => l.pm.isSelected()),
      dimmed: all.filter(
        (l) => !sel.includes(l) && l instanceof L.Path && l.options.opacity < 1
      ).length,
    };
  })()`);
  check(
    'lasso multi-select works (>= 2 shapes selected)',
    lassoSel.selected >= 2 &&
      lassoSel.selected < lassoSel.all &&
      lassoSel.allSelected,
    `selected=${lassoSel.selected}/${lassoSel.all}`
  );
  check(
    'selection feedback (other layers dim)',
    lassoSel.dimmed >= 1,
    `dimmed=${lassoSel.dimmed}`
  );
  await clickAt(-260, -170); // click empty ground: clear the selection
  const clearedSel = await page.evaluate(
    `window.map.pm.getSelectedLayers().length`
  );
  check(
    'click on empty ground clears the selection',
    clearedSel === 0,
    `${clearedSel} left`
  );

  // Selection effect toggle: black outline mode (selected shapes get a black
  // frame, other layers no longer dim)
  await showBanner(
    'Selection Effect: Black Outline',
    'Switch the sidebar Selection Effect to Black outline: selected shapes are framed in black, other layers keep their look'
  );
  await page.locator('#opt-selectionEffect').selectOption('outline');
  await page.waitForTimeout(HEADED ? 500 : 300);
  await lassoDrag(...lassoBox);
  const outlineState = await page.evaluate(`(() => {
    const sel = window.map.pm.getSelectedLayers();
    const all = window.map.pm.getGeomanDrawLayers();
    return {
      selected: sel.length,
      dimmed: all.filter(
        (l) => l instanceof L.Path && l.options.opacity < 1
      ).length,
      outlines: document.querySelectorAll(
        '.pm-selection-outline, .pm-selection-outline-element'
      ).length,
    };
  })()`);
  check(
    'outline mode: selected shapes have a black frame',
    outlineState.selected >= 2 && outlineState.outlines >= 1,
    `selected=${outlineState.selected}, outlines=${outlineState.outlines}`
  );
  check(
    'outline mode: other layers not dimmed',
    outlineState.dimmed === 0,
    `dimmed=${outlineState.dimmed}`
  );
  // stroke style applies to the outline: with Stroke Style = Dashed line the
  // selection outline becomes dashed
  await showBanner(
    'Stroke Style × Outline',
    'Switch the sidebar Stroke Style to Dashed line: the selection outline (including text label frames) becomes dashed; switching back to Solid line restores it'
  );
  await page.locator('#opt-strokeStyle').selectOption('dashed');
  await page.waitForTimeout(HEADED ? 500 : 300);
  const dashedState = await page.evaluate(`(() => {
    const frames = [...document.querySelectorAll('.pm-selection-outline')];
    return {
      total: frames.length,
      dashed: frames.filter(
        (f) => (f.getAttribute('stroke-dasharray') || '').trim()
      ).length,
      cssClass: window.map
        .getContainer()
        .classList.contains('pm-selection-outline-dashed'),
    };
  })()`);
  check(
    'dashed mode: outline stroke becomes dashed',
    dashedState.total >= 1 &&
      dashedState.dashed === dashedState.total &&
      dashedState.cssClass,
    `dashed=${dashedState.dashed}/${dashedState.total}, cssClass=${dashedState.cssClass}`
  );
  await page.locator('#opt-strokeStyle').selectOption('solid');
  await page.waitForTimeout(HEADED ? 500 : 300);
  const solidState = await page.evaluate(`(() => {
    const frames = [...document.querySelectorAll('.pm-selection-outline')];
    return {
      total: frames.length,
      dashed: frames.filter(
        (f) => (f.getAttribute('stroke-dasharray') || '').trim()
      ).length,
      cssClass: window.map
        .getContainer()
        .classList.contains('pm-selection-outline-dashed'),
    };
  })()`);
  check(
    'switched back to solid: outline solid again',
    solidState.total >= 1 && solidState.dashed === 0 && !solidState.cssClass,
    `dashed=${solidState.dashed}/${solidState.total}, cssClass=${solidState.cssClass}`
  );
  await page.locator('#opt-selectionEffect').selectOption('dim'); // switch back to dim
  await page.waitForTimeout(HEADED ? 500 : 300);
  const dimAgain = await page.evaluate(`(() => {
    const sel = new Set(window.map.pm.getSelectedLayers());
    return {
      outlines: document.querySelectorAll('.pm-selection-outline').length,
      dimmed: window.map.pm
        .getGeomanDrawLayers()
        .filter((l) => !sel.has(l) && l instanceof L.Path && l.options.opacity < 1).length,
    };
  })()`);
  check(
    'switched back to dim mode',
    dimAgain.outlines === 0 && dimAgain.dimmed >= 1,
    `outlines=${dimAgain.outlines}, dimmed=${dimAgain.dimmed}`
  );
  await clickAt(-260, -170); // clear the selection

  // Delete via keyboard: lasso again -> Delete removes all selected ->
  // Ctrl+Z restores them in one step
  await showBanner(
    'Lasso + Delete',
    'Lasso several shapes, then press Delete/Backspace to remove them all at once (one Ctrl+Z restores everything)'
  );
  await lassoDrag(...lassoBox);
  const deleteState = await page.evaluate(`(() => {
    const sel = window.map.pm.getSelectedLayers();
    window.map.pm.setGlobalOptions({ keyboardShortcuts: true });
    return { selected: sel.length, layers: window.map.pm.getGeomanDrawLayers().length };
  })()`);
  check(
    'lasso multi-select again',
    deleteState.selected >= 2,
    `selected=${deleteState.selected}`
  );
  await page.keyboard.press('Delete');
  await page.waitForTimeout(HEADED ? 700 : 400);
  const afterDelete = await page.evaluate(`(() => ({
    layers: window.map.pm.getGeomanDrawLayers().length,
    selected: window.map.pm.getSelectedLayers().length,
  }))()`);
  check(
    'Delete removes all selected shapes',
    afterDelete.layers === deleteState.layers - deleteState.selected &&
      afterDelete.selected === 0,
    `${deleteState.layers} → ${afterDelete.layers} (selected left ${afterDelete.selected})`
  );
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(HEADED ? 700 : 400);
  const afterUndo = await page.evaluate(
    `window.map.pm.getGeomanDrawLayers().length`
  );
  check(
    'Ctrl+Z restores everything in one step',
    afterUndo === deleteState.layers,
    `${afterDelete.layers} → ${afterUndo}`
  );
  await page.evaluate(
    `window.map.pm.setGlobalOptions({ keyboardShortcuts: false })`
  );
  await clickBtn('Lasso Select');

  // 25. Copy + extensions toggle off (fork extension)
  await showBanner('Copy Layer', 'Click a layer to create an offset duplicate');
  const beforeCopy = (await layers()).count;
  const copyTarget = await page.evaluate(`(() => {
    const ls = window.map.pm.getGeomanDrawLayers();
    const poly = ls.find((l) => l instanceof L.Polygon);
    const p = window.map.latLngToContainerPoint(poly.getBounds().getCenter());
    const s = window.map.getSize();
    return [p.x - s.x / 2, p.y - s.y / 2];
  })()`);
  await clickBtn('Copy Layer');
  await clickAt(...copyTarget);
  await page.waitForTimeout(HEADED ? 900 : 500);
  await clickBtn('Copy Layer');
  const afterCopy = (await layers()).count;
  check(
    'copy creates a duplicate',
    afterCopy === beforeCopy + 1,
    `${beforeCopy} → ${afterCopy}`
  );

  // extensions toggle off: the 7 extension buttons hide
  await showBanner(
    'Extensions Toggle Off',
    'Click Pro Extensions again: the lasso / order / freehand / point / copy / simplify buttons all hide'
  );
  await page.locator('label.toggle:has(#opt-proExtensions)').click();
  await page.waitForTimeout(HEADED ? 900 : 500);
  const buttonsFinal = await page.evaluate(
    `document.querySelectorAll('.leaflet-pm-toolbar .button-container').length`
  );
  check(
    'extension buttons toggled off in one click',
    buttonsFinal === buttonsBeforeExt,
    `${buttonsAfterExt} → ${buttonsFinal}`
  );

  // 26. Keyboard shortcuts
  await showBanner(
    'Keyboard Shortcuts (fork enhancement)',
    'When enabled, M/L/P/R/C/T etc. start tools, Esc exits, Enter finishes'
  );
  await page.locator('label.toggle:has(#opt-keyboardShortcuts)').click();
  await page.waitForTimeout(HEADED ? 500 : 300);
  await clickAt(200, 200); // move focus away
  await page.keyboard.press('m');
  await page.waitForTimeout(HEADED ? 600 : 300);
  const shape = await page.evaluate(
    `window.map.pm.Draw.getActiveShape ? window.map.pm.Draw.getActiveShape() : null`
  );
  check('M key starts Marker draw', shape === 'Marker', `shape=${shape}`);
  await page.locator('label.toggle:has(#opt-keyboardShortcuts)').click();

  // 27. Page errors
  check(
    'no page errors during the whole run',
    pageErrors.length === 0,
    pageErrors.slice(0, 2).join(' | ')
  );

  await showBanner(
    'Demo finished',
    `${results.filter((r) => r.pass).length}/${results.length} checks passed in this run`
  );
}

// ---------- Run ----------
if (LOOP) {
  console.log(`Loop mode: repeating the demo until a failure (Ctrl+C to stop)`);
  let iteration = 0;
  // loop mode reuses the same browser; switching to headless automatically
  // when no visible window is needed would interrupt the demo - keep the mode
  while (!failed) {
    iteration += 1;
    const startIdx = results.length;
    await runDemo(iteration);
    const iterResults = results.slice(startIdx);
    const iterPassed = iterResults.filter((r) => r.pass).length;
    console.log(
      `\nRun #${iteration} finished: ${iterPassed}/${iterResults.length} passed`
    );
    if (failed) {
      console.log(
        `\n✗ Run #${iteration} has failures, stopping the loop. Failed checks:`
      );
      results
        .filter((r) => !r.pass)
        .forEach((r) => console.log(`  - ${r.name} ${r.detail}`));
      break;
    }
    await page.waitForTimeout(1500);
  }
} else {
  await runDemo(1);
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n===== ${passed}/${results.length} PASS =====`);
await browser.close();
process.exit(passed === results.length ? 0 : 1);
