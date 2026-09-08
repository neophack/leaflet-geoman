import get from 'lodash/get';
import { copyLatLngs } from '../helpers';

/**
 * Pinning Mixin.
 *
 * While the global `pinning` option is on (`map.pm.setGlobalOptions({
 * pinning: true })` or the toolbar pin button), dragging an edit
 * vertex-marker that shares its position with a vertex/marker of another
 * layer moves that layer's vertex together LIVE during the drag. Vertices
 * at the same position are linked automatically for the duration of the
 * drag - there is no pin-creation gesture and no persistent pin list.
 * A layer can opt out with `allowPinning: false`.
 *
 * The shared logic lives on the Edit classes (included via L.PM.Edit.js);
 * each Edit class wires it up in its `applyOptions()`. Line/Polygon/
 * Rectangle bind `dragstart` on their vertex markers; Marker binds
 * `pm:dragstart` on the layer itself (see Edit.Marker).
 *
 * The map-level API (`enablePinning()`, `disablePinning()`,
 * `togglePinning()`, `pinningEnabled()`) is in MapPinningMixin below -
 * thin wrappers around the global `pinning` option, like upstream.
 */
const PinningMixin = {
  _initPinning() {
    if (this.options.allowPinning && this._markers) {
      this._assignPinEvents(this._markers);
    }
  },
  _disablePinning(markers = this._markers) {
    if (!markers) {
      return;
    }
    markers.forEach((marker) => {
      if (Array.isArray(marker)) {
        this._disablePinning(marker);
        return;
      }
      // simplified rings keep `{}` placeholders for hidden vertices
      if (!marker || typeof marker.off !== 'function') {
        return;
      }
      marker.off('dragstart', this._onPinnedMarkerDragStart, this);
    });
  },
  _assignPinEvents(markers) {
    markers.forEach((marker) => {
      if (Array.isArray(marker)) {
        this._assignPinEvents(marker);
        return;
      }
      // simplified rings keep `{}` placeholders for hidden vertices
      if (!marker || typeof marker.on !== 'function') {
        return;
      }
      marker.off('dragstart', this._onPinnedMarkerDragStart, this);
      marker.on('dragstart', this._onPinnedMarkerDragStart, this);
    });
  },
  _onPinnedMarkerDragStart(e) {
    this.pinnedVertices = [];
    this._enabledLayersForPinning = [];
    const draggedMarker = e.target;
    const latlng = draggedMarker.getLatLng();

    const relevantLayers = [];
    L.PM.Utils.findLayers(this._map).forEach((layer) => {
      if (this._isRelevantForPinning(layer) && this._layer !== layer) {
        relevantLayers.push(layer);
      }
    });

    relevantLayers.forEach((layer) => {
      const coords =
        layer instanceof L.Marker || layer instanceof L.CircleMarker
          ? [layer.getLatLng()]
          : layer.getLatLngs();
      const pinned = {
        indexPaths: L.PM.Utils.findDeepCoordIndex(coords, latlng, false),
        layer,
      };
      if (Object.keys(pinned.indexPaths).length === 0) {
        return;
      }
      this.pinnedVertices.push(pinned);
      // exclude the pinned layer from snapping etc. for the drag duration
      layer._pmTempLayer = true;
      if (layer.pm.enabled()) {
        this._enabledLayersForPinning.push(layer);
        layer.pm.disable();
      }
      if (
        layer instanceof L.Polyline &&
        layer.pm &&
        !layer.pm.options.allowSelfIntersection
      ) {
        layer.pm._coordsBeforeEdit = copyLatLngs(layer, layer.getLatLngs());
        if (
          layer.pm.options.allowSelfIntersectionEdit &&
          layer.pm.hasSelfIntersection()
        ) {
          console.warn("allowSelfIntersectionEdit doesn't work with pinning.");
          layer.pm._markerAllowedToDrag = false;
        } else {
          layer.pm._markerAllowedToDrag = null;
        }
      }
    });

    // marker layers fire pm:drag / pm:dragend (via the Dragging mixin)
    // instead of Leaflet's own drag / dragend
    const prefix = e.type.includes('pm:') ? 'pm:' : '';
    if (this.pinnedVertices.length > 0) {
      draggedMarker.on(`${prefix}drag`, this._applyAnchorLatLng, this);
      draggedMarker.off(`${prefix}dragend`, this._onPinnedMarkerDragEnd, this);
      draggedMarker.on(`${prefix}dragend`, this._onPinnedMarkerDragEnd, this);
      this.pinnedVertices.forEach(({ layer, indexPaths }) => {
        (layer.pm || this)._fireMarkerDragStart(e, indexPaths?.indexPath);
      });
    }
  },
  _onPinnedMarkerDragEnd(e) {
    const marker = e.target;
    if (this.pinnedVertices.length > 0) {
      this._applyAnchorLatLng({ target: marker, latlng: marker.getLatLng() });
      const prefix = e.type.includes('pm:') ? 'pm:' : '';
      marker.off(`${prefix}drag`, this._applyAnchorLatLng, this);
      this.pinnedVertices.forEach(({ layer, indexPaths }) => {
        delete layer._pmTempLayer;
        if (layer instanceof L.Polyline && layer.pm) {
          let hasSelfIntersection = layer.pm.hasSelfIntersection();
          if (
            hasSelfIntersection &&
            layer.pm.options.allowSelfIntersectionEdit &&
            layer.pm._markerAllowedToDrag
          ) {
            hasSelfIntersection = false;
          }
          if (!layer.pm.options.allowSelfIntersection && hasSelfIntersection) {
            layer.setLatLngs(layer.pm._coordsBeforeEdit);
            layer.pm._coordsBeforeEdit = null;
            layer.pm._handleLayerStyle();
            layer.pm._fireLayerReset(e, indexPaths.indexPath);
          } else if (
            !layer.pm.options.allowSelfIntersection &&
            layer.pm.options.allowSelfIntersectionEdit
          ) {
            layer.pm._handleLayerStyle();
          }
        }
        const layerPm = layer.pm || this;
        layerPm._fireMarkerDragEnd(e, indexPaths?.indexPath);
        layerPm._fireEdit(layer);
      });
    }
    this._enabledLayersForPinning.forEach((layer) => {
      layer.pm.enable();
    });
    this.pinnedVertices = [];
    this._enabledLayersForPinning = [];
  },
  _applyAnchorLatLng(e) {
    const { target: marker } = e;
    const latlng = marker.getLatLng();
    this.pinnedVertices.forEach((pinned) => {
      const { layer } = pinned;
      const isMarker =
        layer instanceof L.Marker || layer instanceof L.CircleMarker;
      const isRectangle = layer instanceof L.Rectangle;
      const latlngs = isMarker ? [layer.getLatLng()] : layer.getLatLngs();
      const { indexPath, index, parentPath } = pinned.indexPaths;

      // replace the pinned vertex with the dragged position
      const ring = indexPath.length > 1 ? get(latlngs, parentPath) : latlngs;
      const previous = ring[index];
      ring.splice(index, 1, latlng);

      // the pinned vertex must not be moved onto another vertex of the same
      // ring - that would create a zero-length edge (e.g. a rectangle and a
      // triangle share a corner, and another triangle's vertex pinned to
      // that corner is dragged onto one of the triangle's other vertices)
      if (!isMarker && this._ringHasVertexAt(ring, latlng, index)) {
        ring.splice(index, 1, previous);
        return;
      }

      if (isMarker) {
        layer.setLatLng(latlngs[0]);
        if (
          layer.pm &&
          layer instanceof L.CircleMarker &&
          typeof layer.pm._updateHiddenPolyCircle === 'function'
        ) {
          layer.pm._updateHiddenPolyCircle();
        }
      } else if (isRectangle) {
        // a rectangle corner also moves the two adjacent corners - rebuild
        // the rectangle from the dragged corner + the opposite one
        const oppositeIndex = (index + 2) % 4;
        const oppositeLatLng = latlngs[0][oppositeIndex];
        const corners = L.PM.Utils._getRotatedRectangle(
          latlng,
          oppositeLatLng,
          layer.pm?._angle || 0,
          this._map
        );
        // dragging the corner onto/level with another corner degenerates
        // the rebuilt rectangle (zero width/height edges) - keep the
        // previous rectangle instead
        if (this._ringHasAdjacentDuplicates(corners)) {
          ring.splice(index, 1, previous);
          return;
        }
        layer.setLatLngs(corners);
        // the vertex order may change - recompute where the dragged corner is
        pinned.indexPaths = L.PM.Utils.findDeepCoordIndex(
          layer.getLatLngs(),
          latlng,
          false
        );
      } else if (layer instanceof L.Polyline && layer.pm) {
        if (
          !layer.pm.options.allowSelfIntersection &&
          layer.pm.options.allowSelfIntersectionEdit &&
          layer.pm.hasSelfIntersection() &&
          layer.pm._markerAllowedToDrag === false
        ) {
          layer.setLatLngs(layer.pm._coordsBeforeEdit);
          layer.pm._handleLayerStyle();
        } else {
          if (!this.options.allowSelfIntersection) {
            layer.pm._handleLayerStyle();
          }
          layer.setLatLngs(latlngs);
        }
      } else {
        layer.setLatLngs(latlngs);
      }
      (layer.pm || this)._fireMarkerDrag(e, pinned.indexPaths?.indexPath);
    });
  },
  /**
   * Whether any vertex of `ring` (except the one at `exceptIndex`) sits at
   * exactly the position of `latlng`.
   */
  _ringHasVertexAt(ring, latlng, exceptIndex) {
    return ring.some(
      (ll, i) => i !== exceptIndex && ll && ll.equals && ll.equals(latlng)
    );
  },
  /**
   * Whether a ring has two identical adjacent vertices (a zero-length
   * edge). For a rebuilt rectangle this happens when the dragged corner is
   * dragged level with (or onto) the opposite corner.
   */
  _ringHasAdjacentDuplicates(ring) {
    const { length } = ring;
    return ring.some(
      (ll, i) => ll && ll.equals && ll.equals(ring[(i + 1) % length])
    );
  },
  _isRelevantForPinning(layer) {
    return (
      layer.pm &&
      !(layer instanceof L.LayerGroup) &&
      ((!L.PM.optIn && !layer.options.pmIgnore) || // if optIn is not set / true and pmIgnore is not set / true (default)
        (L.PM.optIn && layer.options.pmIgnore === false)) && // if optIn is true and pmIgnore is false
      !layer._pmTempLayer &&
      layer.pm.options.allowPinning &&
      (layer._latlng || (layer._latlngs && layer._latlngs.length > 0))
    );
  },
};

/**
 * Map-level pinning API: wrappers around the global `pinning` option
 * (like upstream Geoman, where the toolbar pin button toggles it).
 */
export const MapPinningMixin = {
  enablePinning() {
    this.setGlobalOptions({ pinning: true });
    this._firePinningToggled(true);
  },
  disablePinning() {
    this.setGlobalOptions({ pinning: false });
    this._firePinningToggled(false);
  },
  togglePinning() {
    if (this.pinningEnabled()) {
      this.disablePinning();
    } else {
      this.enablePinning();
    }
  },
  pinningEnabled() {
    return !!this.globalOptions.pinning;
  },
};

export default PinningMixin;
