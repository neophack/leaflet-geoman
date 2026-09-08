import { copyLatLngs } from '../helpers';

/**
 * Large layer rendering (continuation of issue #366).
 *
 * Layers with many vertices (`largeLayerThreshold`, default 1000) are
 * rendered with two optimizations while they are NOT edited:
 *
 * 1. Zoomed out: points that project closer than `decimationPixels`
 *    (default 1.5px) to the previously rendered point are dropped -
 *    the geometry is simplified depending on the zoom level.
 * 2. Zoomed in: points far outside the viewport are not rendered. The
 *    first and last point of an off-screen run are kept, so the path
 *    still crosses the viewport correctly.
 *
 * The full, untouched coordinates stay available and are used for
 * editing, `layer.toGeoJSON()`, boolean operations, copies and undo.
 * `layer.pm.getFullLatLngs()` returns them, `layer.pm.getRenderedLatLngs()`
 * the currently rendered subset.
 */
const LargeLayerRendering = {
  _initLargeLayerRendering() {
    this._optimizedLayers = [];
    this._decimationPixels = 1.5;

    this.map.on('layeradd', ({ layer }) => {
      this._maybeOptimizeLayer(layer);
    });

    if (!this.throttledProcessLayers) {
      this.throttledProcessLayers = L.Util.throttle(
        this._processOptimizedLayers,
        50,
        this
      );
    }
    this.map.on('zoomend', this.throttledProcessLayers, this);
    this.map.on('moveend', this.throttledProcessLayers, this);

    // keep the full coordinates in sync when undo/redo replaced them
    this.map.on('pm:undo', this._syncAfterGeometryReplacement, this);
    this.map.on('pm:redo', this._syncAfterGeometryReplacement, this);
  },
  getOptimizedLayers() {
    return this._optimizedLayers || [];
  },
  _maybeOptimizeLayer(layer) {
    if (
      !layer ||
      !(layer instanceof L.Polyline) ||
      layer instanceof L.LayerGroup ||
      layer._pmTempLayer ||
      layer._pmOptimize
    ) {
      return;
    }
    // respect the geoman ignore / opt-in contract: excluded layers must not
    // have their geometry swapped under the hood
    const pmManaged =
      (!L.PM.optIn && !layer.options.pmIgnore) ||
      (L.PM.optIn && layer.options.pmIgnore === false);
    if (!pmManaged) {
      return;
    }
    const threshold = this.globalOptions.largeLayerThreshold ?? 1000;
    if (threshold <= 0) {
      return;
    }
    if (this._flatLength(layer.getLatLngs()) < threshold) {
      return;
    }

    layer._pmOptimize = {
      full: copyLatLngs(layer),
      suspended: false,
      displayActive: false,
    };

    // Intercept external geometry writes (whole-layer drag, rotate, scale,
    // pinning, user code calling setLatLngs): they must replace the stored
    // full geometry, otherwise the next re-render would silently revert them
    // to the stale cache. Internal display writes (subset rendering) use
    // `layer._pmOriginalSetLatLngs` directly to bypass this interception.
    const originalSetLatLngs = layer.setLatLngs.bind(layer);
    layer._pmOriginalSetLatLngs = originalSetLatLngs;
    layer.setLatLngs = (latlngs) => {
      const state = layer._pmOptimize;
      if (!state || state.suspended || !layer._map) {
        return originalSetLatLngs(latlngs);
      }
      // external write: treat the incoming coords as the new full geometry
      // and re-render the optimized display from it
      state.full = copyLatLngs(layer, latlngs);
      this._processLayer(layer);
      return layer;
    };

    // toGeoJSON must always return the full geometry
    const originalToGeoJSON = layer.toGeoJSON.bind(layer);
    layer._pmOriginalToGeoJSON = originalToGeoJSON;
    layer.toGeoJSON = (precision) => {
      if (!layer._pmOptimize || !layer._pmOptimize.displayActive) {
        return originalToGeoJSON(precision);
      }
      const restore = layer._pmOptimize.full;
      const current = copyLatLngs(layer);
      originalSetLatLngs(restore);
      const result = originalToGeoJSON(precision);
      originalSetLatLngs(current);
      return result;
    };

    // while editing, the full geometry is needed (marker & snapping logic)
    // (named listeners so they can be removed again on deoptimize)
    layer._pmOptimizeListeners = {
      suspend: () => this._suspendOptimization(layer),
      resume: () => this._resumeOptimization(layer),
      deoptimize: () => this._deoptimizeLayer(layer),
    };
    layer.on('pm:enable', layer._pmOptimizeListeners.suspend);
    layer.on('pm:disable', layer._pmOptimizeListeners.resume);
    layer.on('remove', layer._pmOptimizeListeners.deoptimize);

    this._optimizedLayers.push(layer);
    this._processLayer(layer);
  },
  _deoptimizeLayer(layer) {
    if (!layer._pmOptimize) {
      return;
    }
    // restore the full geometry so the layer stays usable
    if (layer._pmOptimize.displayActive && layer._map) {
      layer._pmOriginalSetLatLngs(layer._pmOptimize.full);
    }
    delete layer._pmOptimize;
    // undo the function wrapping so it doesn't nest on a later re-add
    if (layer._pmOriginalToGeoJSON) {
      layer.toGeoJSON = layer._pmOriginalToGeoJSON;
      delete layer._pmOriginalToGeoJSON;
    }
    if (layer._pmOriginalSetLatLngs) {
      layer.setLatLngs = layer._pmOriginalSetLatLngs;
      delete layer._pmOriginalSetLatLngs;
    }
    // remove the listeners registered in _maybeOptimizeLayer
    if (layer._pmOptimizeListeners) {
      layer.off('pm:enable', layer._pmOptimizeListeners.suspend);
      layer.off('pm:disable', layer._pmOptimizeListeners.resume);
      layer.off('remove', layer._pmOptimizeListeners.deoptimize);
      delete layer._pmOptimizeListeners;
    }
    const index = this._optimizedLayers.indexOf(layer);
    if (index > -1) {
      this._optimizedLayers.splice(index, 1);
    }
  },
  _suspendOptimization(layer) {
    if (!layer._pmOptimize || layer._pmOptimize.suspended) {
      return;
    }
    layer._pmOptimize.suspended = true;
    if (layer._pmOptimize.displayActive) {
      layer._pmOptimize.displayActive = false;
      layer._pmOriginalSetLatLngs(layer._pmOptimize.full);
    }
  },
  _resumeOptimization(layer) {
    if (!layer._pmOptimize || !layer._pmOptimize.suspended) {
      return;
    }
    layer._pmOptimize.suspended = false;
    // the edit may have changed the geometry -> refresh the full copy
    layer._pmOptimize.full = copyLatLngs(layer);
    this._processLayer(layer);
  },
  _processOptimizedLayers() {
    this.getOptimizedLayers().forEach((layer) => {
      this._processLayer(layer);
    });
  },
  _processLayer(layer) {
    const state = layer._pmOptimize;
    if (!state || state.suspended || !layer._map) {
      return;
    }
    const display = this._buildDisplayCoords(state.full, layer);
    state.displayActive = true;
    layer._pmOriginalSetLatLngs(display);
  },
  /**
   * The actual optimization: recursive walk over the coordinate rings.
   * A point is kept when it is inside the padded viewport and at least
   * `decimationPixels` away from the last kept point (zoom dependent
   * simplification). Off-screen runs keep their first & last point so
   * the path crosses the viewport correctly.
   */
  _buildDisplayCoords(latlngs, layer) {
    if (latlngs === undefined || latlngs === null) {
      return latlngs;
    }
    if (L.Util.isArray(latlngs[0])) {
      return latlngs.map((part) => this._buildDisplayCoords(part, layer));
    }
    return this._decimateRing(latlngs, layer);
  },
  _decimateRing(ring, layer) {
    const map = layer._map;
    const bounds = map.getBounds().pad(0.5);
    const minPixels = this._decimationPixels;
    const projected = ring.map((latlng) => map.project(latlng));
    const inside = ring.map((latlng) => bounds.contains(latlng));

    const keep = [];
    let lastKeptPoint = null;

    for (let i = 0; i < ring.length; i += 1) {
      // keep the border points of off-screen runs so the path still
      // enters / exits the viewport correctly
      const isRunBorder =
        (inside[i] && i > 0 && !inside[i - 1]) ||
        (!inside[i] && i > 0 && inside[i - 1]) ||
        i === 0 ||
        i === ring.length - 1;

      if (!inside[i] && !isRunBorder) {
        continue;
      }

      const point = projected[i];
      const farEnough =
        lastKeptPoint === null || point.distanceTo(lastKeptPoint) >= minPixels;
      if (isRunBorder || farEnough) {
        keep.push(ring[i]);
        lastKeptPoint = point;
      }
    }

    // a polygon ring needs at least 3 points, a line 2
    const minRingLength = layer instanceof L.Polygon ? 3 : 2;
    if (keep.length < minRingLength && ring.length >= minRingLength) {
      const stride = Math.max(1, Math.floor(ring.length / minRingLength));
      const fallback = [];
      for (
        let i = 0;
        i < ring.length && fallback.length < minRingLength;
        i += stride
      ) {
        fallback.push(ring[i]);
      }
      return fallback;
    }

    return keep;
  },
  _flatLength(latlngs) {
    if (!latlngs) {
      return 0;
    }
    if (L.Util.isArray(latlngs[0])) {
      return latlngs.reduce((sum, part) => sum + this._flatLength(part), 0);
    }
    return latlngs.length;
  },
  /** full coordinates of a layer (or the layer coords when not optimized) */
  _fullLatLngsOf(layer) {
    if (layer._pmOptimize) {
      // while suspended (f.ex. currently being edited) layer.getLatLngs()
      // already IS the full geometry, and is more current than the cached
      // `.full` copy - that's only refreshed again on _resumeOptimization
      return layer._pmOptimize.suspended
        ? layer.getLatLngs()
        : layer._pmOptimize.full;
    }
    // only polylines have latlng arrays (Marker / Circle use getLatLng)
    if (layer instanceof L.Polyline) {
      return layer.getLatLngs();
    }
    return undefined;
  },
  /** called after undo/redo replaced the geometry of a layer */
  _onGeometryReplaced(layer) {
    const state = layer?._pmOptimize;
    if (!state) {
      return;
    }
    // when the layer currently shows the optimized subset, the setLatLngs
    // interception already stored the replacement as the new full geometry -
    // copying from the layer here would regress `full` to the display subset
    if (state.suspended || !state.displayActive) {
      state.full = copyLatLngs(layer);
    }
    if (!state.suspended) {
      this._processLayer(layer);
    }
  },
  _syncAfterGeometryReplacement() {
    // safety net: refresh stored copies of layers that currently hold full
    // coordinates (f.ex. while editing)
    this.getOptimizedLayers().forEach((layer) => {
      const state = layer._pmOptimize;
      if (state && !state.displayActive) {
        state.full = copyLatLngs(layer);
      }
    });
  },
};

export default LargeLayerRendering;
