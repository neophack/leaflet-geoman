import { difference } from '../../helpers/turfHelper';
import {
  isPolygonLayer,
  isRelevantLayer,
  replaceLayersWithGeoJSON,
} from '../../helpers/LayerOps';
import { getTranslation } from '../../helpers';

/**
 * Global Difference Mode.
 * Click the first polygon (base layer), then a second polygon. The second
 * polygon is subtracted from the first one - both original layers are
 * removed and replaced by the single result layer. The base layer is
 * indicated like the click-to-select feature:
 * it keeps its own style, every other layer is dimmed to 40% opacity.
 */
const GlobalDifferenceMode = {
  _globalDifferenceModeEnabled: false,
  _differenceBaseLayer: undefined,
  enableGlobalDifferenceMode() {
    // the union slot is the single visible button of the linked boolean
    // modes - leave union mode before taking the slot over
    if (this.globalUnionModeEnabled && this.globalUnionModeEnabled()) {
      this.disableGlobalUnionMode();
    }
    this._globalDifferenceModeEnabled = true;
    this._differenceBaseLayer = undefined;

    this.map.eachLayer((layer) => {
      this._addDifferenceClickListener(layer);
    });

    if (!this.throttledReInitDifference) {
      this.throttledReInitDifference = L.Util.throttle(
        this.handleLayerAdditionInGlobalDifferenceMode,
        100,
        this
      );
    }
    this._addedLayersDifference = {};
    this.map.on('layeradd', this._layerAddedDifference, this);
    this.map.on('layeradd', this.throttledReInitDifference, this);
    this.map.on('mousemove', this._syncDifferenceTooltip, this);

    this._updateDifferenceTooltip();
    // the union slot carries the toggled state and switches its icon to
    // Subtract; the hidden difference button stays off
    this.Toolbar.toggleButton('differenceMode', false, false);
    this.Toolbar.toggleButton('unionMode', true, false);
    this.Toolbar._updateBooleanFamilyPresentation();
    this._fireGlobalDifferenceModeToggled(true);
  },
  disableGlobalDifferenceMode() {
    this._globalDifferenceModeEnabled = false;
    this._clearDifferenceBase();
    this.map.eachLayer((layer) => {
      layer.off('click', this._handleDifferenceClick, this);
    });

    this.map.off('layeradd', this._layerAddedDifference, this);
    this.map.off('layeradd', this.throttledReInitDifference, this);
    this.map.off('mousemove', this._syncDifferenceTooltip, this);
    this._removeDifferenceTooltip();

    this.Toolbar.toggleButton('differenceMode', false, false);
    this.Toolbar.toggleButton('unionMode', false, false);
    this.Toolbar._updateBooleanFamilyPresentation();
    this._fireGlobalDifferenceModeToggled(false);
  },
  globalDifferenceModeEnabled() {
    return !!this._globalDifferenceModeEnabled;
  },
  toggleGlobalDifferenceMode() {
    if (this.globalDifferenceModeEnabled()) {
      this.disableGlobalDifferenceMode();
    } else {
      this.enableGlobalDifferenceMode();
    }
  },
  _isRelevantForDifference(layer) {
    return isRelevantLayer(layer) && isPolygonLayer(layer);
  },
  _addDifferenceClickListener(layer) {
    if (this._isRelevantForDifference(layer)) {
      layer.on('click', this._handleDifferenceClick, this);
    }
  },
  handleLayerAdditionInGlobalDifferenceMode() {
    const layers = this._addedLayersDifference;
    this._addedLayersDifference = {};
    if (this.globalDifferenceModeEnabled()) {
      for (const id in layers) {
        this._addDifferenceClickListener(layers[id]);
      }
    }
  },
  _layerAddedDifference({ layer }) {
    this._addedLayersDifference[L.stamp(layer)] = layer;
  },
  _clearDifferenceBase() {
    this._restoreLayerDimming();
    this._differenceBaseLayer = undefined;
  },
  // tooltip following the cursor
  _syncDifferenceTooltip(e) {
    if (this._differenceTooltip) {
      this._differenceTooltip.setLatLng(e.latlng);
    }
  },
  _updateDifferenceTooltip() {
    if (!this._differenceTooltip) {
      this._differenceTooltip = L.tooltip(this.map.getCenter(), {
        permanent: true,
        offset: L.point(0, 10),
        direction: 'bottom',
        opacity: 0.8,
      }).addTo(this.map);
    }
    const key = this._differenceBaseLayer
      ? 'tooltips.selectSecondLayerFor'
      : 'tooltips.selectFirstLayerFor';
    this._differenceTooltip.setContent(
      getTranslation(key).replace('{action}', 'difference')
    );
  },
  _removeDifferenceTooltip() {
    if (this._differenceTooltip) {
      this._differenceTooltip.remove();
      this._differenceTooltip = undefined;
    }
  },
  _handleDifferenceClick(e) {
    const layer = e.target;
    if (!this._isRelevantForDifference(layer)) {
      return;
    }

    if (!this._differenceBaseLayer) {
      this._differenceBaseLayer = layer;
      // the selected base keeps its style, everything else is dimmed
      this._dimUnselectedLayers([layer]);
      this._updateDifferenceTooltip();
      return;
    }
    if (layer === this._differenceBaseLayer) {
      this._clearDifferenceBase();
      this._updateDifferenceTooltip();
      return;
    }

    this.difference(this._differenceBaseLayer, layer);
    // the mode stays enabled for the next pair
    this._differenceBaseLayer = undefined;
    this._restoreLayerDimming();
    this._updateDifferenceTooltip();
  },
  /**
   * Subtracts `subtractingLayer` from `baseLayer` and replaces the base layer
   * with the result. Can be called directly: `map.pm.difference(base, cutter)`
   */
  /**
   * Subtracts `subtractingLayer` from `baseLayer`. Both original layers are
   * removed and replaced by the single result layer.
   * Can also be called directly: `map.pm.difference(base, cutter)`
   */
  difference(baseLayer, subtractingLayer) {
    if (!isPolygonLayer(baseLayer) || !isPolygonLayer(subtractingLayer)) {
      return undefined;
    }

    let resultGeoJSON;
    try {
      resultGeoJSON = difference(
        baseLayer.toGeoJSON(15),
        subtractingLayer.toGeoJSON(15)
      );
    } catch (e) {
      console.error(
        'Leaflet-Geoman: difference failed. Polygons with self-intersections are not supported'
      );
      return undefined;
    }

    if (!resultGeoJSON) {
      // the base layer is completely covered -> both layers are consumed
      // and no result remains
      [baseLayer, subtractingLayer].forEach((layer) => {
        layer._pmTempLayer = true;
        layer.remove();
        layer.removeFrom(this.map.pm._getContainingLayer());
      });
      this._fireDifference(null, [baseLayer, subtractingLayer], baseLayer);
      return null;
    }

    const resultingLayer = replaceLayersWithGeoJSON(
      this.map,
      [baseLayer, subtractingLayer],
      resultGeoJSON,
      baseLayer
    );

    this._fireDifference(
      resultingLayer,
      [baseLayer, subtractingLayer],
      baseLayer
    );
    resultingLayer.pm._fireEdit(resultingLayer, 'Difference');

    return resultingLayer;
  },
};
export default GlobalDifferenceMode;
