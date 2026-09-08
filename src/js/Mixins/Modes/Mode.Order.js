/**
 * Bring To Front / Send To Back Mode.
 * While active, clicking a layer moves it to the top / bottom of its pane.
 * Order changes are tracked in the undo history (map.pm.undo() restores
 * the previous stacking).
 */
const GlobalOrderMode = {
  _globalBringToFrontModeEnabled: false,
  _globalSendToBackModeEnabled: false,
  enableGlobalBringToFrontMode() {
    this._globalBringToFrontModeEnabled = true;
    this._toggleOrderModeListeners('bringToFront');
    this.Toolbar.toggleButton(
      'bringToFrontMode',
      this.globalBringToFrontModeEnabled()
    );
    this._fireGlobalBringToFrontModeToggled(true);
  },
  disableGlobalBringToFrontMode() {
    this._globalBringToFrontModeEnabled = false;
    this._toggleOrderModeListeners('bringToFront', false);
    this.Toolbar.toggleButton(
      'bringToFrontMode',
      this.globalBringToFrontModeEnabled()
    );
    this._fireGlobalBringToFrontModeToggled(false);
  },
  globalBringToFrontModeEnabled() {
    return !!this._globalBringToFrontModeEnabled;
  },
  toggleGlobalBringToFrontMode() {
    if (this.globalBringToFrontModeEnabled()) {
      this.disableGlobalBringToFrontMode();
    } else {
      this.enableGlobalBringToFrontMode();
    }
  },
  enableGlobalSendToBackMode() {
    this._globalSendToBackModeEnabled = true;
    this._toggleOrderModeListeners('sendToBack');
    this.Toolbar.toggleButton(
      'sendToBackMode',
      this.globalSendToBackModeEnabled()
    );
    this._fireGlobalSendToBackModeToggled(true);
  },
  disableGlobalSendToBackMode() {
    this._globalSendToBackModeEnabled = false;
    this._toggleOrderModeListeners('sendToBack', false);
    this.Toolbar.toggleButton(
      'sendToBackMode',
      this.globalSendToBackModeEnabled()
    );
    this._fireGlobalSendToBackModeToggled(false);
  },
  globalSendToBackModeEnabled() {
    return !!this._globalSendToBackModeEnabled;
  },
  toggleGlobalSendToBackMode() {
    if (this.globalSendToBackModeEnabled()) {
      this.disableGlobalSendToBackMode();
    } else {
      this.enableGlobalSendToBackMode();
    }
  },
  _isRelevantForOrder(layer) {
    return (
      layer.pm &&
      !(layer instanceof L.LayerGroup) &&
      ((!L.PM.optIn && !layer.options.pmIgnore) ||
        (L.PM.optIn && layer.options.pmIgnore === false)) &&
      !layer._pmTempLayer &&
      typeof layer.bringToFront === 'function'
    );
  },
  _toggleOrderModeListeners(order, enable = true) {
    const handler = this._getOrderHandler(order);
    if (enable) {
      this.map.eachLayer((layer) => {
        if (this._isRelevantForOrder(layer)) {
          layer.on('click', handler);
        }
      });
      if (!this.throttledReInitOrder) {
        this.throttledReInitOrder = L.Util.throttle(
          this.handleLayerAdditionInGlobalOrderMode,
          100,
          this
        );
      }
      this._addedLayersOrder = {};
      this.map.on('layeradd', this._layerAddedOrder, this);
      this.map.on('layeradd', this.throttledReInitOrder, this);
    } else {
      this.map.eachLayer((layer) => {
        layer.off('click', handler);
      });
      this.map.off('layeradd', this._layerAddedOrder, this);
      this.map.off('layeradd', this.throttledReInitOrder, this);
    }
  },
  _getOrderHandler(order) {
    if (order === 'bringToFront') {
      if (!this._bringToFrontHandler) {
        this._bringToFrontHandler = this._handleOrderClick.bind(
          this,
          'bringToFront'
        );
      }
      return this._bringToFrontHandler;
    }
    if (!this._sendToBackHandler) {
      this._sendToBackHandler = this._handleOrderClick.bind(this, 'sendToBack');
    }
    return this._sendToBackHandler;
  },
  handleLayerAdditionInGlobalOrderMode() {
    const layers = this._addedLayersOrder;
    this._addedLayersOrder = {};
    for (const id in layers) {
      const layer = layers[id];
      if (this._isRelevantForOrder(layer)) {
        if (this.globalBringToFrontModeEnabled()) {
          layer.on('click', this._getOrderHandler('bringToFront'));
        }
        if (this.globalSendToBackModeEnabled()) {
          layer.on('click', this._getOrderHandler('sendToBack'));
        }
      }
    }
  },
  _layerAddedOrder({ layer }) {
    this._addedLayersOrder[L.stamp(layer)] = layer;
  },
  /**
   * Captures the visual stacking of the layers, grouped by their renderer
   * container (SVG paths and marker icons live in different panes - stacking
   * is only comparable within one container). Returns
   * [{ elements: [layers bottom -> top] }, ...] or null when the order of a
   * layer cannot be determined (f.ex. canvas renderer, detached DOM).
   */
  _captureStackGroups(layers) {
    const groups = [];
    const byParent = new Map();
    for (const layer of layers) {
      const element = layer._path || layer._icon;
      if (!element || !element.parentNode) {
        return null;
      }
      let group = byParent.get(element.parentNode);
      if (!group) {
        group = [];
        byParent.set(element.parentNode, group);
        groups.push(group);
      }
      group.push(layer);
    }
    for (const group of groups) {
      group.sort((a, b) => {
        const mask = (a._path || a._icon).compareDocumentPosition(
          b._path || b._icon
        );
        // DOCUMENT_POSITION_FOLLOWING: b comes after a -> a is below b
        return mask & window.Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
    }
    return groups;
  },
  _handleOrderClick(order, e) {
    const layer = e.target;
    if (!this._isRelevantForOrder(layer)) {
      return;
    }
    const relevant = L.PM.Utils.findLayers(this.map).filter((l) =>
      this._isRelevantForOrder(l)
    );
    // stacking before the change, for the undo command
    const groupsBefore = this._captureStackGroups(relevant);
    let isNoOp = false;
    if (groupsBefore) {
      const ownGroup = groupsBefore.find((g) => g.includes(layer));
      if (ownGroup) {
        isNoOp =
          order === 'bringToFront'
            ? ownGroup[ownGroup.length - 1] === layer
            : ownGroup[0] === layer;
      }
    }

    if (order === 'bringToFront') {
      layer.bringToFront();
    } else {
      layer.bringToBack();
    }
    this._fireOrderChange(layer, order);

    // order changes are undoable - undo restores the previous stacking
    // (bringToFront bottom -> top reproduces the captured order)
    if (!isNoOp && groupsBefore && typeof this._pushCommand === 'function') {
      const stackBefore = groupsBefore.flat();
      this._pushCommand({
        type: 'order',
        undo: () => {
          stackBefore.forEach((l) => {
            if (l._map) {
              l.bringToFront();
            }
          });
        },
        redo: () => {
          if (layer._map) {
            if (order === 'bringToFront') {
              layer.bringToFront();
            } else {
              layer.bringToBack();
            }
          }
        },
      });
    }
  },
};
export default GlobalOrderMode;
