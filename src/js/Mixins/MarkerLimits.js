const MarkerLimits = {
  filterMarkerGroup() {
    // define cache of markers
    this.markerCache = [];
    this.createCache();

    // refresh cache when layer was edited (e.g. when a vertex was added or removed)
    this._layer.on('pm:edit', this.createCache, this);

    // apply filter for the first time
    this.applyLimitFilters({});

    if (!this.throttledApplyLimitFilters) {
      this.throttledApplyLimitFilters = L.Util.throttle(
        this.applyLimitFilters,
        100,
        this
      );
    }

    // remove events when edit mode is disabled
    this._layer.on('pm:disable', this._removeMarkerLimitEvents, this);
    this._layer.on('remove', this._removeMarkerLimitEvents, this);

    // add markers closest to the mouse
    if (this.options.limitMarkersToCount > -1) {
      // re-init markers when a vertex is removed.
      // The reason is that syncing this cache with a removed marker was impossible to do
      this._layer.on('pm:vertexremoved', this._initMarkers, this);

      this._map.on('mousemove', this.throttledApplyLimitFilters, this);
    }
  },
  _removeMarkerLimitEvents() {
    this._map.off('mousemove', this.throttledApplyLimitFilters, this);
    this._layer.off('pm:edit', this.createCache, this);
    this._layer.off('pm:disable', this._removeMarkerLimitEvents, this);
    this._layer.off('pm:vertexremoved', this._initMarkers, this);
  },
  createCache() {
    // issue #366: the cache must contain ALL markers, including the ones
    // currently not attached to the map because of the viewport culling
    const groupLayers = this._markerGroup.getLayers();
    let allMarkers = groupLayers;
    if (this._allEditMarkers) {
      const detached = this._allEditMarkers.filter(
        (marker) => !groupLayers.includes(marker) && !marker._pmRemoved
      );
      allMarkers = groupLayers.concat(detached);
    }
    allMarkers = [...allMarkers, ...this.markerCache];
    this.markerCache = allMarkers.filter((v, i, s) => s.indexOf(v) === i);
  },
  _removeFromCache(marker) {
    const markerCacheIndex = this.markerCache.indexOf(marker);
    if (markerCacheIndex > -1) {
      this.markerCache.splice(markerCacheIndex, 1);
    }
  },
  renderLimits(markers) {
    this.markerCache.forEach((l) => {
      if (markers.includes(l)) {
        this._markerGroup.addLayer(l);
      } else {
        this._markerGroup.removeLayer(l);
      }
    });
  },
  applyLimitFilters({ latlng = { lat: 0, lng: 0 } }) {
    if (this._preventRenderMarkers) {
      return;
    }
    // find markers near the cursor
    const makersNearCursor = this._filterClosestMarkers(latlng);

    // all markers that we want to show
    const markersToAdd = [...makersNearCursor];

    this.renderLimits(markersToAdd);
  },
  _filterClosestMarkers(latlng) {
    const markers = [...this.markerCache];
    const limit = this.options.limitMarkersToCount;

    if (limit === -1) {
      // no count limit: the viewport culling (issue #366) decides which
      // markers are attached, keep the current state
      return this._markerGroup.getLayers();
    }

    // sort markers by distance to cursor
    markers.sort((l, t) => {
      const distanceA = l._latlng.distanceTo(latlng);
      const distanceB = t._latlng.distanceTo(latlng);

      return distanceA - distanceB;
    });

    // reduce markers to number of limit
    const closest = markers.filter((l, i) => (limit > -1 ? i < limit : true));

    return closest;
  },
  _preventRenderMarkers: false,
  _preventRenderingMarkers(value) {
    this._preventRenderMarkers = !!value;
  },
};

export default MarkerLimits;
