<p align="center">  
  <a href="https://geoman.io">  
    <img width="130" alt="Geoman Logo" src="https://assets.geoman.io/assets/logo_white_bg.svg" />  
  </a>  
</p>  
<h1 align="center">  
  Leaflet-Geoman  
</h1>  
<p align="center">  
  <strong>Leaflet Plugin For Creating And Editing Geometry Layers</strong><br>  
  Draw, Edit, Drag, Cut, Rotate, Split, Scale, Measure, Snap and Pin Layers<br>  
  Supports Markers, CircleMarkers, Polylines, Polygons, Circles, Rectangles, ImageOverlays, LayerGroups, GeoJSON, MultiLineStrings and MultiPolygons  
</p>  
<p align="center">  
  <a href="https://badge.fury.io/js/%40geoman-io%2Fleaflet-geoman-free">  
    <img src="https://badge.fury.io/js/%40geoman-io%2Fleaflet-geoman-free.svg" alt="npm version" height="18">  
  </a>  
  <a href="#">  
    <img src="https://github.com/geoman-io/leaflet-geoman/workflows/Tests/badge.svg" alt="" />  
  </a>
  <a href="https://www.npmjs.com/package/@geoman-io/leaflet-geoman-free">  
    <img src="https://img.shields.io/npm/dt/@geoman-io/leaflet-geoman-free.svg" alt="NPM Downloads" />  
  </a>  
</p>

<p align="center">
    <img src="https://assets.geoman.io/assets/draw-example.png" alt="Demo" />  
</p>

## New Features in This Fork

> [!IMPORTANT]
> **All new features listed below were developed by GLM5.3, based on the public Geoman documentation at [geoman.io/docs/leaflet](https://geoman.io/docs/leaflet)**, as an experimental, community extension of the free Leaflet-Geoman build. They are **not as mature or battle-tested as the official Geoman Pro product** — expect rough edges, missing edge-case handling and behavior differences. Geoman Pro is a source-available, actively maintained commercial product; if you need production-grade stability, priority support and regular updates, **please consider [purchasing the official Geoman Pro license](https://geoman.io/pricing)**.

This fork backports the Leaflet-Geoman Pro feature set (and a few extras) into the free build. All toolbar buttons for these are registered with icons and translations; every mode also has a `map.pm.*` API and fires `pm:*` events like the rest of Geoman.

**Drawing**
- **Freehand / Auto-Trace** – draw a polygon by dragging instead of clicking each vertex; Auto-Trace does the same while placing a normal Line.
- **Rectangle drag-draw** (`dragDraw` option) – press, drag, release to draw a rectangle in one motion instead of two clicks.
- **Snap to 90°** (`snapTo90` option) – hold a straight line to the nearest 90° multiple while drawing.
- **Point / dot mode** – a small solid marker that stays a constant screen size regardless of zoom, for precise-position pins.

**Editing**
- **Scale mode** (per-layer and global) – corner handles resize any layer; global mode toggles handles on every layer at once.
- **Split mode** – draw a line across a polygon or polyline to cut it into two layers.
- **Copy mode** – duplicate any layer with a small offset (`pm:copylayer`).
- **Simplify mode** – reduce a line/polygon's vertex count with Douglas-Peucker simplification.
- **Order mode** – bring a layer to front / send it to back.
- **Pinning** – shared vertices between layers move together when one is dragged.
- **Union / Difference** – select polygons and merge them into one, or subtract one from another.
- **Lasso selection** – freehand-select multiple layers at once (`pm:lasso-select`).

**Snapping**
- **Snap guides** – dashed guide lines (segment / horizontal / vertical) appear while a vertex snaps.

**Measurement**
- Live length / area / radius shown in a tooltip while drawing or editing a shape.

**Undo / Redo**
- Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo and redo draws, removals, edits, scaling, boolean ops, layer order changes (bring to front / send to back) and category changes.

**Categories**
- Tag layers with a category (e.g. `"river"`, `"house"`) via `map.pm.setActiveCategory()` / `layer.pm.setCategory()`; each category can carry its own style, applied automatically to every layer in it.
- New layers are auto-stamped with the active category, and it survives Union/Difference/Split/Cut results.
- Ctrl/Cmd+click an existing layer to re-categorize it (and restyle it) in place, without redrawing it.

**Selection**
- Click a layer to select it - every other Geoman-tracked layer dims to 40% opacity so the selection stands out (`layer.pm.select()`, `pm:selectionadd`/`pm:selectionremove`).

**Keyboard shortcuts** (opt-in via `keyboardShortcuts` global option)
- M/L/P/R/C/T/F to start a draw shape, Shift+M for CircleMarker, X for Cut, E/G/O/S to toggle Edit/Drag/Rotate/Scale mode, Delete to toggle removal mode.
- Escape exits the active Draw/Edit/Drag/Removal/Rotate/Cut mode (`exitModeOnEscape`); Enter finishes the shape being drawn once it has enough vertices (`finishOnEnter`) - same behavior as upstream Geoman.

**Performance**
- Large layers (thousands of vertices) render a decimated, viewport-culled subset of edit markers instead of one per vertex, while keeping the full geometry for export, editing and boolean ops (issue #366).

## Documentation

Visit [geoman.io/docs](https://www.geoman.io/docs) to get started.

## Demo

Check out the full power of Leaflet-Geoman Pro on [geoman.io/demo](https://www.geoman.io/demo)

### Feature Requests

I'm adopting the Issue Management of lodash which means, feature requests get the "Feature Request" Label and then get closed.  
You can upvote existing feature requests (or create new ones). Upvotes make me see how much a feature is requested and prioritize their implementation.  
Please see the existing [Feature Requests here](https://github.com/geoman-io/leaflet-geoman/issues?q=is%3Aissue+is%3Aclosed+label%3A%22feature+request%22+sort%3Areactions-%2B1-desc) and upvote if you want them to be implemented.

### Developing

Clone the repository and then install all npm packages:

```
npm install
```

Compile and run `dev` watch version:

```
npm run start
```

Compile and run `build` version:

```
npm run prepare
```

Run tests:

```
npm run test        # E2E tests (Cypress)
npm run test:unit   # Unit tests (Vitest)
```

Open cypress window:

```
npm run cypress
```

Open eslint check:

```
npm run lint
```

Take a look into [CONTRIBUTING](./CONTRIBUTING.md)

### Credit

A big thanks goes to @Falke-Design, he invests a lot of time and takes good care of Leaflet-Geoman.

Thanks to @ryan-morris for the implementation of Typescript and support with Typescript questions.

As I never built a leaflet plugin before, I looked heavily into the code of leaflet.draw to find out how to do stuff. So don't be surprised to see some familiar code.

I also took a hard look at the great [L.GeometryUtil](https://github.com/makinacorpus/Leaflet.GeometryUtil) for some of my helper functions.

The Rotate Mode are only working because of the great calculation code of [L.Path.Transform](https://github.com/w8r/Leaflet.Path.Transform)
