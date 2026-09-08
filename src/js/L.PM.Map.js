import merge from 'lodash/merge';
import translations from '../assets/translations';
import GlobalEditMode from './Mixins/Modes/Mode.Edit';
import GlobalDragMode from './Mixins/Modes/Mode.Drag';
import GlobalRemovalMode from './Mixins/Modes/Mode.Removal';
import GlobalRotateMode from './Mixins/Modes/Mode.Rotate';
import GlobalUnionMode from './Mixins/Modes/Mode.Union';
import GlobalDifferenceMode from './Mixins/Modes/Mode.Difference';
import GlobalScaleMode from './Mixins/Modes/Mode.Scale';
import GlobalLassoMode from './Mixins/Modes/Mode.Lasso';
import GlobalCopyLayerMode from './Mixins/Modes/Mode.Copy';
import GlobalLineSimplificationMode from './Mixins/Modes/Mode.Simplify';
import GlobalOrderMode from './Mixins/Modes/Mode.Order';
import { MapPinningMixin } from './Mixins/Pinning';
import UndoMixin from './Mixins/Undo';
import MeasurementsMixin from './Mixins/Measurements';
import CategoriesMixin from './Mixins/Categories';
import SelectionMixin from './Mixins/Selection';
import LargeLayerRendering from './Mixins/LargeLayerRendering';
import EventMixin from './Mixins/Events';
import createKeyboardMixins from './Mixins/Keyboard';
import { getRenderer } from './helpers';
import { resolveLanguageCode } from './helpers/language';

const Map = L.Class.extend({
  includes: [
    GlobalEditMode,
    GlobalDragMode,
    GlobalRemovalMode,
    GlobalRotateMode,
    GlobalUnionMode,
    GlobalDifferenceMode,
    GlobalScaleMode,
    GlobalLassoMode,
    GlobalCopyLayerMode,
    GlobalLineSimplificationMode,
    GlobalOrderMode,
    MapPinningMixin,
    UndoMixin,
    MeasurementsMixin,
    CategoriesMixin,
    SelectionMixin,
    LargeLayerRendering,
    EventMixin,
  ],
  initialize(map) {
    this.map = map;
    this.Draw = new L.PM.Draw(map);
    this.Toolbar = new L.PM.Toolbar(map);
    this.Keyboard = createKeyboardMixins();

    this.globalOptions = {
      snappable: true,
      layerGroup: undefined,
      snappingOrder: [
        'Marker',
        'CircleMarker',
        'Circle',
        'Line',
        'Polygon',
        'Rectangle',
      ],
      panes: {
        vertexPane: 'markerPane',
        layerPane: 'overlayPane',
        markerPane: 'markerPane',
      },
      draggable: true,
      exitModeOnEscape: false,
      finishOnEnter: false,
      // toolbar hotkeys for the draw/edit tools (M/L/P/R/C/T/F/E/G/X/O/S,
      // Shift+M, Delete) - see Mixins/Keyboard.js#_handleToolShortcut.
      // Default off so existing consumers aren't surprised by letter keys
      // suddenly activating a tool.
      keyboardShortcuts: false,
      showSnapGuides: false,
      // angle increments (degrees) the snap guides are drawn at, each as a
      // perpendicular pair through the snap position - e.g. 90 draws a
      // horizontal + vertical cross, 45 a diagonal cross
      snapGuidesAngles: [90],
      snapGuidesStyle: null,
      autoTrace: false,
      simplificationFactor: 0.003,
      // Measurements: `measurement` toggles the display,
      // the other flags select the shown rows / unit system. The boolean
      // `showMeasurements` is kept as a legacy alias for
      // `measurements.measurement`.
      measurements: {
        measurement: false,
        showTooltip: true,
        showTooltipOnHover: true,
        totalLength: true,
        segmentLength: true,
        area: true,
        radius: true,
        perimeter: true,
        height: true,
        width: true,
        coordinates: true,
        displayFormat: 'metric',
      },
      // pins shared vertices/markers together during edit - see Mixins/Pinning.js
      pinning: false,
      limitMarkersToViewport: true,
      // layers with more vertices are rendered simplified & viewport culled
      // (issue #366). Set to 0 or -1 to disable
      largeLayerThreshold: 1000,
      // rings with more vertices than this only get a decimated subset of
      // editable vertex markers; hidden vertices follow the drag weighted
      // by their path distance on the line. Set to 0 or -1 to disable
      simplifyEditMarkers: 100,
      // min screen pixels between shown edit markers on simplified rings -
      // zoom in for more (finer) edit markers, out for fewer
      simplifyEditMarkersSpacing: 40,
      // hard cap of shown edit markers per ring on the deepest zoom
      simplifyEditMarkersMax: 1000,
      // clicking a layer selects it, fading every other Geoman-tracked
      // layer to 40% opacity - see Mixins/Selection.js
      selectableLayers: true,
      // highlight style of the selection: 'dim' (default, every other layer
      // fades to 40% opacity) or 'outline' (black frame around each
      // selected shape, nothing is dimmed)
      selectionEffect: 'dim',
      // line style of the 'outline' selection frames: 'solid' (default) or
      // 'dashed' - only affects the frames, never the layers themselves
      selectionOutlineStyle: 'solid',
    };

    this.Keyboard._initKeyListener(map);
    this._initUndoRedo();
    this._initMeasurements();
    this._initCategories();
    this._initSelection();
    this._initLargeLayerRendering();
  },

  setLang(lang = 'en', override, fallback = 'en') {
    // Resolve the language code to a translation key
    lang = resolveLanguageCode(lang, translations);

    const oldLang = L.PM.activeLang;
    if (override) {
      translations[lang] = merge(translations[fallback], override);
    }

    L.PM.activeLang = lang;
    this.map.pm.Toolbar.reinit();
    this._fireLangChange(oldLang, lang, fallback, translations[lang]);
  },
  addControls(options) {
    this.Toolbar.addControls(options);
  },
  removeControls() {
    this.Toolbar.removeControls();
  },
  toggleControls() {
    this.Toolbar.toggleControls();
  },
  controlsVisible() {
    return this.Toolbar.isVisible;
  },

  enableDraw(shape = 'Polygon', options) {
    // backwards compatible, remove after 3.0
    if (shape === 'Poly') {
      shape = 'Polygon';
    }

    this.Draw.enable(shape, options);
  },
  disableDraw(shape = 'Polygon') {
    // backwards compatible, remove after 3.0
    if (shape === 'Poly') {
      shape = 'Polygon';
    }

    this.Draw.disable(shape);
  },
  // optionsModifier for special options like ignoreShapes or merge
  setPathOptions(options, optionsModifier = {}) {
    const ignore = optionsModifier.ignoreShapes || [];
    const mergeOptions = optionsModifier.merge || false;

    this.map.pm.Draw.shapes.forEach((shape) => {
      if (ignore.indexOf(shape) === -1) {
        this.map.pm.Draw[shape].setPathOptions(options, mergeOptions);
      }
    });
  },

  getGlobalOptions() {
    return this.globalOptions;
  },
  setGlobalOptions(o) {
    // merge passed and existing options
    const options = merge(this.globalOptions, o);

    // TODO: remove with next major release
    if (options.editable) {
      options.resizeableCircleMarker = options.editable;
      delete options.editable;
    }

    // check if switched the editable mode for CircleMarker while drawing
    let reenableCircleMarker = false;
    if (
      this.map.pm.Draw.CircleMarker.enabled() &&
      !!this.map.pm.Draw.CircleMarker.options.resizeableCircleMarker !==
        !!options.resizeableCircleMarker
    ) {
      this.map.pm.Draw.CircleMarker.disable();
      reenableCircleMarker = true;
    }
    // check if switched the editable mode for Circle while drawing
    let reenableCircle = false;
    if (
      this.map.pm.Draw.Circle.enabled() &&
      !!this.map.pm.Draw.Circle.options.resizeableCircle !==
        !!options.resizeableCircle
    ) {
      this.map.pm.Draw.Circle.disable();
      reenableCircle = true;
    }

    // enable options for Drawing Shapes
    this.map.pm.Draw.shapes.forEach((shape) => {
      this.map.pm.Draw[shape].setOptions(options);
    });

    if (reenableCircleMarker) {
      this.map.pm.Draw.CircleMarker.enable();
    }

    if (reenableCircle) {
      this.map.pm.Draw.Circle.enable();
    }

    // enable options for Editing
    const layers = L.PM.Utils.findLayers(this.map);
    layers.forEach((layer) => {
      layer.pm.setOptions(options);
    });

    this.map.fire('pm:globaloptionschanged');

    // store options (before the handlers below - they read
    // `this.globalOptions` to apply the new state)
    this.globalOptions = options;

    // Measurements: apply the new state to all existing layers. The boolean
    // `showMeasurements` is a legacy alias for `measurements.measurement`.
    if (o && ('measurements' in o || 'showMeasurements' in o)) {
      if ('showMeasurements' in o) {
        options.measurements = merge({}, options.measurements, {
          measurement: !!options.showMeasurements,
        });
        delete options.showMeasurements;
        this.globalOptions = options;
      }
      this.Toolbar.toggleButton(
        'measurementOption',
        !!options.measurements.measurement,
        false
      );
      L.PM.Utils.findLayers(this.map).forEach((layer) => {
        this._updateLayerMeasurement(layer);
      });
    }

    // Pinning: keep the toolbar button in sync when toggled via setGlobalOptions
    // directly (e.g. `setGlobalOptions({ pinning: true })`)
    // rather than through enablePinning()/togglePinning()
    if (o && 'pinning' in o) {
      this.Toolbar.toggleButton('pinningOption', !!options.pinning, false);
    }

    // Selection effect: re-apply the configured highlight ('dim' or
    // 'outline') to the layers that are currently selected
    if (o && 'selectionEffect' in o) {
      this._applySelectionEffect();
    }

    // Selection outline line style: re-apply so the current frames switch
    // between solid and dashed
    if (o && 'selectionOutlineStyle' in o) {
      this._applySelectionEffect();
    }

    // SnapGuides: keep the toolbar button in sync when toggled via
    // setGlobalOptions directly rather than through the toolbar button
    if (o && 'showSnapGuides' in o) {
      this.Toolbar.toggleButton(
        'snapGuidesOption',
        !!options.showSnapGuides,
        false
      );
    }

    // apply the options (actually trigger the functionality)
    this.applyGlobalOptions();

    // reflect keyboardShortcuts on/off in the toolbar buttons' tooltips
    this.Toolbar.updateShortcutHints();
  },
  applyGlobalOptions() {
    const layers = L.PM.Utils.findLayers(this.map);
    layers.forEach((layer) => {
      if (layer.pm.enabled()) {
        layer.pm.applyOptions();
      }
    });
  },
  globalDrawModeEnabled() {
    return !!this.Draw.getActiveShape();
  },
  globalCutModeEnabled() {
    return !!this.Draw.Cut.enabled();
  },
  enableGlobalCutMode(options) {
    return this.Draw.Cut.enable(options);
  },
  toggleGlobalCutMode(options) {
    return this.Draw.Cut.toggle(options);
  },
  disableGlobalCutMode() {
    return this.Draw.Cut.disable();
  },
  globalSplitModeEnabled() {
    return !!this.Draw.Split.enabled();
  },
  enableGlobalSplitMode(options) {
    return this.Draw.Split.enable(options);
  },
  toggleGlobalSplitMode(options) {
    return this.Draw.Split.toggle(options);
  },
  disableGlobalSplitMode() {
    return this.Draw.Split.disable();
  },
  getGeomanLayers(asGroup = false) {
    const layers = L.PM.Utils.findLayers(this.map);
    if (!asGroup) {
      return layers;
    }
    const group = L.featureGroup();
    group._pmTempLayer = true;
    layers.forEach((layer) => {
      group.addLayer(layer);
    });
    return group;
  },
  getGeomanDrawLayers(asGroup = false) {
    const layers = L.PM.Utils.findLayers(this.map).filter(
      (l) => l._drawnByGeoman === true
    );
    if (!asGroup) {
      return layers;
    }
    const group = L.featureGroup();
    group._pmTempLayer = true;
    layers.forEach((layer) => {
      group.addLayer(layer);
    });
    return group;
  },
  // returns the map instance by default or a layergroup is set through global options
  _getContainingLayer() {
    return this.globalOptions.layerGroup &&
      this.globalOptions.layerGroup instanceof L.LayerGroup
      ? this.globalOptions.layerGroup
      : this.map;
  },
  _isCRSSimple() {
    return this.map.options.crs === L.CRS.Simple;
  },
  // in Canvas mode we need to convert touch- and pointerevents (IE) to mouseevents, because Leaflet don't support them.
  _touchEventCounter: 0,
  _addTouchEvents(elm) {
    if (this._touchEventCounter === 0) {
      L.DomEvent.on(elm, 'touchmove', this._canvasTouchMove, this);
      L.DomEvent.on(
        elm,
        'touchstart touchend touchcancel',
        this._canvasTouchClick,
        this
      );
    }
    this._touchEventCounter += 1;
  },
  _removeTouchEvents(elm) {
    if (this._touchEventCounter === 1) {
      L.DomEvent.off(elm, 'touchmove', this._canvasTouchMove, this);
      L.DomEvent.off(
        elm,
        'touchstart touchend touchcancel',
        this._canvasTouchClick,
        this
      );
    }
    this._touchEventCounter =
      this._touchEventCounter <= 1 ? 0 : this._touchEventCounter - 1;
  },
  _canvasTouchMove(e) {
    getRenderer(this.map)._onMouseMove(this._createMouseEvent('mousemove', e));
  },
  _canvasTouchClick(e) {
    let type = '';
    if (e.type === 'touchstart' || e.type === 'pointerdown') {
      type = 'mousedown';
    } else if (e.type === 'touchend' || e.type === 'pointerup') {
      type = 'mouseup';
    } else if (e.type === 'touchcancel' || e.type === 'pointercancel') {
      type = 'mouseup';
    }
    if (!type) {
      return;
    }
    getRenderer(this.map)._onClick(this._createMouseEvent(type, e));
  },
  _createMouseEvent(type, e) {
    let mouseEvent;
    const touchEvt = e.touches[0] || e.changedTouches[0];
    try {
      mouseEvent = new MouseEvent(type, {
        bubbles: e.bubbles,
        cancelable: e.cancelable,
        view: e.view,
        detail: touchEvt.detail,
        screenX: touchEvt.screenX,
        screenY: touchEvt.screenY,
        clientX: touchEvt.clientX,
        clientY: touchEvt.clientY,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        button: e.button,
        relatedTarget: e.relatedTarget,
      });
    } catch (ex) {
      mouseEvent = document.createEvent('MouseEvents');
      mouseEvent.initMouseEvent(
        type,
        e.bubbles,
        e.cancelable,
        e.view,
        touchEvt.detail,
        touchEvt.screenX,
        touchEvt.screenY,
        touchEvt.clientX,
        touchEvt.clientY,
        e.ctrlKey,
        e.altKey,
        e.shiftKey,
        e.metaKey,
        e.button,
        e.relatedTarget
      );
    }
    return mouseEvent;
  },
});

export default Map;
