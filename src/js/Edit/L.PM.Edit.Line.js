import kinks from '@turf/kinks';
import lineIntersect from '@turf/line-intersect';
import get from 'lodash/get';
import Edit from './L.PM.Edit';
import { copyLatLngs, hasValues, removeEmptyCoordRings } from '../helpers';

import MarkerLimits from '../Mixins/MarkerLimits';

// Shit's getting complicated in here with Multipolygon Support. So here's a quick note about it:
// Multipolygons with holes means lots of nested, multidimensional arrays.
// In order to find a value inside such an array you need a path to adress it directly.
// Example: var arr = [[['a', 'b'], ['c']]];
// The indexPath to 'b' is [0, 0, 1]. The indexPath to 'c' is [0, 1, 0].
// So I can get 'b' with: arr[0][0][1].
// Got it? Now you know what is meant when you read "indexPath" around here. Have fun 👍

Edit.Line = Edit.extend({
  includes: [MarkerLimits],
  _shape: 'Line',
  initialize(layer) {
    this._layer = layer;
    this._enabled = false;

    this._initSelectionClick();
  },
  enable(options) {
    L.Util.setOptions(this, options);

    this._map = this._layer._map;

    // cancel when map isn't available, this happens when the polygon is removed before this fires
    if (!this._map) {
      return;
    }

    // layer is not allowed to edit
    if (!this.options.allowEditing) {
      this.disable();
      return;
    }

    if (this.enabled()) {
      // if it was already enabled, disable first
      // we don't block enabling again because new options might be passed
      this.disable();
    }

    // change state
    this._enabled = true;

    // issue #366 (large layer rendering): editing needs the full geometry,
    // this has to happen before _initMarkers reads the coordinates
    this._map.pm?._suspendOptimization?.(this._layer);

    // init markers
    this._initMarkers();

    this.applyOptions();

    // if shape gets removed from map, disable edit mode
    this._layer.on('remove', this.disable, this);

    if (!this.options.allowSelfIntersection) {
      this._layer.on(
        'pm:vertexremoved',
        this._handleSelfIntersectionOnVertexRemoval,
        this
      );
    }

    if (!this.options.allowSelfIntersection) {
      if (this._layer.options.color !== '#f00000ff') {
        this.cachedColor = this._layer.options.color;
        this.isRed = false;
      } else {
        this.isRed = true;
      }
      this._handleLayerStyle();
    } else {
      this.cachedColor = undefined;
    }

    // issue #366: refresh the visible markers when the viewport changes
    if (!this.throttledUpdateViewport) {
      this.throttledUpdateViewport = L.Util.throttle(
        this._updateMarkersViewport,
        100,
        this
      );
    }
    this._map.on('moveend', this.throttledUpdateViewport, this);
    this._map.on('zoomend', this.throttledUpdateViewport, this);
    // zoom changes the pixel spacing -> rebuild the shown edit markers
    this._map.on('zoomend', this._onZoomEndRebuildMarkers, this);

    this._fireEnable();
  },
  disable() {
    // if it's not enabled, it doesn't need to be disabled
    if (!this.enabled()) {
      return;
    }

    // prevent disabling if polygon is being dragged
    if (this._dragging) {
      return;
    }
    this._enabled = false;

    this._markerGroup.clearLayers();
    this._markerGroup.removeFrom(this._map);

    // issue #366: the viewport can move while editing is off (no
    // moveend/zoomend listener attached then) - drop the cache so the next
    // enable() recomputes it against the current view instead of a stale one
    this._viewportBounds = null;

    // remove listener
    this._layer.off('remove', this.disable, this);
    if (this._map) {
      this._map.off('moveend', this.throttledUpdateViewport, this);
      this._map.off('zoomend', this.throttledUpdateViewport, this);
      this._map.off('zoomend', this._onZoomEndRebuildMarkers, this);
    }

    if (!this.options.allowSelfIntersection) {
      this._layer.off(
        'pm:vertexremoved',
        this._handleSelfIntersectionOnVertexRemoval,
        this
      );
    }

    // remove draggable class
    const el = this._layer._path
      ? this._layer._path
      : this._layer._renderer._container;
    L.DomUtil.removeClass(el, 'leaflet-pm-draggable');

    if (this._layerEdited) {
      this._fireUpdate();
    }
    this._layerEdited = false;
    this._fireDisable();

    // issue #366 (large layer rendering): re-enable the rendering
    // optimization only after firing update/disable, so listeners still see
    // the full (edited) geometry via layer.getLatLngs()
    this._map?.pm?._resumeOptimization?.(this._layer);
  },
  enabled() {
    return this._enabled;
  },
  toggleEdit(options) {
    if (!this.enabled()) {
      this.enable(options);
    } else {
      this.disable();
    }
    return this.enabled();
  },
  applyOptions() {
    if (this.options.snappable) {
      this._initSnappableMarkers();
    } else {
      this._disableSnapping();
    }
    if (this.options.pinning) {
      this._initPinning();
    } else {
      this._disablePinning();
    }
  },
  _initMarkers() {
    const map = this._map;
    const coords = this._layer.getLatLngs();

    // cleanup old ones first
    if (this._markerGroup) {
      this._markerGroup.removeFrom(map);
      this._markerGroup.clearLayers();
    }

    // add markerGroup to map, markerGroup includes regular and middle markers
    this._markerGroup = new L.FeatureGroup();
    this._markerGroup._pmTempLayer = true;

    // issue #366: flat list of all marker objects (vertex & middle) for the
    // viewport culling - only markers in view are attached to the DOM
    this._allEditMarkers = [];

    // handle coord-rings (outer, inner, etc)
    const handleRing = (coordsArr) => {
      // if there is another coords ring, go a level deep and do this again
      if (Array.isArray(coordsArr[0])) {
        return coordsArr.map(handleRing, this);
      }

      // rings with too many vertices only get a decimated subset of vertex
      // markers (editing thousands of markers freezes the browser). The
      // array keeps `{}` placeholders so marker indices stay aligned with
      // coordinate indices
      const keepSet = this._shownIndicesForRing(coordsArr);
      const simplify = !!keepSet;

      // the marker array, it includes only the markers of vertexes (no middle markers)
      const ringArr = coordsArr.map((latlng, k) => {
        if (simplify && !keepSet.has(k)) {
          return {}; // placeholder for a hidden vertex (no marker)
        }
        const marker = this._createMarker(latlng);
        if (simplify) {
          marker._pmSimplified = true;
        }
        return marker;
      });

      // middle markers are useless on simplified rings (between shown
      // vertices there are hundreds of hidden ones) and far too many
      if (this.options.hideMiddleMarkers !== true && !simplify) {
        // create small markers in the middle of the regular markers
        coordsArr.map((v, k) => {
          // find the next index fist
          const nextIndex = this.isPolygon()
            ? (k + 1) % coordsArr.length
            : k + 1;
          // create the marker
          return this._createMiddleMarker(ringArr[k], ringArr[nextIndex]);
        });
      }

      return ringArr;
    };

    // create markers
    this._markers = handleRing(coords);

    // handle possible limitation: maximum number of markers
    this.filterMarkerGroup();

    // add markerGroup to map
    map.addLayer(this._markerGroup);

    // recreated markers need the pin bindings again
    if (this.options.pinning) {
      this._initPinning();
    }
  },

  // which vertices of a ring get an editable marker. Returns null when the
  // ring should not be simplified. Zoom dependent: shown vertices are at
  // least `simplifyEditMarkersSpacing` screen pixels apart, so zooming in
  // reveals more markers for finer editing, zooming out shows fewer. The
  // `simplifyEditMarkersMax` cap prevents thousands of markers on deep zoom
  _shownIndicesForRing(coordsArr) {
    const threshold = this.options.simplifyEditMarkers;
    if (
      !(threshold > 0) ||
      coordsArr.length <= threshold ||
      this.options.rotate
    ) {
      return null;
    }

    const spacing = this.options.simplifyEditMarkersSpacing;
    let kept = [];
    if (spacing > 0 && this._map) {
      const pts = coordsArr.map((ll) =>
        this._map.latLngToLayerPoint(L.latLng(ll))
      );
      kept.push(0);
      let last = 0;
      for (let i = 1; i < coordsArr.length - 1; i += 1) {
        if (pts[i].distanceTo(pts[last]) >= spacing) {
          kept.push(i);
          last = i;
        }
      }
      kept.push(coordsArr.length - 1);
    } else {
      // no spacing / no map: fall back to a uniform stride
      const step = Math.ceil(coordsArr.length / threshold);
      for (let i = 0; i < coordsArr.length; i += step) {
        kept.push(i);
      }
    }
    if (kept[kept.length - 1] !== coordsArr.length - 1) {
      kept.push(coordsArr.length - 1);
    }

    const maxShown = this.options.simplifyEditMarkersMax ?? threshold * 3;
    if (kept.length > maxShown) {
      const stride = Math.ceil(kept.length / maxShown);
      kept = kept.filter((_, i) => i % stride === 0);
      if (kept[kept.length - 1] !== coordsArr.length - 1) {
        kept.push(coordsArr.length - 1);
      }
    }
    return new Set(kept);
  },

  // issue #366: simplified rings rebuild their shown markers on zoom so the
  // marker density matches the zoom level (more markers zoomed in)
  _onZoomEndRebuildMarkers() {
    if (!this._enabled || !this._markerGroup) {
      return;
    }
    if (this._dragging) {
      // rebuilding below a running drag breaks it - defer to drag end
      this._needsMarkerRebuild = true;
      return;
    }
    this._initMarkers();
    if (this.options.snappable) {
      this._initSnappableMarkers();
    }
  },

  // creates initial markers for coordinates
  _createMarker(latlng) {
    const marker = new L.Marker(latlng, {
      draggable: true,
      icon: L.divIcon({ className: 'marker-icon' }),
    });
    this._setPane(marker, 'vertexPane');

    marker._pmTempLayer = true;

    if (this.options.rotate) {
      marker.on('dragstart', this._onRotateStart, this);
      marker.on('drag', this._onRotate, this);
      marker.on('dragend', this._onRotateEnd, this);
    } else {
      marker.on('click', this._onVertexClick, this);
      marker.on('dragstart', this._onMarkerDragStart, this);
      marker.on('move', this._onMarkerDrag, this);
      marker.on('dragend', this._onMarkerDragEnd, this);

      if (!this.options.preventMarkerRemoval) {
        marker.on(this.options.removeVertexOn, this._removeMarker, this);
      }
    }

    // issue #366: only attach markers that are in the viewport, the marker
    // object itself is always created so dragging / neighbor logic is unchanged
    this._allEditMarkers.push(marker);
    if (!this._limitMarkersByViewport() || this._markerInViewport(latlng)) {
      this._markerGroup.addLayer(marker);
    }

    return marker;
  },

  // issue #366 (6000+ vertex performance): viewport culling of edit markers
  _limitMarkersByViewport() {
    return (
      this.options.limitMarkersToViewport !== false &&
      this.options.limitMarkersToCount === -1 && // count limit & viewport limit don't mix
      !!this._map
    );
  },
  _markerInViewport(latlng) {
    if (!this._viewportBounds) {
      this._viewportBounds = this._map.getBounds().pad(0.25);
    }
    return this._viewportBounds.contains(latlng);
  },
  _updateMarkersViewport() {
    if (!this._markerGroup || !this._enabled || !this._allEditMarkers) {
      // the throttled moveend/zoomend handler can still fire after the
      // markers were torn down (layer removed mid-edit) - nothing to do
      return;
    }
    if (!this._limitMarkersByViewport() || this._preventRenderMarkers) {
      return;
    }
    this._viewportBounds = this._map.getBounds().pad(0.25);
    const group = this._markerGroup;
    this._allEditMarkers.forEach((marker) => {
      if (marker._pmRemoved) {
        return;
      }
      const inView = this._viewportBounds.contains(marker.getLatLng());
      const attached = group.hasLayer(marker);
      if (inView && !attached) {
        group.addLayer(marker);
      } else if (!inView && attached) {
        group.removeLayer(marker);
      }
    });
  },

  // creates the middle markes between coordinates
  _createMiddleMarker(leftM, rightM) {
    // cancel if there are no two markers
    if (!leftM || !rightM) {
      return false;
    }

    const latlng = L.PM.Utils.calcMiddleLatLng(
      this._map,
      leftM.getLatLng(),
      rightM.getLatLng()
    );

    const middleMarker = this._createMarker(latlng);
    const middleIcon = L.divIcon({
      className: 'marker-icon marker-icon-middle',
    });
    middleMarker.setIcon(middleIcon);
    middleMarker.leftM = leftM;
    middleMarker.rightM = rightM;

    // save reference to this middle markers on the neighboor regular markers
    leftM._middleMarkerNext = middleMarker;
    rightM._middleMarkerPrev = middleMarker;

    middleMarker.on(this.options.addVertexOn, this._onMiddleMarkerClick, this);
    middleMarker.on('movestart', this._onMiddleMarkerMoveStart, this);

    return middleMarker;
  },
  _onMiddleMarkerClick(e) {
    const middleMarker = e.target;

    if (!this._vertexValidation('add', e)) {
      return;
    }
    // TODO: move the next two lines inside _addMarker() as soon as
    // https://github.com/Leaflet/Leaflet/issues/4484
    // is fixed
    const icon = L.divIcon({ className: 'marker-icon' });
    middleMarker.setIcon(icon);
    this._addMarker(middleMarker, middleMarker.leftM, middleMarker.rightM);
  },
  _onMiddleMarkerMoveStart(e) {
    const middleMarker = e.target;
    middleMarker.on('moveend', this._onMiddleMarkerMoveEnd, this);
    if (!this._vertexValidation('add', e)) {
      middleMarker.on('move', this._onMiddleMarkerMovePrevent, this);
      return;
    }

    middleMarker._dragging = true;
    // TODO: This is a workaround. Remove the moveend listener and
    // callback as soon as this is fixed:
    // https://github.com/Leaflet/Leaflet/issues/4484
    this._addMarker(middleMarker, middleMarker.leftM, middleMarker.rightM);
  },
  _onMiddleMarkerMovePrevent(e) {
    const middleMarker = e.target;
    this._vertexValidationDrag(middleMarker);
  },
  _onMiddleMarkerMoveEnd(e) {
    const middleMarker = e.target;
    middleMarker.off('move', this._onMiddleMarkerMovePrevent, this);
    middleMarker.off('moveend', this._onMiddleMarkerMoveEnd, this);
    if (!this._vertexValidationDragEnd(middleMarker)) {
      return;
    }
    const icon = L.divIcon({ className: 'marker-icon' });
    middleMarker.setIcon(icon);
    // timeout is needed else this._onVertexClick fires the event because it is called after deleting the flag
    setTimeout(() => {
      delete middleMarker._dragging;
    }, 100);
  },
  // adds a new marker from a middlemarker
  _addMarker(newM, leftM, rightM) {
    // first, make this middlemarker a regular marker
    newM.off('movestart', this._onMiddleMarkerMoveStart, this);
    newM.off(this.options.addVertexOn, this._onMiddleMarkerClick, this);
    // now, create the polygon coordinate point for that marker
    // and push into marker array
    // and associate polygon coordinate with marker coordinate
    const latlng = newM.getLatLng();
    const coords = this._layer._latlngs;

    // remove linked markers
    delete newM.leftM;
    delete newM.rightM;

    // the index path to the marker inside the multidimensional marker array
    const { indexPath, index, parentPath } = L.PM.Utils.findDeepMarkerIndex(
      this._markers,
      leftM
    );

    // define the coordsRing that is edited
    const coordsRing = indexPath.length > 1 ? get(coords, parentPath) : coords;

    // define the markers array that is edited
    const markerArr =
      indexPath.length > 1 ? get(this._markers, parentPath) : this._markers;

    // add coordinate to coordinate array
    coordsRing.splice(index + 1, 0, latlng);

    // add marker to marker array
    markerArr.splice(index + 1, 0, newM);

    // set new latlngs to update polygon
    this._layer.setLatLngs(coords);

    // create the new middlemarkers
    if (this.options.hideMiddleMarkers !== true) {
      this._createMiddleMarker(leftM, newM);
      this._createMiddleMarker(newM, rightM);
    }

    // fire edit event
    this._fireEdit();
    this._layerEdited = true;
    this._fireChange(this._layer.getLatLngs(), 'Edit');

    this._fireVertexAdded(
      newM,
      L.PM.Utils.findDeepMarkerIndex(this._markers, newM).indexPath,
      latlng
    );

    if (this.options.snappable) {
      this._initSnappableMarkers();
    }
  },

  hasSelfIntersection() {
    // check for self intersection of the layer and return true/false
    const selfIntersection = kinks(this._layer.toGeoJSON(15));
    return selfIntersection.features.length > 0;
  },

  _handleSelfIntersectionOnVertexRemoval() {
    // check for selfintersection again (mainly to reset the style)
    const selfIntersection = this._handleLayerStyle(true);

    if (selfIntersection) {
      // reset coordinates
      this._layer.setLatLngs(this._coordsBeforeEdit);
      this._coordsBeforeEdit = null;

      // re-enable markers for the new coords
      this._initMarkers();
    }
  },

  _handleLayerStyle(flash) {
    const layer = this._layer;

    let selfIntersection;
    let intersection;
    if (this.options.allowSelfIntersection) {
      selfIntersection = false;
    } else {
      intersection = kinks(this._layer.toGeoJSON(15));
      selfIntersection = intersection.features.length > 0;
    }

    if (selfIntersection) {
      if (
        !this.options.allowSelfIntersection &&
        this.options.allowSelfIntersectionEdit
      ) {
        this._updateDisabledMarkerStyle(this._markers, true);
      }

      if (this.isRed) {
        return selfIntersection;
      }

      // if it does self-intersect, mark or flash it red
      if (flash) {
        this._flashLayer();
      } else {
        layer.setStyle({ color: '#f00000ff' });
        this.isRed = true;
      }

      // fire intersect event
      this._fireIntersect(intersection);
    } else {
      // if not, reset the style to the default color
      layer.setStyle({ color: this.cachedColor });
      this.isRed = false;
      if (
        !this.options.allowSelfIntersection &&
        this.options.allowSelfIntersectionEdit
      ) {
        this._updateDisabledMarkerStyle(this._markers, false);
      }
    }
    return selfIntersection;
  },
  _flashLayer() {
    if (!this.cachedColor) {
      this.cachedColor = this._layer.options.color;
    }

    this._layer.setStyle({ color: '#f00000ff' });
    this.isRed = true;

    window.setTimeout(() => {
      this._layer.setStyle({ color: this.cachedColor });
      this.isRed = false;
    }, 200);
  },
  _updateDisabledMarkerStyle(markers, disabled) {
    markers.forEach((marker) => {
      if (Array.isArray(marker)) {
        this._updateDisabledMarkerStyle(marker, disabled);
      } else if (marker && marker._icon) {
        if (disabled && !this._checkMarkerAllowedToDrag(marker)) {
          L.DomUtil.addClass(marker._icon, 'vertexmarker-disabled');
        } else {
          L.DomUtil.removeClass(marker._icon, 'vertexmarker-disabled');
        }
      }
    });
  },
  _removeMarker(e) {
    // the marker that should be removed
    const marker = e.target;

    if (!this._vertexValidation('remove', e)) {
      return;
    }

    // if self intersection isn't allowed, save the coords upon dragstart
    // in case we need to reset the layer
    if (!this.options.allowSelfIntersection) {
      this._coordsBeforeEdit = copyLatLngs(
        this._layer,
        this._layer.getLatLngs()
      );
    }

    // coords of the layer
    let coords = this._layer.getLatLngs();

    // the index path to the marker inside the multidimensional marker array
    const { indexPath, index, parentPath } = L.PM.Utils.findDeepMarkerIndex(
      this._markers,
      marker
    );

    // only continue if this is NOT a middle marker (those can't be deleted)
    if (!indexPath) {
      return;
    }

    // define the coordsRing that is edited
    const coordsRing = indexPath.length > 1 ? get(coords, parentPath) : coords;

    // define the markers array that is edited
    let markerArr =
      indexPath.length > 1 ? get(this._markers, parentPath) : this._markers;

    // define whether marker is part of hole
    const isHole =
      parentPath[parentPath.length - 1] > 0 && this._layer instanceof L.Polygon;

    // prevent removal of the layer if the vertex count is below minimum when not a hole
    if (!this.options.removeLayerBelowMinVertexCount && !isHole) {
      // if on a line only 2 vertices left or on a polygon 3 vertices left, don't allow to delete
      if (
        coordsRing.length <= 2 ||
        (this.isPolygon() && coordsRing.length <= 3)
      ) {
        this._flashLayer();
        return;
      }
    }

    // remove coordinate
    coordsRing.splice(index, 1);

    // set new latlngs to the polygon
    this._layer.setLatLngs(coords);

    // if a polygon has less than 3 vertices, remove all of them. We will remove only one here, the if-clause after that will handle the rest
    if (this.isPolygon() && coordsRing.length <= 2) {
      coordsRing.splice(0, coordsRing.length);
    }

    let layerRemoved = false;
    // if the ring of the line has no coordinates left, remove the last coord too
    if (coordsRing.length <= 1) {
      coordsRing.splice(0, coordsRing.length);

      // Clean up MultiPolygon
      if (parentPath.length > 1 && indexPath.length > 1) {
        coords = removeEmptyCoordRings(coords);
      }

      // set new coords
      this._layer.setLatLngs(coords);

      // re-enable editing so unnecessary markers are removed
      this._initMarkers();
      layerRemoved = true;
    }

    // if no coords are left, remove the layer
    if (!hasValues(coords)) {
      this._layer.remove();
      // fire pm:remove so the removal is tracked (undoable) and listeners
      // are notified - a plain remove() would make the layer vanish silently
      this._fireRemove(this._layer);
      this._fireRemove(this._map, this._layer);
    }

    // remove all empty coord-rings
    coords = removeEmptyCoordRings(coords);
    this._layer.setLatLngs(coords);
    // remove empty marker arrays
    this._markers = removeEmptyCoordRings(this._markers);

    // No need to calculate the middle marker when the layer was removed
    if (!layerRemoved) {
      // get new markerArr because we cleaned up coords and markers array
      markerArr =
        indexPath.length > 1 ? get(this._markers, parentPath) : this._markers;

      // now handle the middle markers
      // remove the marker and the middlemarkers next to it from the map
      if (marker._middleMarkerPrev) {
        this._markerGroup.removeLayer(marker._middleMarkerPrev);
        this._removeFromCache(marker._middleMarkerPrev);
        marker._middleMarkerPrev._pmRemoved = true; // issue #366 viewport culling
      }
      if (marker._middleMarkerNext) {
        this._markerGroup.removeLayer(marker._middleMarkerNext);
        this._removeFromCache(marker._middleMarkerNext);
        marker._middleMarkerNext._pmRemoved = true; // issue #366 viewport culling
      }

      // remove the marker from the map
      this._markerGroup.removeLayer(marker);
      this._removeFromCache(marker);
      marker._pmRemoved = true; // issue #366 viewport culling

      if (markerArr) {
        let rightMarkerIndex;
        let leftMarkerIndex;

        if (this.isPolygon()) {
          // find neighbor marker-indexes
          rightMarkerIndex = (index + 1) % markerArr.length;
          leftMarkerIndex = (index + (markerArr.length - 1)) % markerArr.length;
        } else {
          // find neighbor marker-indexes
          leftMarkerIndex = index - 1 < 0 ? undefined : index - 1;
          rightMarkerIndex =
            index + 1 >= markerArr.length ? undefined : index + 1;
        }

        // don't create middlemarkers if there is only one marker left
        if (rightMarkerIndex !== leftMarkerIndex) {
          const leftM = markerArr[leftMarkerIndex];
          const rightM = markerArr[rightMarkerIndex];
          if (
            this.options.hideMiddleMarkers !== true &&
            leftM &&
            rightM &&
            leftM.getLatLng &&
            rightM.getLatLng
          ) {
            this._createMiddleMarker(leftM, rightM);
          }
        }

        // remove the marker from the markers array
        markerArr.splice(index, 1);
      }
    }

    // fire edit event
    this._fireEdit();
    this._layerEdited = true;

    // fire vertex removal event
    // TODO: maybe fire latlng as well?
    this._fireVertexRemoved(marker, indexPath);
    this._fireChange(this._layer.getLatLngs(), 'Edit');
  },
  updatePolygonCoordsFromMarkerDrag(marker) {
    // update polygon coords
    const coords = this._layer.getLatLngs();

    // get marker latlng
    const latlng = marker.getLatLng();

    // get indexPath of Marker
    const { indexPath, index, parentPath } = L.PM.Utils.findDeepMarkerIndex(
      this._markers,
      marker
    );

    // update coord
    const parent = indexPath.length > 1 ? get(coords, parentPath) : coords;
    // Can be removed after https://github.com/Leaflet/Leaflet/issues/9689 is fixed
    latlng.alt = parent[index].alt;
    parent.splice(index, 1, latlng);

    // simplified rings: let the hidden (marker-less) vertices follow the
    // drag with linear interpolation between the dragged vertex and its
    // next shown neighbors
    if (marker._pmSimplified && this._simplifyDragStart) {
      const markerArr =
        indexPath.length > 1 ? get(this._markers, parentPath) : this._markers;
      const origRing =
        indexPath.length > 1
          ? get(this._simplifyDragStart.coords, parentPath)
          : this._simplifyDragStart.coords;
      this._interpolateHiddenVertices(
        parent,
        origRing,
        markerArr,
        index,
        this._simplifyDragStart.latlng,
        latlng
      );
    }

    // set new coords on layer
    this._layer.setLatLngs(coords);
  },

  // moves the hidden vertices (the `{}` placeholders in the marker array)
  // between the dragged vertex and its next shown neighbors along with the
  // drag, weighted by their relative position (0 at the neighbor, 1 at the
  // dragged vertex)
  _interpolateHiddenVertices(
    coordsRing,
    origRing,
    markerArr,
    index,
    dragStartLatLng,
    dragLatLng
  ) {
    const ringLen = markerArr.length;
    const dLat = dragLatLng.lat - dragStartLatLng.lat;
    const dLng = dragLatLng.lng - dragStartLatLng.lng;
    const isShown = (m) => m && typeof m.getLatLng === 'function';

    // find the next shown marker left / right of the dragged one
    // (wrapping around on polygons)
    const findShown = (direction) => {
      for (let i = 1; i < ringLen; i += 1) {
        const raw = index + direction * i;
        if (raw < 0 || raw >= ringLen) {
          if (!this.isPolygon()) return -1; // no wrap on open lines
        }
        const idx = (raw + ringLen * 2) % ringLen;
        if (idx === index) return -1; // full circle, no other shown marker
        if (isShown(markerArr[idx])) {
          return idx;
        }
      }
      return -1;
    };
    const prevShown = findShown(-1);
    const nextShown = findShown(1);

    // walks from the dragged vertex towards `neighborIdx` (exclusive) in
    // path order and moves the hidden vertices along with the drag. The
    // movement is weighted by the path distance on the original geometry:
    // vertices close to the dragged one follow almost completely, vertices
    // further down the line move less - the drag "travels" along the line
    // and fades out at the next shown vertex
    const interpolateTowards = (neighborIdx, step) => {
      if (neighborIdx === -1 || neighborIdx === index) return;

      // hidden vertex indices in path order, starting next to the dragged one
      const idxs = [];
      for (let k = 1; k < ringLen; k += 1) {
        const idx = (index + step * k + ringLen * 2) % ringLen;
        if (idx === neighborIdx || idx === index) break;
        idxs.push(idx);
      }
      if (!idxs.length) return;

      // cumulative path distance from the dragged vertex, measured on the
      // original (pre-drag) coordinates
      const origDist = (a, b) =>
        origRing[a] && origRing[b] ? origRing[a].distanceTo(origRing[b]) : 0;
      let cumulative = 0;
      const cumAt = idxs.map((idx, i) => {
        const from = i === 0 ? index : idxs[i - 1];
        cumulative += origDist(from, idx);
        return cumulative;
      });
      // include the closing segment up to the shown neighbor
      const total = cumulative + origDist(idxs[idxs.length - 1], neighborIdx);
      if (total <= 0) return; // coincident vertices, nothing to weight

      idxs.forEach((idx, i) => {
        if (isShown(markerArr[idx])) return; // follows its own marker
        const orig = origRing[idx];
        if (!orig) return;
        const w = 1 - cumAt[i] / total;
        coordsRing[idx] = L.latLng(
          orig.lat + dLat * w,
          orig.lng + dLng * w,
          orig.alt
        );
      });
    };

    interpolateTowards(prevShown, -1);
    interpolateTowards(nextShown, 1);
  },

  _getNeighborMarkers(marker) {
    const { indexPath, index, parentPath } = L.PM.Utils.findDeepMarkerIndex(
      this._markers,
      marker
    );

    // the markers neighbors
    const markerArr =
      indexPath.length > 1 ? get(this._markers, parentPath) : this._markers;

    // find the indizes of next and previous markers
    const nextMarkerIndex = (index + 1) % markerArr.length;
    const prevMarkerIndex = (index + (markerArr.length - 1)) % markerArr.length;

    // get prev and next marker
    const prevMarker = markerArr[prevMarkerIndex];
    const nextMarker = markerArr[nextMarkerIndex];

    // `{}` placeholders on simplified rings have no latlng
    if (!prevMarker?.getLatLng || !nextMarker?.getLatLng) {
      return { prevMarker: undefined, nextMarker: undefined };
    }

    return { prevMarker, nextMarker };
  },
  _checkMarkerAllowedToDrag(marker) {
    const { prevMarker, nextMarker } = this._getNeighborMarkers(marker);

    // neighbors are `{}` placeholders on a simplified ring (issue #366) -
    // there's no real edge to check, so don't block the drag
    if (!prevMarker || !nextMarker) {
      return true;
    }

    const prevLine = L.polyline([prevMarker.getLatLng(), marker.getLatLng()]);
    const nextLine = L.polyline([marker.getLatLng(), nextMarker.getLatLng()]);

    const prevLineIntersection = lineIntersect(
      this._layer.toGeoJSON(15),
      prevLine.toGeoJSON(15)
    );

    // Filter out intersections that are the markers themselves
    const prevLineIntersectionLen = prevLineIntersection.features.filter(
      (f) => {
        const coords = f.geometry.coordinates;
        const latlng = L.latLng(coords[1], coords[0]);
        return (
          !latlng.equals(prevMarker.getLatLng()) &&
          !latlng.equals(marker.getLatLng())
        );
      }
    ).length;

    const nextLineIntersection = lineIntersect(
      this._layer.toGeoJSON(15),
      nextLine.toGeoJSON(15)
    );

    // Filter out intersections that are the markers themselves
    const nextLineIntersectionLen = nextLineIntersection.features.filter(
      (f) => {
        const coords = f.geometry.coordinates;
        const latlng = L.latLng(coords[1], coords[0]);
        return (
          !latlng.equals(nextMarker.getLatLng()) &&
          !latlng.equals(marker.getLatLng())
        );
      }
    ).length;

    if (prevLineIntersectionLen < 1 && nextLineIntersectionLen < 1) {
      return false;
    }
    return true;
  },
  _onMarkerDragStart(e) {
    const marker = e.target;
    this._preventRenderingMarkers(true);

    // When intersection is true while calling enable(), the cachedColor is already set
    if (!this.cachedColor) {
      this.cachedColor = this._layer.options.color;
    }

    if (!this._vertexValidation('move', e)) {
      return;
    }

    const { indexPath } = L.PM.Utils.findDeepMarkerIndex(this._markers, marker);

    this._fireMarkerDragStart(e, indexPath);

    // if self intersection isn't allowed, save the coords upon dragstart
    // in case we need to reset the layer
    if (!this.options.allowSelfIntersection) {
      this._coordsBeforeEdit = copyLatLngs(
        this._layer,
        this._layer.getLatLngs()
      );
    }

    // simplified rings: remember the original position so the hidden
    // vertices can follow the drag by linear interpolation
    this._simplifyDragStart = marker._pmSimplified
      ? {
          latlng: marker.getLatLng().clone(),
          coords: copyLatLngs(this._layer, this._layer.getLatLngs()),
        }
      : null;

    if (
      !this.options.allowSelfIntersection &&
      this.options.allowSelfIntersectionEdit &&
      this.hasSelfIntersection()
    ) {
      this._markerAllowedToDrag = this._checkMarkerAllowedToDrag(marker);
    } else {
      this._markerAllowedToDrag = null;
    }
  },
  _onMarkerDrag(e) {
    // dragged marker
    const marker = e.target;

    if (!this._vertexValidationDrag(marker)) {
      return;
    }

    const { indexPath, index, parentPath } = L.PM.Utils.findDeepMarkerIndex(
      this._markers,
      marker
    );

    // only continue if this is NOT a middle marker
    if (!indexPath) {
      return;
    }

    if (
      !this.options.allowSelfIntersection &&
      this.options.allowSelfIntersectionEdit &&
      this.hasSelfIntersection() &&
      this._markerAllowedToDrag === false
    ) {
      this._layer.setLatLngs(this._coordsBeforeEdit);
      // re-enable markers for the new coords
      this._initMarkers();
      // check for selfintersection again (mainly to reset the style)
      this._handleLayerStyle();
      return;
    }

    this.updatePolygonCoordsFromMarkerDrag(marker);

    // the dragged markers neighbors
    const markerArr =
      indexPath.length > 1 ? get(this._markers, parentPath) : this._markers;

    // find the indizes of next and previous markers
    const nextMarkerIndex = (index + 1) % markerArr.length;
    const prevMarkerIndex = (index + (markerArr.length - 1)) % markerArr.length;

    // update middle markers on the left and right
    // be aware that "next" and "prev" might be interchanged, depending on the geojson array
    const markerLatLng = marker.getLatLng();

    // get latlng of prev and next marker (may be `{}` placeholders on
    // simplified rings - then there are no middle markers anyway)
    const prevMarker = markerArr[prevMarkerIndex];
    const nextMarker = markerArr[nextMarkerIndex];
    const prevMarkerLatLng =
      prevMarker && prevMarker.getLatLng ? prevMarker.getLatLng() : null;
    const nextMarkerLatLng =
      nextMarker && nextMarker.getLatLng ? nextMarker.getLatLng() : null;

    if (marker._middleMarkerNext && nextMarkerLatLng) {
      const middleMarkerNextLatLng = L.PM.Utils.calcMiddleLatLng(
        this._map,
        markerLatLng,
        nextMarkerLatLng
      );
      marker._middleMarkerNext.setLatLng(middleMarkerNextLatLng);
    }

    if (marker._middleMarkerPrev) {
      const middleMarkerPrevLatLng = L.PM.Utils.calcMiddleLatLng(
        this._map,
        markerLatLng,
        prevMarkerLatLng
      );
      marker._middleMarkerPrev.setLatLng(middleMarkerPrevLatLng);
    }

    // if self intersection is not allowed, handle it
    if (!this.options.allowSelfIntersection) {
      this._handleLayerStyle();
    }
    this._fireMarkerDrag(e, indexPath);
    this._fireChange(this._layer.getLatLngs(), 'Edit');
  },
  /**
   * Measurements: lengths of the two segments adjacent to the dragged
   * vertex, shown instead of the single segment row while dragging.
   * Polygons always have both neighbors; on open lines the ends only have
   * one.
   */
  _vertexSegmentDistances(marker) {
    if (!marker || !this._map) {
      return undefined;
    }
    const { indexPath, parentPath } = L.PM.Utils.findDeepMarkerIndex(
      this._markers,
      marker
    );
    if (!indexPath) {
      return undefined;
    }
    const markerArr =
      indexPath.length > 1 ? get(this._markers, parentPath) : this._markers;
    if (!markerArr || markerArr.length < 2) {
      return undefined;
    }
    const i = markerArr.indexOf(marker);
    if (i === -1) {
      return undefined;
    }
    const { length } = markerArr;
    const distanceTo = (other) =>
      other && other.getLatLng
        ? this._map.distance(marker.getLatLng(), other.getLatLng())
        : undefined;
    const before =
      this.isPolygon() || i !== 0
        ? distanceTo(markerArr[(i - 1 + length) % length])
        : undefined;
    const after =
      this.isPolygon() || i !== length - 1
        ? distanceTo(markerArr[(i + 1) % length])
        : undefined;
    return { before, after };
  },
  _onMarkerDragEnd(e) {
    const marker = e.target;
    this._preventRenderingMarkers(false);
    this._simplifyDragStart = null;

    if (!this._vertexValidationDragEnd(marker)) {
      return;
    }

    const { indexPath } = L.PM.Utils.findDeepMarkerIndex(this._markers, marker);

    // if self intersection is not allowed but this edit caused a self intersection,
    // reset and cancel; do not fire events
    let intersection =
      !this.options.allowSelfIntersection && this.hasSelfIntersection();
    if (
      intersection &&
      this.options.allowSelfIntersectionEdit &&
      this._markerAllowedToDrag
    ) {
      intersection = false;
    }

    const intersectionReset =
      !this.options.allowSelfIntersection && intersection;

    this._fireMarkerDragEnd(e, indexPath, intersectionReset);

    if (intersectionReset) {
      // reset coordinates
      this._layer.setLatLngs(this._coordsBeforeEdit);
      this._coordsBeforeEdit = null;

      // re-enable markers for the new coords
      this._initMarkers();

      if (this.options.snappable) {
        this._initSnappableMarkers();
      }

      // check for selfintersection again (mainly to reset the style)
      this._handleLayerStyle();

      this._fireLayerReset(e, indexPath);
      return;
    }
    if (
      !this.options.allowSelfIntersection &&
      this.options.allowSelfIntersectionEdit
    ) {
      this._handleLayerStyle();
    }
    // fire edit event
    this._fireEdit();
    this._layerEdited = true;
    this._fireChange(this._layer.getLatLngs(), 'Edit');

    // deferred marker rebuild (zoom happened below the drag)
    if (this._needsMarkerRebuild) {
      this._needsMarkerRebuild = false;
      this._onZoomEndRebuildMarkers();
    }
  },
  _onVertexClick(e) {
    const vertex = e.target;
    if (vertex._dragging) {
      return;
    }

    const { indexPath } = L.PM.Utils.findDeepMarkerIndex(this._markers, vertex);

    this._fireVertexClick(e, indexPath);
  },
});
