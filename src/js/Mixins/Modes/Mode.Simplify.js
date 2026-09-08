import { copyLatLngs } from '../../helpers';
import { defaultEpsilon, simplifyRing } from '../../helpers/Simplify';

/**
 * Line Simplification Mode.
 * Click a polyline or polygon to simplify its vertices with the
 * Douglas-Peucker algorithm. The tolerance can be configured globally:
 * `map.pm.setGlobalOptions({ simplificationFactor: 0.003 })`
 * (relative to the bounding box diagonal of the layer).
 */
const GlobalLineSimplificationMode = {
  _globalLineSimplificationModeEnabled: false,
  enableGlobalLineSimplificationMode() {
    this._globalLineSimplificationModeEnabled = true;
    // latlngs before the first simplification of each layer, for
    // cancelGlobalLineSimplificationMode()
    this._lineSimplificationSnapshots = new Map();

    this.map.eachLayer((layer) => {
      this._addLineSimplificationClickListener(layer);
    });

    if (!this.throttledReInitLineSimplification) {
      this.throttledReInitLineSimplification = L.Util.throttle(
        this.handleLayerAdditionInGlobalLineSimplificationMode,
        100,
        this
      );
    }
    this._addedLayersLineSimplification = {};
    this.map.on('layeradd', this._layerAddedLineSimplification, this);
    this.map.on('layeradd', this.throttledReInitLineSimplification, this);

    this.Toolbar.toggleButton(
      'lineSimplificationMode',
      this.globalLineSimplificationModeEnabled()
    );
    this._fireGlobalLineSimplificationModeToggled(true);
  },
  disableGlobalLineSimplificationMode() {
    this._globalLineSimplificationModeEnabled = false;
    this._lineSimplificationSnapshots = undefined;
    this.map.eachLayer((layer) => {
      layer.off('click', this._handleLineSimplificationClick, this);
    });

    this.map.off('layeradd', this._layerAddedLineSimplification, this);
    this.map.off('layeradd', this.throttledReInitLineSimplification, this);

    this.Toolbar.toggleButton(
      'lineSimplificationMode',
      this.globalLineSimplificationModeEnabled()
    );
    this._fireGlobalLineSimplificationModeToggled(false);
  },
  globalLineSimplificationModeEnabled() {
    return !!this._globalLineSimplificationModeEnabled;
  },
  toggleGlobalLineSimplificationMode() {
    if (this.globalLineSimplificationModeEnabled()) {
      this.disableGlobalLineSimplificationMode();
    } else {
      this.enableGlobalLineSimplificationMode();
    }
  },
  /**
   * Reverts the layers to the state before they were simplified while the
   * mode is active. The mode itself stays enabled.
   */
  cancelGlobalLineSimplificationMode() {
    if (this._lineSimplificationSnapshots) {
      this._lineSimplificationSnapshots.forEach((latlngs, layer) => {
        if (layer._map) {
          layer.setLatLngs(latlngs);
          if (layer.pm.enabled()) {
            layer.pm._initMarkers();
          }
          if (layer._pmOptimize) {
            layer._pmOptimize.full = latlngs;
            layer._pmOptimize.displayActive = false;
            if (!layer._pmOptimize.suspended) {
              this._processLayer(layer);
            }
          }
          this.__fire(layer, 'pm:cancel', { layer }, 'LineSimplification');
        }
      });
      this._lineSimplificationSnapshots.clear();
    }
    this.__fire(
      this.map,
      'pm:globalcancel',
      { map: this.map },
      'LineSimplification'
    );
  },
  _isRelevantForLineSimplification(layer) {
    return (
      layer.pm &&
      layer instanceof L.Polyline &&
      !(layer instanceof L.LayerGroup) &&
      ((!L.PM.optIn && !layer.options.pmIgnore) ||
        (L.PM.optIn && layer.options.pmIgnore === false)) &&
      !layer._pmTempLayer
    );
  },
  _addLineSimplificationClickListener(layer) {
    if (this._isRelevantForLineSimplification(layer)) {
      layer.on('click', this._handleLineSimplificationClick, this);
    }
  },
  handleLayerAdditionInGlobalLineSimplificationMode() {
    const layers = this._addedLayersLineSimplification;
    this._addedLayersLineSimplification = {};
    if (this.globalLineSimplificationModeEnabled()) {
      for (const id in layers) {
        this._addLineSimplificationClickListener(layers[id]);
      }
    }
  },
  _layerAddedLineSimplification({ layer }) {
    this._addedLayersLineSimplification[L.stamp(layer)] = layer;
  },
  _handleLineSimplificationClick(e) {
    const layer = e.target;
    if (this._isRelevantForLineSimplification(layer)) {
      this.simplifyLayer(layer);
    }
  },
  /**
   * Simplifies the layer. Can also be called directly:
   * `map.pm.simplifyLayer(layer, { factor: 0.005 })`
   */
  simplifyLayer(layer, options = {}) {
    if (!(layer instanceof L.Polyline)) {
      return layer;
    }
    const factor =
      options.factor ?? this.globalOptions.simplificationFactor ?? 0.003;

    // large layers are rendered with a subset -> simplify the full geometry
    const fullLatLngs =
      typeof this._fullLatLngsOf === 'function'
        ? this._fullLatLngsOf(layer)
        : layer.getLatLngs();
    const latlngs = copyLatLngs(layer, fullLatLngs);
    const epsilon = defaultEpsilon(latlngs, factor);
    const isPolygon = layer instanceof L.Polygon;

    const simplified = this._simplifyLatLngs(latlngs, epsilon, isPolygon);
    // remember the geometry before the first simplification of this mode
    // session, so cancelGlobalLineSimplificationMode() can restore it
    if (
      this._lineSimplificationSnapshots &&
      !this._lineSimplificationSnapshots.has(layer)
    ) {
      this._lineSimplificationSnapshots.set(layer, latlngs);
    }
    layer.setLatLngs(simplified);
    // the simplified geometry is the new source of truth for optimized layers
    if (layer._pmOptimize) {
      layer._pmOptimize.full = simplified;
      layer._pmOptimize.displayActive = false;
      if (!layer._pmOptimize.suspended) {
        this._processLayer(layer);
      }
    }
    if (layer.pm.enabled()) {
      layer.pm._initMarkers();
    }

    this._fireSimplify(layer, latlngs, simplified);
    layer.pm._fireEdit(layer, 'Simplify');

    return layer;
  },
  _simplifyLatLngs(latlngs, epsilon, closed = false) {
    if (!latlngs || latlngs.length === 0) {
      return latlngs;
    }
    // flat array of latlngs (L.Polyline or a single ring)
    if (!L.Util.isArray(latlngs[0])) {
      return simplifyRing(latlngs, epsilon, { closed });
    }
    return latlngs.map((part) => this._simplifyLatLngs(part, epsilon, closed));
  },
};
export default GlobalLineSimplificationMode;
