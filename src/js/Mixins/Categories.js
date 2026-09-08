/**
 * Categories Mixin: assigns a category (f.ex. "river", "house") to layers.
 * Set the active category before drawing and every new layer is stamped with
 * it. Categories can carry a style that is applied to their layers.
 *
 * GeoJSON has no native "category" field, so `layer.pm.setCategory()` mirrors
 * it onto `layer.feature.properties.pmCategory` - `layer.toGeoJSON()` then
 * includes it automatically, and loading it back (f.ex. via `L.geoJSON(data)`)
 * restores it without an explicit `setCategory()` call, since `getCategory()`
 * reads that property on first access.
 *
 * API:
 *   map.pm.setActiveCategory('river') / getActiveCategory() / clearActiveCategory()
 *   map.pm.setCategory('river', { pathOptions: { color: '#3388ff' } })
 *   map.pm.getCategories() / removeCategory('river')
 *   map.pm.getLayersByCategory('river')
 *   layer.pm.getCategory() / layer.pm.setCategory('house')
 *
 * Events: pm:categorychange (layer & map), pm:activecategorychange (map)
 *
 * Ctrl/Cmd+click an existing layer (see Edit.js#_initSelectionClick) to
 * stamp it with the active category too, restyling it in place - the only
 * way to (re)categorize a layer that already exists without redrawing it.
 */
const CategoriesMixin = {
  _initCategories() {
    this._categories = {};
    this._activeCategory = undefined;

    // stamp every created layer with the active category (or the category
    // passed to the draw instance via `enable({ category: '...' })`)
    this.map.on('pm:create', ({ layer }) => {
      if (!layer || !layer.pm || typeof layer.pm.setCategory !== 'function') {
        return;
      }
      if (layer.pm.getCategory()) {
        return; // already stamped (f.ex. by the copy mode)
      }
      const activeShape = this.Draw.getActiveShape();
      const drawCategory =
        activeShape && this.Draw[activeShape]
          ? this.Draw[activeShape].options.category
          : undefined;
      const category = drawCategory || this._activeCategory;
      if (category) {
        // silent: the stamp is part of the layer creation, not a separate
        // user action - it must not become its own undo step (undo removes
        // the whole layer), same as the boolean-op category propagation
        layer.pm.setCategory(category, { silent: true });
      }
    });

    // Union/Difference/Split don't fire pm:create, so their result layer(s)
    // never reach the handler above - propagate the source category(ies)
    // here instead, otherwise a merged/split layer silently loses it
    this.map.on('pm:union', ({ resultLayer, mergedLayers }) => {
      this._propagateCategory(resultLayer, mergedLayers);
    });
    this.map.on('pm:difference', ({ resultLayer, originalLayer }) => {
      // only the base layer's geometry survives the subtraction, so only
      // its category is propagated
      this._propagateCategory(resultLayer, [originalLayer]);
    });
    this.map.on('pm:split', ({ layers, originalLayer }) => {
      layers.forEach((layer) =>
        this._propagateCategory(layer, [originalLayer])
      );
    });
    this.map.on('pm:cut', ({ layer, originalLayer }) => {
      this._propagateCategory(layer, [originalLayer]);
    });
  },
  /**
   * Stamps `resultLayer` (or every sub-layer, if it's a LayerGroup produced
   * by a boolean op) with the category shared by all `sourceLayers`. Layers
   * from sources with different (or no) categories are left uncategorized -
   * there is no single correct category to guess for them.
   */
  _propagateCategory(resultLayer, sourceLayers) {
    if (!resultLayer || !sourceLayers || !sourceLayers.length) {
      return;
    }
    // every source must share the same category - a source without a
    // category counts as "different" (per the contract above)
    const categories = sourceLayers.map((l) =>
      l && l.pm && typeof l.pm.getCategory === 'function'
        ? l.pm.getCategory()
        : undefined
    );
    const [category, ...rest] = categories;
    if (!category || !rest.every((c) => c === category)) {
      return;
    }
    const stamp = (layer) => {
      if (layer && layer.pm && typeof layer.pm.setCategory === 'function') {
        layer.pm.setCategory(category, { silent: true });
      }
    };
    if (resultLayer instanceof L.LayerGroup) {
      resultLayer.eachLayer(stamp);
    } else {
      stamp(resultLayer);
    }
  },
  /**
   * Registers (or updates) a category. `options.pathOptions` are applied to
   * all layers of the category.
   */
  setCategory(name, options = {}) {
    this._categories[name] = {
      pathOptions: options.pathOptions || {},
    };
    // restyle existing layers of this category
    this.getLayersByCategory(name).forEach((layer) => {
      this._applyCategoryStyle(layer, name);
    });
    return this._categories[name];
  },
  getCategories() {
    return this._categories;
  },
  removeCategory(name) {
    delete this._categories[name];
    if (this._activeCategory === name) {
      this.clearActiveCategory();
    }
  },
  /**
   * The category assigned to layers drawn afterwards.
   * Pass `undefined` / `null` to clear.
   */
  setActiveCategory(name) {
    const old = this._activeCategory;
    this._activeCategory = name || undefined;
    if (old !== this._activeCategory) {
      this._fireActiveCategoryChange(old, this._activeCategory);
    }
  },
  getActiveCategory() {
    return this._activeCategory;
  },
  clearActiveCategory() {
    this.setActiveCategory(undefined);
  },
  getLayersByCategory(name) {
    return L.PM.Utils.findLayers(this.map).filter(
      (layer) =>
        layer.pm &&
        typeof layer.pm.getCategory === 'function' &&
        layer.pm.getCategory() === name
    );
  },
  _applyCategoryStyle(layer, name) {
    const category = this._categories[name];
    if (!category || layer._pmTempLayer) {
      return;
    }
    const pathOptions = category.pathOptions;
    if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) {
      // icons are not styled through path options
      return;
    }
    if (typeof layer.setStyle === 'function') {
      layer.setStyle(pathOptions);
    }
  },
  _fireActiveCategoryChange(oldCategory, category) {
    this.__fire(
      this.map,
      'pm:activecategorychange',
      { oldCategory, category, map: this.map },
      'Categories'
    );
  },
};

export default CategoriesMixin;
