import merge from 'lodash/merge';
import SnapMixin from '../Mixins/Snapping';
import SnapGuidesMixin from '../Mixins/SnapGuides';
import GeofencingMixin from '../Mixins/Geofencing';
import EventMixin from '../Mixins/Events';

const Draw = L.Class.extend({
  includes: [SnapMixin, SnapGuidesMixin, GeofencingMixin, EventMixin],
  options: {
    snappable: true, // TODO: next major Release, rename it to allowSnapping
    snapDistance: 20,
    snapMiddle: false,
    allowSelfIntersection: true,
    tooltips: true,
    templineStyle: {},
    hintlineStyle: {
      color: '#3388ff',
      dashArray: '5,5',
    },
    pathOptions: null,
    cursorMarker: true,
    finishOn: null,
    markerStyle: {
      draggable: true,
      icon: L.icon(),
    },
    hideMiddleMarkers: false,
    minRadiusCircle: null,
    maxRadiusCircle: null,
    minRadiusCircleMarker: null,
    maxRadiusCircleMarker: null,
    resizeableCircleMarker: false,
    resizeableCircle: true,
    markerEditable: true,
    continueDrawing: false,
    snapSegment: true,
    requireSnapToFinish: false,
    rectangleAngle: 0,
    textOptions: {
      text: null,
      focusAfterDraw: null,
      removeIfEmpty: null,
      className: null,
    },
    snapVertex: true,
    autoTrace: false,
    snapTo90: false,
    snapTo90Tolerance: 5,
    // Geofencing: arrays of other layers the new layer
    // must not intersect / must be contained within - see Mixins/Geofencing.js
    preventIntersection: [],
    requireContainment: [],
  },
  setOptions(options) {
    L.Util.setOptions(this, options);
    this.setStyle(this.options);
  },
  setStyle() {},
  getOptions() {
    return this.options;
  },
  /**
   * Measurements: shows a live measurement tooltip at the
   * cursor while drawing. Called from Events.js#_fireChange on every cursor
   * move / vertex change with the working latlngs (the cursor position is
   * already appended for Line / Polygon).
   */
  _updateMeasureTooltip(latlngs) {
    const pm = this._map?.pm;
    if (
      !this._hintMarker ||
      !pm ||
      typeof pm._measurementsEnabled !== 'function' ||
      !pm._measurementsEnabled()
    ) {
      return;
    }
    // Line / Polygon / Cut draws pass the placed vertices plus the cursor
    // position - measure a throwaway layer of the right type so polygons
    // close the ring. The other shapes keep `this._layer` up to date on
    // every move.
    let workingLayer = this._layer;
    if (['Line', 'Polygon', 'Cut', 'Freehand'].includes(this._shape)) {
      if (!Array.isArray(latlngs) || latlngs.length < 2) {
        return;
      }
      workingLayer =
        this._shape === 'Polygon' ? L.polygon(latlngs) : L.polyline(latlngs);
    }
    if (!workingLayer) {
      workingLayer = this._hintMarker;
    }
    pm.showMeasurementTooltip(workingLayer, this._hintMarker, this._shape);
  },
  initialize(map) {
    // Overwriting the default tooltipAnchor of the default Marker Icon, because the tooltip functionality was updated but not the anchor in the Icon
    // Issue https://github.com/Leaflet/Leaflet/issues/7302 - Leaflet v1.7.1
    const defaultIcon = new L.Icon.Default();
    defaultIcon.options.tooltipAnchor = [0, 0];
    this.options.markerStyle.icon = defaultIcon;

    // save the map
    this._map = map;

    // define all possible shapes that can be drawn
    this.shapes = [
      'Marker',
      'CircleMarker',
      'Line',
      'Polygon',
      'Rectangle',
      'Circle',
      'Cut',
      'Text',
      'Split',
      'Freehand',
      'Point',
      'Lasso',
    ];

    // initiate drawing class for our shapes
    this.shapes.forEach((shape) => {
      this[shape] = new L.PM.Draw[shape](this._map);
    });

    // TODO: Remove this with the next major release
    this.Marker.setOptions({ continueDrawing: true });
    this.CircleMarker.setOptions({ continueDrawing: true });
  },
  setPathOptions(options, mergeOptions = false) {
    if (!mergeOptions) {
      this.options.pathOptions = options;
    } else {
      this.options.pathOptions = merge(this.options.pathOptions, options);
    }
  },
  getShapes() {
    // if somebody wants to know what shapes are available
    return this.shapes;
  },
  getShape() {
    // return the shape of the current drawing layer
    return this._shape;
  },
  enable(shape, options) {
    if (!shape) {
      throw new Error(
        `Error: Please pass a shape as a parameter. Possible shapes are: ${this.getShapes().join(
          ','
        )}`
      );
    }

    // disable drawing for all shapes
    this.disable();

    // enable draw for a shape
    this[shape].enable(options);
  },
  disable() {
    // there can only be one drawing mode active at a time on a map
    // so it doesn't matter which one should be disabled.
    // just disable all of them
    this.shapes.forEach((shape) => {
      this[shape].disable();
    });
  },
  addControls() {
    // add control buttons for our shapes
    this.shapes.forEach((shape) => {
      this[shape].addButton();
    });
  },
  getActiveShape() {
    // returns the active shape
    let enabledShape;
    this.shapes.forEach((shape) => {
      if (this[shape]._enabled) {
        enabledShape = shape;
      }
    });
    return enabledShape;
  },
  _setGlobalDrawMode() {
    // extended to all PM.Draw shapes
    if (this._shape === 'Cut') {
      this._fireGlobalCutModeToggled();
    } else if (this._shape === 'Split') {
      this._fireGlobalSplitModeToggled();
    } else {
      this._fireGlobalDrawModeToggled();
    }

    const layers = [];
    this._map.eachLayer((layer) => {
      if (
        layer instanceof L.Polyline ||
        layer instanceof L.Marker ||
        layer instanceof L.Circle ||
        layer instanceof L.CircleMarker ||
        layer instanceof L.ImageOverlay
      ) {
        // filter out everything that's leaflet-geoman specific temporary stuff
        if (!layer._pmTempLayer) {
          layers.push(layer);
        }
      }
    });

    if (this._enabled) {
      layers.forEach((layer) => {
        L.PM.Utils.disablePopup(layer);
      });
    } else {
      layers.forEach((layer) => {
        L.PM.Utils.enablePopup(layer);
      });
    }
  },

  createNewDrawInstance(name, jsClass) {
    const instance = this._getShapeFromBtnName(jsClass);
    if (this[name]) {
      throw new TypeError('Draw Type already exists');
    }
    if (!L.PM.Draw[instance]) {
      throw new TypeError(`There is no class L.PM.Draw.${instance}`);
    }

    this[name] = new L.PM.Draw[instance](this._map);
    this[name].toolbarButtonName = name;
    this[name]._shape = name;
    this.shapes.push(name);

    // needed when extended / copied from a custom instance
    if (this[jsClass]) {
      this[name].setOptions(this[jsClass].options);
    }
    // Re-init the options, so it is not referenced with the default Draw class
    this[name].setOptions(this[name].options);

    return this[name];
  },
  _getShapeFromBtnName(name) {
    const shapeMapping = {
      drawMarker: 'Marker',
      drawCircle: 'Circle',
      drawPolygon: 'Polygon',
      drawPolyline: 'Line',
      drawRectangle: 'Rectangle',
      drawCircleMarker: 'CircleMarker',
      editMode: 'Edit',
      dragMode: 'Drag',
      cutPolygon: 'Cut',
      removalMode: 'Removal',
      rotateMode: 'Rotate',
      drawText: 'Text',
      splitMode: 'Split',
      drawFreehand: 'Freehand',
      drawPoint: 'Point',
    };

    if (shapeMapping[name]) {
      return shapeMapping[name];
    }
    return this[name] ? this[name]._shape : name;
  },
  _finishLayer(layer) {
    if (layer.pm) {
      // add the pm options from drawing to the new layer (edit)
      layer.pm.setOptions(this.options);
      // set the shape (can be a custom shape)
      layer.pm._shape = this._shape;
      // apply the map to the new created layer in the pm object
      layer.pm._map = this._map;
    }
    this._addDrawnLayerProp(layer);
  },
  _addDrawnLayerProp(layer) {
    layer._drawnByGeoman = true;
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
  _isFirstLayer() {
    const map = this._map || this._layer._map;
    return map.pm.getGeomanLayers().length === 0;
  },
});

export default Draw;
