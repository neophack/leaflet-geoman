const GlobalScaleMode = {
  _globalScaleModeEnabled: false,
  enableGlobalScaleMode() {
    this._globalScaleModeEnabled = true;
    const layers = L.PM.Utils.findLayers(this.map).filter(
      (l) => l instanceof L.Polyline || l instanceof L.Circle
    );
    layers.forEach((layer) => {
      if (this._isRelevantForScale(layer)) {
        layer.pm.enableScale();
      }
    });

    if (!this.throttledReInitScale) {
      this.throttledReInitScale = L.Util.throttle(
        this.handleLayerAdditionInGlobalScaleMode,
        100,
        this
      );
    }

    this._addedLayersScale = {};
    this.map.on('layeradd', this._layerAddedScale, this);
    this.map.on('layeradd', this.throttledReInitScale, this);

    this.Toolbar.toggleButton('scaleMode', this.globalScaleModeEnabled());
    this._fireGlobalScaleModeToggled();
  },
  disableGlobalScaleMode() {
    this._globalScaleModeEnabled = false;
    const layers = L.PM.Utils.findLayers(this.map).filter(
      (l) => l instanceof L.Polyline || l instanceof L.Circle
    );
    layers.forEach((layer) => {
      layer.pm.disableScale();
    });

    this.map.off('layeradd', this._layerAddedScale, this);
    this.map.off('layeradd', this.throttledReInitScale, this);

    this.Toolbar.toggleButton('scaleMode', this.globalScaleModeEnabled());
    this._fireGlobalScaleModeToggled();
  },
  globalScaleModeEnabled() {
    return !!this._globalScaleModeEnabled;
  },
  toggleGlobalScaleMode() {
    if (this.globalScaleModeEnabled()) {
      this.disableGlobalScaleMode();
    } else {
      this.enableGlobalScaleMode();
    }
  },
  /**
   * Reverts the layers to the state before changing. The mode itself stays
   * enabled.
   */
  cancelGlobalScaleMode() {
    L.PM.Utils.findLayers(this.map).forEach((layer) => {
      if (layer.pm && layer.pm.scaleEnabled && layer.pm.scaleEnabled()) {
        layer.pm.cancel();
      }
    });
    this.__fire(this.map, 'pm:globalcancel', { map: this.map }, 'Scale');
  },
  _isRelevantForScale(layer) {
    return (
      layer.pm &&
      !(layer instanceof L.LayerGroup) &&
      ((!L.PM.optIn && !layer.options.pmIgnore) ||
        (L.PM.optIn && layer.options.pmIgnore === false)) &&
      !layer._pmTempLayer &&
      layer.pm.options.allowScaling
    );
  },
  handleLayerAdditionInGlobalScaleMode() {
    const layers = this._addedLayersScale;
    this._addedLayersScale = {};
    if (this.globalScaleModeEnabled()) {
      for (const id in layers) {
        const layer = layers[id];
        if (this._isRelevantForScale(layer)) {
          layer.pm.enableScale();
        }
      }
    }
  },
  _layerAddedScale({ layer }) {
    this._addedLayersScale[L.stamp(layer)] = layer;
  },
};
export default GlobalScaleMode;
