/**
 * Selection Mixin: click a Geoman-tracked layer to select it. The highlight
 * style is set by the `selectionEffect` global option:
 *   'dim' (default) - every other tracked layer fades to 40% opacity while
 *                     the selected layers keep their own style
 *   'outline'       - a black RECTANGLE is drawn around the bounds of each
 *                     selected shape (no stroke on the shape itself) and
 *                     nothing is dimmed. The frame's line style is set by
 *                     the `selectionOutlineStyle` global option:
 *                     'solid' (default) or 'dashed'
 * Clicking empty map space (or calling layer.pm.unselect() /
 * map.pm.unselectAll()) clears the selection again.
 *
 * The selection is multi-capable (Lasso selects several layers at once):
 * the state is an array, `getSelectedLayers()` returns it and
 * `getSelectedLayer()` the first entry (single-selection compat view).
 *
 * Layer clicks only select while no other global mode (Draw/Edit/Drag/
 * Cut/Union/...) is active, since those modes already give a layer click a
 * different meaning (f.ex. stamping a category, or finishing a boolean op).
 * Disable the feature entirely via
 * map.pm.setGlobalOptions({ selectableLayers: false }).
 *
 * API:
 *   layer.pm.select() / layer.pm.unselect() / layer.pm.isSelected()
 *   map.pm.getSelectedLayer() / map.pm.getSelectedLayers() /
 *   map.pm.unselectAll() / map.pm.removeSelectedLayers()
 *   map.pm.enableSelectionTool() /
 *   map.pm.disableSelectionTool() / map.pm.selectionToolEnabled() /
 *   map.pm.addSelection(layer) / map.pm.removeSelection(layer) /
 *   map.pm.isLayerSelected(layer) / map.pm.cleanupSelection()
 *
 * Events: pm:selectionadd / pm:selectionremove (fired on both the layer
 * and the map)
 */
const SelectionMixin = {
  _initSelection() {
    this._selectedLayers = [];

    // clicking empty map space deselects. Clicks on a Geoman layer are
    // marked by the layer's selection handler (Edit.js#_onSelectionDomClick)
    // and don't clear the selection - the event still propagates so user
    // listeners and mode handlers keep working
    this.map.on('click', (e) => {
      if (
        !this.globalOptions.selectableLayers ||
        this._isAnyGlobalModeActive() ||
        (e.originalEvent && e.originalEvent._pmLayerClick)
      ) {
        return;
      }
      this.unselectAll();
    });

    // dropping a selected layer off the map (Removal mode, undo, a plain
    // removeLayer() call) should shrink the selection instead of leaving
    // every other layer dimmed forever
    this.map.on('layerremove', (e) => {
      if (this._selectedLayers.includes(e.layer)) {
        this._removeSelectedLayer(e.layer);
      }
    });

    // outline rectangles must follow geometry edits of the selected layers
    // (vertex drag, rotation, scale - all fire pm:edit on the map) and zooms
    // (CircleMarker bounds are pixel-based and change with the zoom level)
    this.map.on('pm:edit', () => this._refreshSelectionOutlines());
    this.map.on('zoomend', () => this._refreshSelectionOutlines());
  },

  _isAnyGlobalModeActive() {
    return (
      this.globalDrawModeEnabled() ||
      this.globalEditModeEnabled() ||
      this.globalDragModeEnabled() ||
      this.globalRemovalModeEnabled() ||
      this.globalCutModeEnabled() ||
      this.globalRotateModeEnabled() ||
      this.globalScaleModeEnabled() ||
      this.globalUnionModeEnabled() ||
      this.globalDifferenceModeEnabled() ||
      this.globalLineSimplificationModeEnabled() ||
      this.globalCopyLayerModeEnabled() ||
      this.globalBringToFrontModeEnabled() ||
      this.globalSendToBackModeEnabled() ||
      this.globalLassoModeEnabled()
    );
  },

  // single-selection view of the multi-selection state (first entry)
  getSelectedLayer() {
    return this._selectedLayers[0] || null;
  },

  getSelectedLayers() {
    return this._selectedLayers.slice();
  },

  unselectAll() {
    this._setSelectedLayers([]);
  },

  /**
   * `enableSelectionTool()` /
   * `disableSelectionTool()` toggle the click-to-select feature (the
   * `selectableLayers` global option). An optional filter function
   * restricts which layers may enter the selection.
   */
  enableSelectionTool(filterFnc) {
    this._selectionFilter =
      typeof filterFnc === 'function' ? filterFnc : undefined;
    this.setGlobalOptions({ selectableLayers: true });
  },
  disableSelectionTool() {
    this._selectionFilter = undefined;
    this.setGlobalOptions({ selectableLayers: false });
  },
  selectionToolEnabled() {
    return !!this.globalOptions.selectableLayers;
  },
  /** Adds a layer to the selection. */
  addSelection(layer) {
    if (!layer || this._selectedLayers.includes(layer)) {
      return;
    }
    this._setSelectedLayers(this._selectedLayers.concat(layer));
  },
  /** Removes a layer from the selection. */
  removeSelection(layer) {
    if (!layer || !this._selectedLayers.includes(layer)) {
      return;
    }
    this._setSelectedLayers(this._selectedLayers.filter((l) => l !== layer));
  },
  /** Returns if the layer is selected. */
  isLayerSelected(layer) {
    return this._selectedLayers.includes(layer);
  },
  /** Deselects every selected layer. */
  cleanupSelection() {
    this.unselectAll();
  },

  // internal: the only place selection state actually changes - layer.pm
  // .select()/.unselect() and the lasso all delegate here so dimming stays
  // in sync
  _setSelectedLayer(layer) {
    this._setSelectedLayers(layer ? [layer] : []);
  },
  _setSelectedLayers(layers = []) {
    const next = layers
      .filter(Boolean)
      .filter(
        (layer) =>
          !this._selectionFilter || !layer.pm || this._selectionFilter(layer)
      );
    const prev = this._selectedLayers;
    const prevSet = new Set(prev);
    const nextSet = new Set(next);
    const sameSet =
      prev.length === next.length && next.every((layer) => prevSet.has(layer));
    if (sameSet) {
      return;
    }

    prev.forEach((layer) => {
      if (layer.pm) {
        layer.pm._selected = false;
      }
      if (!nextSet.has(layer)) {
        this._fireSelectionEvent(layer, false);
      }
    });

    this._selectedLayers = next;
    this._applySelectionEffect();

    next.forEach((layer) => {
      if (layer.pm) {
        layer.pm._selected = true;
      }
      if (!prevSet.has(layer)) {
        this._fireSelectionEvent(layer, true);
      }
    });
  },
  /**
   * Applies the configured highlight to the current selection
   * (`selectionEffect` global option, default 'dim'):
   *   'dim'     - selected layers keep their style, every other Geoman layer
   *               fades to 40% opacity
   *   'outline' - a black rectangle is drawn around the bounds of each
   *               selected shape, nothing is dimmed
   * Runs on every selection change, when the option is switched and after
   * geometry edits of the selected layers.
   */
  _applySelectionEffect() {
    // dashed frames (markers get a CSS outline, so their line style lives
    // in layers.css behind this class) follow the selectionOutlineStyle
    // option. The browser focus ring is never shown - layers.css suppresses
    // it in every mode, the black frame is the only selection indicator
    this.map
      .getContainer()
      .classList.toggle(
        'pm-selection-outline-dashed',
        this.globalOptions.selectionEffect === 'outline' &&
          this._selectionOutlineDashed()
      );

    // clear both effects first
    this.getGeomanLayers().forEach((l) => this._dimLayer(l, false));
    this._removeSelectionOutlines();

    const selected = this._selectedLayers;
    if (!selected || !selected.length) {
      return;
    }
    if (this.globalOptions.selectionEffect === 'outline') {
      selected.forEach((layer) => this._addSelectionOutline(layer));
      return;
    }
    const set = new Set(selected);
    this.getGeomanLayers().forEach((l) => {
      if (!set.has(l)) {
        this._dimLayer(l, true);
      }
    });
  },
  // outline rectangles must follow geometry edits of the selected layers
  _refreshSelectionOutlines() {
    if (
      this.globalOptions.selectionEffect !== 'outline' ||
      !this._selectedLayers ||
      !this._selectedLayers.length
    ) {
      return;
    }
    this._removeSelectionOutlines();
    this._selectedLayers.forEach((layer) => this._addSelectionOutline(layer));
  },
  // every selected shape gets a black RECTANGLE around its bounds - never a
  // stroke tracing the shape's own outline. Layers without bounds (Marker)
  // get the same rectangular frame as a CSS outline on their element, except
  // text markers: their icon element is a 0x0 box (.pm-text-marker) that the
  // textarea overflows, so a CSS outline on it collapses to a dot at the
  // anchor - they get a rectangle measured around the visible label instead.
  _addSelectionOutline(layer) {
    this._ensureSelectionPane();

    const bounds =
      typeof layer.getBounds === 'function' ? layer.getBounds() : null;
    if (bounds && bounds.isValid()) {
      this._addSelectionOutlineRect(bounds);
      return;
    }

    // Text marker: the frame wraps the textarea (the visible label box).
    // The outline pane renders BELOW the marker pane, so grow the box by
    // 1px - a stroke drawn exactly at the label edge would lose its inner
    // half under the label's white background.
    if (layer.pm && layer.pm.textArea) {
      const mapRect = this.map.getContainer().getBoundingClientRect();
      const box = layer.pm.textArea.getBoundingClientRect();
      if (box.width && box.height) {
        this._addSelectionOutlineRect(
          L.latLngBounds(
            this.map.containerPointToLatLng(
              L.point(box.left - mapRect.left - 1, box.top - mapRect.top - 1)
            ),
            this.map.containerPointToLatLng(
              L.point(
                box.right - mapRect.left + 1,
                box.bottom - mapRect.top + 1
              )
            )
          )
        );
      }
      return;
    }

    // Marker: black rectangular frame directly on its element
    const el =
      typeof layer.getElement === 'function' ? layer.getElement() : null;
    if (el) {
      el.classList.add('pm-selection-outline-element');
      (this._selectionOutlineElements =
        this._selectionOutlineElements || []).push(el);
    }
  },
  // line style of the 'outline' selection frames: only 'dashed' dashes,
  // every other value (including the default 'solid') stays solid
  _selectionOutlineDashed() {
    return this.globalOptions.selectionOutlineStyle === 'dashed';
  },
  _addSelectionOutlineRect(bounds) {
    const outline = L.rectangle(bounds, {
      color: '#000000',
      fill: false,
      weight: 2,
      dashArray: this._selectionOutlineDashed() ? '8,6' : undefined,
      interactive: false,
      pmIgnore: true,
      snapIgnore: true,
      pane: 'pmSelectionOutline',
      className: 'pm-selection-outline',
    });
    outline._pmTempLayer = true;
    outline.addTo(this.map);
    (this._selectionOutlines = this._selectionOutlines || []).push(outline);
  },
  _removeSelectionOutlines() {
    (this._selectionOutlines || []).forEach((outline) => outline.remove());
    this._selectionOutlines = [];
    (this._selectionOutlineElements || []).forEach((el) =>
      el.classList.remove('pm-selection-outline-element')
    );
    this._selectionOutlineElements = [];
  },
  _ensureSelectionPane() {
    if (this.map.getPane('pmSelectionOutline')) {
      return;
    }
    const pane = this.map.createPane('pmSelectionOutline');
    // ABOVE the overlay pane (450 > 400): the frame must render on top of
    // the shapes - below them a bounds-matching shape (e.g. a rectangle)
    // would cover the frame completely
    pane.style.zIndex = 450;
    pane.style.pointerEvents = 'none';
  },
  _removeSelectedLayer(layer) {
    if (!this._selectedLayers.includes(layer)) {
      return;
    }
    this._setSelectedLayers(this._selectedLayers.filter((l) => l !== layer));
  },
  /**
   * Removes every selected layer in one go (Delete/Backspace shortcut).
   * Uses the same removal semantics as the Removal mode (allowRemoval,
   * pm:remove events) and wraps the removals in an undo batch, so the whole
   * multi-delete is undone by a single Ctrl+Z. The selection clears itself
   * through the layerremove listener.
   */
  removeSelectedLayers() {
    const layers = this.getSelectedLayers();
    if (!layers.length) {
      return false;
    }
    this._beginCommandBatch();
    try {
      layers.forEach((layer) => {
        const removeable =
          this._isRelevantForRemoval && this._isRelevantForRemoval(layer);
        if (!removeable) {
          return;
        }
        layer.removeFrom(this._getContainingLayer());
        layer.remove();
        layer.pm._fireRemove(layer);
        layer.pm._fireRemove(this.map, layer);
      });
    } finally {
      this._endCommandBatch('remove');
    }
    return true;
  },

  // dims (or restores) one layer by driving its own opacity API, so it
  // works the same for vector layers (setStyle) and markers/overlays
  // (setOpacity) without touching DOM elements directly
  _dimLayer(layer, dimmed) {
    if (layer instanceof L.Path) {
      if (dimmed) {
        if (!layer._pmSelectionBaseStyle) {
          layer._pmSelectionBaseStyle = {
            opacity: layer.options.opacity ?? 1,
            fillOpacity: layer.options.fillOpacity ?? 0.2,
          };
        }
        layer.setStyle({
          opacity: layer._pmSelectionBaseStyle.opacity * 0.4,
          fillOpacity: layer._pmSelectionBaseStyle.fillOpacity * 0.4,
        });
      } else if (layer._pmSelectionBaseStyle) {
        layer.setStyle(layer._pmSelectionBaseStyle);
        delete layer._pmSelectionBaseStyle;
      }
    } else if (typeof layer.setOpacity === 'function') {
      if (dimmed) {
        if (layer._pmSelectionBaseOpacity === undefined) {
          layer._pmSelectionBaseOpacity = layer.options.opacity ?? 1;
        }
        layer.setOpacity(layer._pmSelectionBaseOpacity * 0.4);
      } else if (layer._pmSelectionBaseOpacity !== undefined) {
        layer.setOpacity(layer._pmSelectionBaseOpacity);
        delete layer._pmSelectionBaseOpacity;
      }
    }
  },

  _fireSelectionEvent(layer, selected) {
    const type = selected ? 'pm:selectionadd' : 'pm:selectionremove';
    this.__fire(layer, type, { layer, map: this.map }, 'Selection');
    this.__fire(this.map, type, { layer, map: this.map }, 'Selection');
  },

  /**
   * Boolean modes (union / difference) indicate their selection the same
   * way as the click-to-select feature: the selected layers keep their own
   * style (no highlight layer on top - it interfered with the operations),
   * every other Geoman layer is dimmed to 40% opacity.
   */
  _dimUnselectedLayers(selectedLayers) {
    const selected = new Set(selectedLayers);
    this.getGeomanLayers().forEach((layer) => {
      this._dimLayer(layer, !selected.has(layer));
    });
  },
  // restores the opacity of every layer dimmed by _dimUnselectedLayers
  _restoreLayerDimming() {
    this.getGeomanLayers().forEach((layer) => this._dimLayer(layer, false));
  },
};

export default SelectionMixin;
