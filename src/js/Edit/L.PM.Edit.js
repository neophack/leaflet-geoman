import SnapMixin from '../Mixins/Snapping';
import SnapGuidesMixin from '../Mixins/SnapGuides';
import GeofencingMixin from '../Mixins/Geofencing';
import PinningMixin from '../Mixins/Pinning';
import DragMixin from '../Mixins/Dragging';
import RotateMixin from '../Mixins/Rotating';
import ScaleMixin from '../Mixins/Scaling';
import EventMixin from '../Mixins/Events';

const Edit = L.Class.extend({
  includes: [
    DragMixin,
    SnapMixin,
    SnapGuidesMixin,
    GeofencingMixin,
    PinningMixin,
    RotateMixin,
    ScaleMixin,
    EventMixin,
  ],
  options: {
    snappable: true, // TODO: next major Release, rename it to allowSnapping
    snapDistance: 20,
    allowSelfIntersection: true,
    allowSelfIntersectionEdit: false,
    preventMarkerRemoval: false,
    removeLayerBelowMinVertexCount: true,
    // Geofencing: arrays of other layers this layer
    // must not intersect / must be contained within - see Mixins/Geofencing.js
    preventIntersection: [],
    requireContainment: [],
    limitMarkersToCount: -1,
    // issue #366: only render edit markers in the viewport (huge win for
    // layers with thousands of vertices). Only active when
    // limitMarkersToCount === -1
    limitMarkersToViewport: true,
    hideMiddleMarkers: false,
    // rings with more vertices than this get a decimated subset of vertex
    // markers when editing; hidden vertices follow a drag weighted by their
    // path distance on the line. 0 / -1 disables
    simplifyEditMarkers: 100,
    // minimum screen distance in pixels between two shown edit markers on a
    // simplified ring - zooming in shows more markers (finer editing),
    // zooming out shows fewer
    simplifyEditMarkersSpacing: 40,
    // hard cap of shown edit markers per ring, so even the deepest zoom
    // can't recreate thousands of markers
    simplifyEditMarkersMax: 1000,
    snapSegment: true,
    syncLayersOnDrag: false,
    draggable: true, // TODO: next major Release, rename it to allowDragging
    allowEditing: true, // disable all interactions on a layer which are activated with `enable()`. For example a Circle can't be dragged in Edit-Mode
    allowRemoval: true,
    allowCutting: true,
    allowRotation: true,
    allowScaling: true,
    // Split API: `splitMark: false` excludes the layer from Split
    // Mode, `splitMark: true` opts it in when the mode runs with
    // `splitOnlyMarkedLayers` (see Draw/L.PM.Draw.Split)
    splitMark: undefined,
    // Lasso API: `lassoSelectable: false` excludes the layer from
    // lasso selections
    lassoSelectable: undefined,
    allowPinning: true,
    addVertexOn: 'click',
    removeVertexOn: 'contextmenu',
    removeVertexValidation: undefined,
    addVertexValidation: undefined,
    moveVertexValidation: undefined,
    resizeableCircleMarker: false,
    resizeableCircle: true,
    snapMiddle: false,
    snapVertex: true,
  },
  setOptions(options) {
    L.Util.setOptions(this, options);
  },
  getOptions() {
    return this.options;
  },
  applyOptions() {},
  isPolygon() {
    // if it's a polygon, it means the coordinates array is multi dimensional
    return this._layer instanceof L.Polygon;
  },
  getShape() {
    return this._shape;
  },
  /**
   * Issue #366: layers with many vertices are rendered with a simplified /
   * viewport culled subset. This returns the full untouched coordinates.
   */
  getFullLatLngs() {
    const mapPm = (this._map || this._layer?._map)?.pm;
    if (mapPm && typeof mapPm._fullLatLngsOf === 'function') {
      return mapPm._fullLatLngsOf(this._layer);
    }
    return this._layer.getLatLngs();
  },
  /** the coordinates the layer is currently rendered with */
  getRenderedLatLngs() {
    return this._layer.getLatLngs();
  },
  /**
   * Categories: the category of the layer ("river", "house", ...).
   * The style of the category (map.pm.setCategory) is applied if registered.
   *
   * GeoJSON has no native concept of a category, so it's mirrored onto
   * `layer.feature.properties.pmCategory`: `layer.toGeoJSON()` then exports
   * it for free, and a layer created from GeoJSON that already carries that
   * property (f.ex. via `L.geoJSON(data)`) is picked up here on first read -
   * no explicit `setCategory()` call needed to restore it.
   */
  getCategory() {
    if (this._category === undefined) {
      const props =
        this._layer && this._layer.feature && this._layer.feature.properties;
      if (props && props.pmCategory) {
        this._category = props.pmCategory;
      }
    }
    return this._category;
  },
  setCategory(name, options = {}) {
    const oldCategory = this.getCategory();
    this._category = name || undefined;
    if (this._layer) {
      if (this._category) {
        this._layer.feature = this._layer.feature || {
          type: 'Feature',
          properties: {},
        };
        this._layer.feature.properties = this._layer.feature.properties || {};
        this._layer.feature.properties.pmCategory = this._category;
      } else if (this._layer.feature && this._layer.feature.properties) {
        delete this._layer.feature.properties.pmCategory;
      }
    }
    // `this._map` is only set after enable(), but the layer always knows its map
    const mapRef = this._map || this._layer._map;
    if (mapRef?.pm?._applyCategoryStyle && this._category) {
      mapRef.pm._applyCategoryStyle(this._layer, this._category);
    }
    if (!options.silent && oldCategory !== this._category) {
      this._fireCategoryChange(this._layer, oldCategory, this._category);
      if (mapRef) {
        this._fireCategoryChange(mapRef, oldCategory, this._category);
      }
    }
  },
  /**
   * Selection: click a Geoman-tracked layer to select it - every other
   * tracked layer fades to 40% opacity (map.pm._dimLayer), the selected
   * layer itself is left untouched. See Mixins/Selection.js for the
   * map-level bookkeeping this delegates to.
   */
  isSelected() {
    return !!this._selected;
  },
  select() {
    const mapRef = this._map || (this._layer && this._layer._map);
    if (
      mapRef &&
      mapRef.pm &&
      typeof mapRef.pm._setSelectedLayer === 'function'
    ) {
      mapRef.pm._setSelectedLayer(this._layer);
    }
  },
  unselect() {
    const mapRef = this._map || (this._layer && this._layer._map);
    if (
      mapRef &&
      mapRef.pm &&
      typeof mapRef.pm._removeSelectedLayer === 'function' &&
      mapRef.pm.getSelectedLayers().includes(this._layer)
    ) {
      mapRef.pm._removeSelectedLayer(this._layer);
    }
  },
  // bound as the layer's 'click' handler by every Edit.* subclass
  /**
   * Selection & re-categorize clicks are bound on the layer's DOM element
   * instead of as a Leaflet event: a layer that listens to 'click' consumes
   * the event in Leaflet's routing and the map never receives it as a
   * fallback target (`Map._findEventTargets`) - drawing / cutting on top of
   * existing layers would be impossible. A plain DOM listener is invisible
   * to that routing, so while a mode is active the click simply bubbles to
   * the map like a click on empty space.
   */
  _initSelectionClick() {
    // geoman's own helper layers (vertex / middle / hint markers, lasso,
    // highlights) must never consume clicks - their interaction is driven
    // by Leaflet events routed through the map container
    if (this._layer._pmTempLayer) {
      return;
    }
    this._layer.on('add', this._bindSelectionDomClick, this);
    if (this._layer._map) {
      this._bindSelectionDomClick();
    }
  },
  _bindSelectionDomClick() {
    if (this._layer._pmTempLayer || this._selectionDomElement) {
      return;
    }
    const element = this._layer.getElement ? this._layer.getElement() : null;
    if (!element) {
      // canvas rendered paths have no individual element - the click
      // selection is not available for them
      return;
    }
    this._selectionDomElement = element;
    L.DomEvent.on(element, 'click', this._onSelectionDomClick, this);
  },
  _onSelectionDomClick(e) {
    const mapRef = this._map || (this._layer && this._layer._map);
    if (!mapRef || !mapRef.pm) {
      return;
    }
    // while a mode is active the click belongs to the mode - let it bubble
    // to the map
    if (mapRef.pm._isAnyGlobalModeActive()) {
      return;
    }
    // mark the DOM event instead of stopping propagation: Leaflet keeps
    // routing it (the layer's own 'click' listeners and the map fallback
    // still run - stopping it would break drawing over layers and user
    // listeners), while the map's deselect handler recognizes the flag
    e._pmLayerClick = true;
    // Ctrl/Cmd+click while a category is active stamps that category (and
    // its style) onto the clicked layer instead of selecting it - a quick
    // way to re-categorize existing layers without redrawing them.
    if (e.ctrlKey || e.metaKey) {
      const activeCategory = mapRef.pm.getActiveCategory();
      if (activeCategory) {
        this.setCategory(activeCategory);
        return;
      }
    }
    if (!mapRef.pm.globalOptions.selectableLayers) {
      return;
    }
    this.select();
  },
  _setPane(layer, type) {
    if (type === 'layerPane') {
      layer.options.pane =
        (this._map.pm.globalOptions.panes &&
          this._map.pm.globalOptions.panes.layerPane) ||
        'overlayPane';
    } else if (type === 'vertexPane') {
      layer.options.pane =
        (this._map.pm.globalOptions.panes &&
          this._map.pm.globalOptions.panes.vertexPane) ||
        'markerPane';
    } else if (type === 'markerPane') {
      layer.options.pane =
        (this._map.pm.globalOptions.panes &&
          this._map.pm.globalOptions.panes.markerPane) ||
        'markerPane';
    }
  },
  remove() {
    const map = this._map || this._layer._map;
    map.pm.removeLayer({ target: this._layer });
  },
  _vertexValidation(type, e) {
    const marker = e.target;
    const args = { layer: this._layer, marker, event: e };

    let validationFnc = '';
    if (type === 'move') {
      validationFnc = 'moveVertexValidation';
    } else if (type === 'add') {
      validationFnc = 'addVertexValidation';
    } else if (type === 'remove') {
      validationFnc = 'removeVertexValidation';
    }

    // if validation goes wrong, we return false
    if (
      this.options[validationFnc] &&
      typeof this.options[validationFnc] === 'function' &&
      !this.options[validationFnc](args)
    ) {
      if (type === 'move') {
        marker._cancelDragEventChain = marker.getLatLng();
      }
      return false;
    }

    marker._cancelDragEventChain = null;
    return true;
  },
  _vertexValidationDrag(marker) {
    // we reset the marker to the place before it was dragged. We need this, because we can't stop the drag process in a `dragstart` | `movestart` listener
    if (marker._cancelDragEventChain) {
      marker._latlng = marker._cancelDragEventChain;
      marker.update();
      return false;
    }
    return true;
  },
  _vertexValidationDragEnd(marker) {
    if (marker._cancelDragEventChain) {
      marker._cancelDragEventChain = null;
      return false;
    }
    return true;
  },
});

export default Edit;
