/**
 * Copy Layer Mode.
 * Click a layer to create a duplicate next to it (offset by 15px).
 */
const GlobalCopyLayerMode = {
  _globalCopyLayerModeEnabled: false,
  enableGlobalCopyLayerMode() {
    this._globalCopyLayerModeEnabled = true;

    this.map.eachLayer((layer) => {
      this._addCopyClickListener(layer);
    });

    if (!this.throttledReInitCopy) {
      this.throttledReInitCopy = L.Util.throttle(
        this.handleLayerAdditionInGlobalCopyLayerMode,
        100,
        this
      );
    }
    this._addedLayersCopy = {};
    this.map.on('layeradd', this._layerAddedCopy, this);
    this.map.on('layeradd', this.throttledReInitCopy, this);

    this.Toolbar.toggleButton(
      'copyLayerMode',
      this.globalCopyLayerModeEnabled()
    );
    this._fireGlobalCopyLayerModeToggled(true);
  },
  disableGlobalCopyLayerMode() {
    this._globalCopyLayerModeEnabled = false;
    this.map.eachLayer((layer) => {
      layer.off('click', this._handleCopyClick, this);
    });

    this.map.off('layeradd', this._layerAddedCopy, this);
    this.map.off('layeradd', this.throttledReInitCopy, this);

    this.Toolbar.toggleButton(
      'copyLayerMode',
      this.globalCopyLayerModeEnabled()
    );
    this._fireGlobalCopyLayerModeToggled(false);
  },
  globalCopyLayerModeEnabled() {
    return !!this._globalCopyLayerModeEnabled;
  },
  toggleGlobalCopyLayerMode() {
    if (this.globalCopyLayerModeEnabled()) {
      this.disableGlobalCopyLayerMode();
    } else {
      this.enableGlobalCopyLayerMode();
    }
  },
  /**
   * Resets the internal state of the mode (the registered layer listeners)
   * without toggling it - `map.pm.resetCopyLayerMode()`.
   */
  resetCopyLayerMode() {
    if (!this.globalCopyLayerModeEnabled()) {
      return;
    }
    this.map.eachLayer((layer) => {
      layer.off('click', this._handleCopyClick, this);
    });
    this.map.eachLayer((layer) => {
      this._addCopyClickListener(layer);
    });
  },
  _isRelevantForCopy(layer) {
    return (
      layer.pm &&
      !(layer instanceof L.LayerGroup) &&
      ((!L.PM.optIn && !layer.options.pmIgnore) ||
        (L.PM.optIn && layer.options.pmIgnore === false)) &&
      !layer._pmTempLayer
    );
  },
  _addCopyClickListener(layer) {
    if (this._isRelevantForCopy(layer)) {
      layer.on('click', this._handleCopyClick, this);
    }
  },
  handleLayerAdditionInGlobalCopyLayerMode() {
    const layers = this._addedLayersCopy;
    this._addedLayersCopy = {};
    if (this.globalCopyLayerModeEnabled()) {
      for (const id in layers) {
        this._addCopyClickListener(layers[id]);
      }
    }
  },
  _layerAddedCopy({ layer }) {
    this._addedLayersCopy[L.stamp(layer)] = layer;
  },
  _handleCopyClick(e) {
    const layer = e.target;
    if (this._isRelevantForCopy(layer)) {
      this.copyLayer(layer);
    }
  },
  /**
   * Creates a copy of the layer with a small offset.
   * Can also be called directly: `map.pm.copyLayer(layer)`
   */
  copyLayer(layer) {
    const map = this.map || layer._map;
    let copy;

    // large layers are rendered with a subset -> copy the full coordinates
    // (lazy: only polyline based layers have latlng arrays)
    const getPolySource = () =>
      map.pm?._fullLatLngsOf?.(layer) || layer.getLatLngs();

    if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) {
      if (layer.options.textMarker) {
        // Text layers embed their <textarea> DOM node in the divIcon - reusing
        // the icon would MOVE the node to the copy and leave the original
        // empty. Passing `textMarker: true` lets the pm init hook create a
        // fresh textarea + icon; the text is restored from options.text on add.
        const text =
          typeof layer.pm.getText === 'function'
            ? layer.pm.getText()
            : layer.options.text;
        copy = L.marker(layer.getLatLng(), {
          textMarker: true,
          icon: layer.options.icon,
          text: text || undefined,
        });
      } else {
        copy = L.marker(layer.getLatLng(), { icon: layer.options.icon });
      }
    } else if (layer instanceof L.Circle) {
      // L.Circle extends L.CircleMarker, so this check must come first -
      // otherwise a real Circle (meter radius) would be copied as a
      // CircleMarker (pixel radius), changing its size.
      copy = L.circle(
        layer.getLatLng(),
        L.Util.extend({}, layer.options, { radius: layer.getRadius() })
      );
    } else if (layer instanceof L.CircleMarker) {
      copy = L.circleMarker(
        layer.getLatLng(),
        L.Util.extend({}, layer.options)
      );
      copy.setRadius(layer.getRadius());
    } else if (layer instanceof L.Polygon) {
      copy = L.polygon(getPolySource(), L.Util.extend({}, layer.options));
    } else if (layer instanceof L.Polyline) {
      copy = L.polyline(getPolySource(), L.Util.extend({}, layer.options));
    } else if (layer instanceof L.ImageOverlay) {
      copy = L.imageOverlay(
        layer._url,
        layer.getBounds(),
        L.Util.extend({}, layer.options)
      );
    } else {
      return undefined;
    }

    // offset the copy by 15px to the bottom right
    const center =
      copy.getLatLng && !(copy instanceof L.Polygon)
        ? copy.getLatLng()
        : copy.getBounds().getCenter();
    const offsetPoint = map.latLngToContainerPoint(center).add([15, 15]);
    const offsetLatLng = map.containerPointToLatLng(offsetPoint);

    if (copy.getLatLng && !(copy instanceof L.Polygon)) {
      copy.setLatLng(offsetLatLng);
    } else if (copy instanceof L.ImageOverlay) {
      const dLat = offsetLatLng.lat - center.lat;
      const dLng = offsetLatLng.lng - center.lng;
      const bounds = copy.getBounds();
      copy.setBounds(
        L.latLngBounds(
          [bounds.getSouth() + dLat, bounds.getWest() + dLng],
          [bounds.getNorth() + dLat, bounds.getEast() + dLng]
        )
      );
    } else {
      const dLat = offsetLatLng.lat - center.lat;
      const dLng = offsetLatLng.lng - center.lng;
      const moveLatLng = (latlngs) =>
        latlngs.map((part) =>
          L.Util.isArray(part)
            ? moveLatLng(part)
            : L.latLng(part.lat + dLat, part.lng + dLng)
        );
      copy.setLatLngs(moveLatLng(copy.getLatLngs()));
    }

    const panes = map.pm.globalOptions.panes;
    copy.options.pane = (panes && panes.layerPane) || 'overlayPane';
    copy.addTo(map.pm._getContainingLayer());
    copy.pm.enable(layer.pm.options);
    copy.pm.disable();
    copy._drawnByGeoman = true;

    // the copy keeps the category of the source layer
    if (typeof layer.pm.getCategory === 'function' && layer.pm.getCategory()) {
      copy.pm.setCategory(layer.pm.getCategory(), { silent: true });
    }

    const shape =
      layer.pm && typeof layer.pm.getShape === 'function'
        ? layer.pm.getShape()
        : undefined;
    this._fireCopyLayer(copy, layer, shape);
    // same payload as the Draw _fireCreate, but fired from the map context
    this.__fire(this.map, 'pm:create', { shape: 'Copy', layer: copy }, 'Copy');

    return copy;
  },
};
export default GlobalCopyLayerMode;
