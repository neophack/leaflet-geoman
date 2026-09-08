import { copyLatLngs } from '../helpers';

/**
 * Undo / Redo (most requested feature, see upstream issue #320).
 * Tracks layer creation, removal, geometry edits and the boolean operations
 * (union / difference / split / cut / copy) on the map.
 *
 * API: map.pm.undo(), map.pm.redo(), map.pm.setUndoLimit(n),
 *      map.pm.clearUndoRedo(), map.pm.hasUndo(), map.pm.hasRedo()
 * Keyboard: Ctrl+Z (undo), Ctrl+Y / Ctrl+Shift+Z (redo)
 */
const UndoMixin = {
  _undoLimit: 100,
  _undoRedoActive: false,
  _initUndoRedo() {
    this._undoStack = [];
    this._redoStack = [];
    this._layerSnapshots = new WeakMap();

    // keep an initial snapshot of every geoman layer for edit tracking
    this.map.on('layeradd', ({ layer }) => {
      if (layer.pm && !layer._pmTempLayer) {
        this._layerSnapshots.set(layer, this._snapshot(layer));
      }
    });

    this.map.on('pm:create', ({ layer }) => this._trackCreate(layer));
    this.map.on('pm:remove', ({ layer }) => this._trackRemove(layer));
    this.map.on('pm:cut', ({ layer, originalLayer }) =>
      this._trackBoolean([originalLayer], layer)
    );
    this.map.on('pm:union', ({ resultLayer, mergedLayers }) =>
      this._trackBoolean(mergedLayers, resultLayer)
    );
    this.map.on('pm:difference', ({ resultLayer, subtractedLayers }) =>
      this._trackBoolean(subtractedLayers, resultLayer)
    );
    this.map.on('pm:split', ({ layers, originalLayer }) =>
      this._trackBoolean([originalLayer], layers)
    );
    // copies are tracked via the pm:create event that copy mode fires too
    // (listening to pm:copylayer as well would track every copy twice)

    // category changes (layer.pm.setCategory / ctrl+click re-categorize)
    this.map.on('pm:categorychange', ({ layer, oldCategory, category }) =>
      this._trackCategory(layer, oldCategory, category)
    );
  },
  setUndoLimit(limit) {
    if (limit > 0) {
      this._undoLimit = limit;
    }
  },
  hasUndo() {
    return this._undoStack.length > 0;
  },
  hasRedo() {
    return this._redoStack.length > 0;
  },
  clearUndoRedo() {
    this._undoStack = [];
    this._redoStack = [];
  },
  undo() {
    const command = this._undoStack.pop();
    if (!command) {
      return false;
    }
    this._undoRedoActive = true;
    try {
      command.undo();
    } finally {
      this._undoRedoActive = false;
    }
    this._redoStack.push(command);
    this._fireUndo(command.type);
    return true;
  },
  redo() {
    const command = this._redoStack.pop();
    if (!command) {
      return false;
    }
    this._undoRedoActive = true;
    try {
      command.redo();
    } finally {
      this._undoRedoActive = false;
    }
    this._undoStack.push(command);
    this._fireRedo(command.type);
    return true;
  },

  // ----- command tracking -------------------------------------------------

  _pushCommand(command) {
    if (this._undoRedoActive) {
      return;
    }
    // while a batch is open, collect commands instead of pushing them -
    // _endCommandBatch turns them into a single composite undo step
    if (this._batchCommands) {
      this._batchCommands.push(command);
      return;
    }
    this._undoStack.push(command);
    if (this._undoStack.length > this._undoLimit) {
      this._undoStack.shift();
    }
    // a new action invalidates the redo stack
    this._redoStack = [];
  },
  /**
   * Batches every command tracked between begin and end into ONE undo step
   * (used by the Delete-selection shortcut, so removing N selected layers
   * is undone with a single Ctrl+Z). Batches can nest; only the outermost
   * end closes the group.
   */
  _beginCommandBatch() {
    if (this._undoRedoActive) {
      return;
    }
    this._batchDepth = (this._batchDepth || 0) + 1;
    if (this._batchDepth === 1) {
      this._batchCommands = [];
    }
  },
  _endCommandBatch(type = 'batch') {
    if (!this._batchDepth) {
      return;
    }
    this._batchDepth -= 1;
    if (this._batchDepth > 0) {
      return;
    }
    const commands = this._batchCommands || [];
    this._batchCommands = null;
    if (!commands.length) {
      return;
    }
    if (commands.length === 1) {
      this._pushCommand(commands[0]);
      return;
    }
    this._pushCommand({
      type,
      undo: () => {
        for (let i = commands.length - 1; i >= 0; i -= 1) {
          commands[i].undo();
        }
      },
      redo: () => commands.forEach((command) => command.redo()),
    });
  },
  _containingLayer() {
    return this._getContainingLayer();
  },
  _trackCreate(layer) {
    if (!layer) {
      return;
    }
    this._layerSnapshots.set(layer, this._snapshot(layer));
    this._pushCommand({
      type: 'create',
      undo: () => layer.remove(),
      redo: () => layer.addTo(this._containingLayer()),
    });
  },
  _trackRemove(layer) {
    if (!layer) {
      return;
    }
    // keep the last known geometry so undo restores the layer as it was -
    // relevant when the removal emptied the coordinates first (f.ex. when the
    // last vertices of a layer were removed in edit mode)
    const snapshot = this._layerSnapshots.get(layer);
    this._pushCommand({
      type: 'remove',
      undo: () => {
        layer.addTo(this._containingLayer());
        if (snapshot) {
          this._restore(layer, snapshot);
          this._layerSnapshots.set(layer, snapshot);
        }
      },
      redo: () => layer.remove(),
    });
  },
  _trackBoolean(originalLayers, resultLayer) {
    const originals = (originalLayers || []).filter(Boolean);
    if (!originals.length) {
      return;
    }
    // the result can be a single layer, a LayerGroup or an array of layers
    // (Split produces multiple parts)
    const results =
      resultLayer instanceof L.LayerGroup
        ? resultLayer.getLayers().slice()
        : [].concat(resultLayer || []).filter(Boolean);
    const containingLayer = this._containingLayer();
    this._pushCommand({
      type: 'boolean',
      undo: () => {
        results.forEach((layer) => {
          layer.remove();
        });
        originals.forEach((layer) => {
          // the boolean op flagged the sources as temp layers while they are
          // off the map - restore them as regular layers again, otherwise they
          // stay invisible to findLayers / snapping / global modes
          delete layer._pmTempLayer;
          layer.addTo(containingLayer);
        });
      },
      redo: () => {
        originals.forEach((layer) => {
          layer._pmTempLayer = true;
          layer.remove();
        });
        results.forEach((layer) => {
          layer.addTo(containingLayer);
        });
      },
    });
  },
  /**
   * Called from the central _fireEdit of every layer. Restores the previous
   * snapshot of the geometry when undone.
   */
  _trackEdit(layer) {
    if (!layer || !layer.pm || !layer._map || this._undoRedoActive) {
      return;
    }
    const before = this._layerSnapshots.get(layer);
    const after = this._snapshot(layer);
    if (!before || this._snapshotsEqual(before, after)) {
      if (after) {
        this._layerSnapshots.set(layer, after);
      }
      return;
    }
    this._layerSnapshots.set(layer, after);
    const restore = (snap) => this._restore(layer, snap);
    this._pushCommand({
      type: 'edit',
      undo: () => {
        restore(before);
        this._layerSnapshots.set(layer, before);
      },
      redo: () => {
        restore(after);
        this._layerSnapshots.set(layer, after);
      },
    });
  },

  /**
   * Category changes are undoable: undo re-stamps the previous category
   * (which also restores its style), redo re-applies the new one.
   */
  _trackCategory(layer, oldCategory, category) {
    if (!layer || !layer.pm || typeof layer.pm.setCategory !== 'function') {
      return;
    }
    const set = (name) => {
      if (layer._map) {
        layer.pm.setCategory(name, { silent: true });
      }
    };
    this._pushCommand({
      type: 'category',
      undo: () => set(oldCategory),
      redo: () => set(category),
    });
  },

  // ----- layer snapshots --------------------------------------------------

  _snapshot(layer) {
    if (!layer || !layer.pm) {
      return undefined;
    }
    // L.Circle extends L.CircleMarker - both need their radius tracked,
    // otherwise a radius-only change (no center move) is invisible to undo
    if (layer instanceof L.CircleMarker) {
      return {
        latlng: layer.getLatLng().clone(),
        radius: layer.getRadius(),
      };
    }
    if (layer instanceof L.Marker) {
      return { latlng: layer.getLatLng().clone() };
    }
    if (layer instanceof L.ImageOverlay) {
      // ImageOverlay has no latlng array - the bounds define its geometry
      return { bounds: L.latLngBounds(layer.getBounds()) };
    }
    if (layer.getLatLngs) {
      // large layers (issue #366) render a decimated/culled subset while
      // not being edited - always snapshot the full geometry so undo/redo
      // never regresses a layer's stored coordinates to that subset
      const fullLatLngs =
        typeof this._fullLatLngsOf === 'function'
          ? this._fullLatLngsOf(layer)
          : undefined;
      const snapshot = {
        latlngs: copyLatLngs(layer, fullLatLngs || layer.getLatLngs()),
      };
      // the rotation angle is part of the layer state - otherwise undoing a
      // rotation restores the geometry but keeps the stale angle
      if (typeof layer.pm.getAngle === 'function') {
        snapshot.angle = layer.pm.getAngle();
      }
      return snapshot;
    }
    return undefined;
  },
  _snapshotsEqual(a, b) {
    if (!a || !b) {
      return a === b;
    }
    if (a.radius !== undefined) {
      return (
        a.radius === b.radius &&
        a.latlng.equals(b.latlng) &&
        a.latlng.alt === b.latlng.alt
      );
    }
    if (a.latlng !== undefined) {
      return a.latlng.equals(b.latlng) && a.latlng.alt === b.latlng.alt;
    }
    if (a.bounds !== undefined) {
      return a.bounds.equals(b.bounds);
    }
    if (a.angle !== b.angle) {
      return false;
    }
    return this._latlngsEqual(a.latlngs, b.latlngs);
  },
  _latlngsEqual(a, b) {
    if (!L.Util.isArray(a) || !L.Util.isArray(b)) {
      if (a && b && a.equals && b.equals) {
        return a.equals(b) && a.alt === b.alt;
      }
      return a === b;
    }
    if (a.length !== b.length) {
      return false;
    }
    return a.every((part, i) => this._latlngsEqual(part, b[i]));
  },
  _restore(layer, snap) {
    if (!snap) {
      return;
    }
    if (snap.radius !== undefined && layer.setRadius) {
      layer.setLatLng(snap.latlng);
      layer.setRadius(snap.radius);
    } else if (snap.latlng !== undefined && layer.setLatLng) {
      layer.setLatLng(snap.latlng);
    } else if (snap.bounds !== undefined && layer.setBounds) {
      layer.setBounds(L.latLngBounds(snap.bounds));
    } else if (snap.latlngs !== undefined && layer.setLatLngs) {
      layer.setLatLngs(copyLatLngs(layer, snap.latlngs));
    }
    // restore the rotation state as well, otherwise the next rotation would
    // be calculated from the stale (pre-undo) origin geometry
    if (snap.angle !== undefined && typeof layer.pm._setAngle === 'function') {
      layer.pm._setAngle(snap.angle);
    }
    if (snap.latlngs !== undefined) {
      layer.pm._rotateOrgLatLng = copyLatLngs(layer, snap.latlngs);
      if (layer.pm._rotatePoly) {
        layer.pm._rotatePoly.setLatLngs(copyLatLngs(layer, snap.latlngs));
        if (layer.pm._rotatePoly.pm?.enabled?.()) {
          layer.pm._rotatePoly.pm._initMarkers();
        }
      }
    }
    if (layer.pm && layer.pm.enabled() && layer.pm._initMarkers) {
      layer.pm._initMarkers();
    }
    // scale handles live outside the marker group - refresh their positions
    if (
      typeof layer.pm.scaleEnabled === 'function' &&
      layer.pm.scaleEnabled()
    ) {
      layer.pm._refreshScaleHandles();
    }
    // large-layer rendering: the stored full geometry was replaced
    layer._map?.pm?._onGeometryReplaced?.(layer);
  },
};

export default UndoMixin;
