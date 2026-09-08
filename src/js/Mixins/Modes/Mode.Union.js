import { union } from '../../helpers/turfHelper';
import {
  isPolygonLayer,
  isRelevantLayer,
  replaceLayersWithGeoJSON,
} from '../../helpers/LayerOps';
import { getTranslation } from '../../helpers';

/**
 * Global Union Mode.
 * Click two polygon layers - the union executes automatically as soon as
 * exactly two layers are selected and the mode stays enabled for the next
 * pair. A tooltip following the cursor asks for the first / second layer.
 * The selected layers keep their own style, every other layer is dimmed
 * to 40% opacity. `map.pm.union(layer1, layer2)` stays available as a
 * programmatic merge (an array of layers is accepted too).
 */
const GlobalUnionMode = {
  _globalUnionModeEnabled: false,
  _unionSelection: [],
  enableGlobalUnionMode() {
    // the union slot is shared with difference mode:
    // restore its Union presentation before enabling union
    if (
      this.globalDifferenceModeEnabled &&
      this.globalDifferenceModeEnabled()
    ) {
      this.disableGlobalDifferenceMode();
    }
    this._globalUnionModeEnabled = true;
    this._unionSelection = [];

    this.map.eachLayer((layer) => {
      this._addUnionClickListener(layer);
    });

    if (!this.throttledReInitUnion) {
      this.throttledReInitUnion = L.Util.throttle(
        this.handleLayerAdditionInGlobalUnionMode,
        100,
        this
      );
    }
    this._addedLayersUnion = {};
    this.map.on('layeradd', this._layerAddedUnion, this);
    this.map.on('layeradd', this.throttledReInitUnion, this);
    this.map.on('mousemove', this._syncUnionTooltip, this);

    this._updateUnionTooltip();
    this.Toolbar.toggleButton('unionMode', this.globalUnionModeEnabled());
    this._fireGlobalUnionModeToggled(true);
  },
  disableGlobalUnionMode() {
    this._globalUnionModeEnabled = false;
    this._clearUnionSelection();
    this.map.eachLayer((layer) => {
      layer.off('click', this._handleUnionClick, this);
    });

    this.map.off('layeradd', this._layerAddedUnion, this);
    this.map.off('layeradd', this.throttledReInitUnion, this);
    this.map.off('mousemove', this._syncUnionTooltip, this);
    this._removeUnionTooltip();

    this.Toolbar.toggleButton('unionMode', this.globalUnionModeEnabled());
    this._fireGlobalUnionModeToggled(false);
  },
  globalUnionModeEnabled() {
    return !!this._globalUnionModeEnabled;
  },
  toggleGlobalUnionMode() {
    if (this.globalUnionModeEnabled()) {
      this.disableGlobalUnionMode();
    } else {
      this.enableGlobalUnionMode();
    }
  },
  _isRelevantForUnion(layer) {
    return isRelevantLayer(layer) && isPolygonLayer(layer);
  },
  _addUnionClickListener(layer) {
    if (this._isRelevantForUnion(layer)) {
      layer.on('click', this._handleUnionClick, this);
    }
  },
  handleLayerAdditionInGlobalUnionMode() {
    const layers = this._addedLayersUnion;
    this._addedLayersUnion = {};
    if (this.globalUnionModeEnabled()) {
      for (const id in layers) {
        this._addUnionClickListener(layers[id]);
      }
    }
  },
  _layerAddedUnion({ layer }) {
    this._addedLayersUnion[L.stamp(layer)] = layer;
  },
  _handleUnionClick(e) {
    const layer = e.target;
    if (!this._isRelevantForUnion(layer)) {
      return;
    }
    const index = this._unionSelection.findIndex(
      (entry) => entry.layer === layer
    );
    if (index > -1) {
      this._unionSelection.splice(index, 1);
    } else {
      this._unionSelection.push({ layer });
    }
    // the selected layers keep their style, everything else is dimmed
    this._dimUnselectedLayers(this._unionSelection.map((entry) => entry.layer));

    // exactly two selected layers merge immediately and
    // the mode stays enabled for the next pair
    if (this._unionSelection.length === 2) {
      const layers = this._unionSelection.map((entry) => entry.layer);
      this._clearUnionSelection();
      this.union(layers[0], layers[1]);
    }
    this._updateUnionTooltip();
  },
  _clearUnionSelection() {
    this._restoreLayerDimming();
    this._unionSelection = [];
  },
  // tooltip following the cursor
  _syncUnionTooltip(e) {
    if (this._unionTooltip) {
      this._unionTooltip.setLatLng(e.latlng);
    }
  },
  _updateUnionTooltip() {
    if (!this._unionTooltip) {
      this._unionTooltip = L.tooltip(this.map.getCenter(), {
        permanent: true,
        offset: L.point(0, 10),
        direction: 'bottom',
        opacity: 0.8,
      }).addTo(this.map);
    }
    const count = this._unionSelection.length;
    const key =
      count === 0
        ? 'tooltips.selectFirstLayerFor'
        : 'tooltips.selectSecondLayerFor';
    this._unionTooltip.setContent(
      getTranslation(key).replace('{action}', 'union')
    );
  },
  _removeUnionTooltip() {
    if (this._unionTooltip) {
      this._unionTooltip.remove();
      this._unionTooltip = undefined;
    }
  },
  /**
   * Unifies the two layers:
   * `map.pm.union(layer1, layer2)`. An array of layers is also accepted.
   * Both original layers are removed and replaced by the single result
   * layer.
   */
  union(...args) {
    const layers = L.Util.isArray(args[0]) ? args[0] : args;
    const polygonLayers = layers.filter((layer) => isPolygonLayer(layer));

    if (polygonLayers.length < 2) {
      return undefined;
    }

    let resultGeoJSON;
    try {
      resultGeoJSON = union(
        polygonLayers[0].toGeoJSON(15),
        ...polygonLayers.slice(1).map((layer) => layer.toGeoJSON(15))
      );
    } catch (e) {
      console.error(
        'Leaflet-Geoman: union failed. Polygons with self-intersections are not supported'
      );
      return undefined;
    }

    if (!resultGeoJSON) {
      return undefined;
    }

    const resultingLayer = replaceLayersWithGeoJSON(
      this.map,
      polygonLayers,
      resultGeoJSON,
      polygonLayers[0]
    );

    this._fireUnion(resultingLayer, polygonLayers);
    resultingLayer.pm._fireEdit(resultingLayer, 'Union');

    return resultingLayer;
  },
};
export default GlobalUnionMode;
