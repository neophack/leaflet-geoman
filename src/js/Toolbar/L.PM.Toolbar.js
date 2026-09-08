import PMButton from './L.Controls';

import { getTranslation } from '../helpers';

L.Control.PMButton = PMButton;

// Toolbar hotkeys shown as a tooltip suffix while the `keyboardShortcuts`
// global option is on - see Mixins/Keyboard.js#_handleToolShortcut for the
// matching keydown handling.
const SHORTCUT_KEY_LABELS = {
  drawMarker: 'M',
  drawCircleMarker: 'Shift+M',
  drawPolyline: 'L',
  drawPolygon: 'P',
  drawRectangle: 'R',
  drawCircle: 'C',
  drawText: 'T',
  drawFreehand: 'F',
  editMode: 'E',
  dragMode: 'G',
  cutPolygon: 'X',
  removalMode: 'Delete',
  rotateMode: 'O',
  scaleMode: 'S',
};

const Toolbar = L.Class.extend({
  options: {
    drawMarker: true,
    drawRectangle: true,
    drawPolyline: true,
    drawPolygon: true,
    drawCircle: true,
    drawCircleMarker: true,
    drawText: true,
    editMode: true,
    dragMode: true,
    cutPolygon: true,
    removalMode: true,
    rotateMode: true,
    snappingOption: true,
    // Feature defaults: split / scale / union and the option toggles are on,
    // the rest is off
    unionMode: true,
    differenceMode: false,
    splitMode: true,
    scaleMode: true,
    lassoMode: false,
    copyLayerMode: false,
    lineSimplificationMode: false,
    bringToFrontMode: false,
    sendToBackMode: false,
    drawFreehand: false,
    drawPoint: false,
    pinningOption: true,
    snapGuidesOption: true,
    autoTracingOption: true,
    measurementOption: false,
    drawControls: true,
    editControls: true,
    optionsControls: true,
    customControls: true,
    oneBlock: false,
    position: 'topleft',
    positions: {
      draw: '',
      edit: '',
      options: '',
      custom: '',
    },
  },
  customButtons: [],
  initialize(map) {
    // For some reason there is an reference between multiple maps instances
    this.customButtons = [];
    this.options.positions = {
      draw: '',
      edit: '',
      options: '',
      custom: '',
    };

    this.init(map);
  },
  reinit() {
    const addControls = this.isVisible;

    this.removeControls();
    this._defineButtons();

    if (addControls) {
      this.addControls();
    }

    this.updateShortcutHints();
  },
  /**
   * Appends the assigned hotkey to the title (tooltip) of every toolbar
   * button in SHORTCUT_KEY_LABELS while `keyboardShortcuts` is enabled, or
   * restores the plain translated title when it's off.
   */
  updateShortcutHints() {
    const enabled = !!this.map.pm.getGlobalOptions().keyboardShortcuts;
    Object.keys(SHORTCUT_KEY_LABELS).forEach((name) => {
      const button = this.buttons[name];
      if (!button) {
        return;
      }
      if (button._baseTitle === undefined) {
        button._baseTitle = button._button.title || '';
      }
      const key = SHORTCUT_KEY_LABELS[name];
      button.setTitle(
        enabled ? `${button._baseTitle} (${key})` : button._baseTitle
      );
    });
  },
  init(map) {
    this.map = map;

    this.buttons = {};
    this.isVisible = false;
    this.drawContainer = L.DomUtil.create(
      'div',
      'leaflet-pm-toolbar leaflet-pm-draw leaflet-bar leaflet-control'
    );
    this.editContainer = L.DomUtil.create(
      'div',
      'leaflet-pm-toolbar leaflet-pm-edit leaflet-bar leaflet-control'
    );
    this.optionsContainer = L.DomUtil.create(
      'div',
      'leaflet-pm-toolbar leaflet-pm-options leaflet-bar leaflet-control'
    );
    this.customContainer = L.DomUtil.create(
      'div',
      'leaflet-pm-toolbar leaflet-pm-custom leaflet-bar leaflet-control'
    );

    this._defineButtons();
  },
  _createContainer(name) {
    const container = `${name}Container`;
    if (!this[container]) {
      this[container] = L.DomUtil.create(
        'div',
        `leaflet-pm-toolbar leaflet-pm-${name} leaflet-bar leaflet-control`
      );
    }
    return this[container];
  },
  getButtons() {
    return this.buttons;
  },

  addControls(options = this.options) {
    // adds all buttons to the map specified inside options

    // make button renaming backwards compatible
    if (typeof options.editPolygon !== 'undefined') {
      options.editMode = options.editPolygon;
    }
    if (typeof options.deleteLayer !== 'undefined') {
      options.removalMode = options.deleteLayer;
    }

    // first set the options
    L.Util.setOptions(this, options);

    this.applyIconStyle();

    this.isVisible = true;
    // now show the specified buttons
    this._showHideButtons();
    // re-apply the boolean-family presentation after the reset above
    this._updateBooleanFamilyPresentation();
  },
  applyIconStyle() {
    const buttons = this.getButtons();

    const iconClasses = {
      geomanIcons: {
        drawMarker: 'control-icon leaflet-pm-icon-marker',
        drawPolyline: 'control-icon leaflet-pm-icon-polyline',
        drawRectangle: 'control-icon leaflet-pm-icon-rectangle',
        drawPolygon: 'control-icon leaflet-pm-icon-polygon',
        drawCircle: 'control-icon leaflet-pm-icon-circle',
        drawCircleMarker: 'control-icon leaflet-pm-icon-circle-marker',
        editMode: 'control-icon leaflet-pm-icon-edit',
        dragMode: 'control-icon leaflet-pm-icon-drag',
        cutPolygon: 'control-icon leaflet-pm-icon-cut',
        removalMode: 'control-icon leaflet-pm-icon-delete',
        drawText: 'control-icon leaflet-pm-icon-text',
        unionMode: 'control-icon leaflet-pm-icon-union',
        differenceMode: 'control-icon leaflet-pm-icon-difference',
        splitMode: 'control-icon leaflet-pm-icon-split',
        scaleMode: 'control-icon leaflet-pm-icon-scale',
        lassoMode: 'control-icon leaflet-pm-icon-lasso',
        copyLayerMode: 'control-icon leaflet-pm-icon-copy',
        lineSimplificationMode: 'control-icon leaflet-pm-icon-simplify',
        bringToFrontMode: 'control-icon leaflet-pm-icon-front',
        sendToBackMode: 'control-icon leaflet-pm-icon-back',
        drawFreehand: 'control-icon leaflet-pm-icon-freehand',
        drawPoint: 'control-icon leaflet-pm-icon-point',
        snappingOption: 'control-icon leaflet-pm-icon-snapping',
        pinningOption: 'control-icon leaflet-pm-icon-pin',
        snapGuidesOption: 'control-icon leaflet-pm-icon-snapguides',
        autoTracingOption: 'control-icon leaflet-pm-icon-autotrace',
        measurementOption: 'control-icon leaflet-pm-icon-measurement',
      },
    };

    for (const name in buttons) {
      const button = buttons[name];

      L.Util.setOptions(button, {
        className: iconClasses.geomanIcons[name],
      });
    }
  },
  removeControls() {
    // grab all buttons to loop through
    const buttons = this.getButtons();

    // remove all buttons
    for (const btn in buttons) {
      buttons[btn].remove();
    }

    this.isVisible = false;
  },
  deleteControl(name) {
    const btnName = this._btnNameMapping(name);
    if (this.buttons[btnName]) {
      this.buttons[btnName].remove();
      delete this.buttons[btnName];
    }
  },
  toggleControls(options = this.options) {
    if (this.isVisible) {
      this.removeControls();
    } else {
      this.addControls(options);
    }
  },
  _addButton(name, button) {
    this.buttons[name] = button;
    this.options[name] = !!this.options[name] || false;

    return this.buttons[name];
  },
  triggerClickOnToggledButtons(exceptThisButton) {
    // this function is used when - e.g. drawing mode is enabled and a possible
    // other active mode (like removal tool) is already active.
    // we can't have two active modes because of possible event conflicts
    // so, we trigger a click on all currently active (toggled) buttons

    for (const name in this.buttons) {
      const button = this.buttons[name];
      if (
        button._button.disableByOtherButtons &&
        button !== exceptThisButton &&
        button.toggled()
      ) {
        button._triggerClick();
      }
    }
  },
  /**
   * Switches from one linked mode to another (e.g. the
   * subtract action inside the union button): disables the currently active
   * mode and enables the mode `name` (a registered toolbar button name).
   * Works in both directions - union -> subtract and subtract -> union.
   */
  _switchModeAction(name) {
    const target = this.buttons[name];
    if (!target) {
      return;
    }
    // the linked boolean modes share the union slot, so the slot's toggle
    // state can't tell which of the two modes is active - check the modes
    // themselves and switch through their APIs (the enable guards move the
    // slot state and presentation over)
    if (name === 'unionMode' || name === 'differenceMode') {
      const active =
        name === 'unionMode'
          ? this.map.pm.globalUnionModeEnabled &&
            this.map.pm.globalUnionModeEnabled()
          : this.map.pm.globalDifferenceModeEnabled &&
            this.map.pm.globalDifferenceModeEnabled();
      if (!active) {
        if (name === 'unionMode') {
          this.map.pm.toggleGlobalUnionMode();
        } else {
          this.map.pm.toggleGlobalDifferenceMode();
        }
      }
      return;
    }
    this.triggerClickOnToggledButtons(target);
    if (!target.toggled()) {
      if (target._button.afterClick) {
        // invoke the mode toggle without clicking the button itself: clicking
        // would flip the linked button's toggle state, but the visible slot
        // keeps exclusive ownership of that state
        target._button.afterClick(null, { button: target, event: null });
      } else {
        target._triggerClick();
      }
    }
  },
  /**
   * Official behavior: the toolbar has one slot for the linked boolean
   * modes. While difference mode is active the union slot shows the Subtract
   * icon / title and offers the union action to switch back; when the mode
   * is off the default Union presentation is restored.
   */
  _updateBooleanFamilyPresentation() {
    const unionBtn = this.buttons.unionMode;
    const differenceBtn = this.buttons.differenceMode;
    if (!unionBtn || !differenceBtn) {
      return;
    }
    const differenceActive = !!(
      this.map &&
      this.map.pm &&
      this.map.pm.globalDifferenceModeEnabled &&
      this.map.pm.globalDifferenceModeEnabled()
    );
    const base = (differenceActive ? differenceBtn : unionBtn)._button
      ._familyBase;
    if (!base) {
      return;
    }
    const changed =
      unionBtn._button.className !== base.className ||
      unionBtn._button.title !== base.title ||
      unionBtn._button.actions !== base.actions;
    unionBtn._button.className = base.className;
    unionBtn._button.actions = base.actions;
    unionBtn.setTitle(base.title);
    if (changed && unionBtn.buttonsDomNode) {
      unionBtn._renderButton();
    }
  },
  toggleButton(name, status, disableOthers = true) {
    // does not fire the events/functionality of the button
    // this just changes the state and is used if a functionality (like Draw)
    // is enabled manually via script

    // backwards compatibility with button rename
    if (name === 'editPolygon') {
      name = 'editMode';
    }
    if (name === 'deleteLayer') {
      name = 'removalMode';
    }

    const toggleBtnName = name;

    // as some mode got enabled, we still have to trigger the click on the other buttons
    // to disable their mode
    if (disableOthers) {
      this.triggerClickOnToggledButtons(this.buttons[toggleBtnName]);
    }

    if (!this.buttons[toggleBtnName]) {
      return false;
    }
    // now toggle the state of the button
    return this.buttons[toggleBtnName].toggle(status);
  },
  _defineButtons() {
    // some buttons are still in their respective classes, like L.PM.Draw.Polygon
    const drawMarkerButton = {
      className: 'control-icon leaflet-pm-icon-marker',
      title: getTranslation('buttonTitles.drawMarkerButton'),
      jsClass: 'Marker',
      onClick: () => {},
      afterClick: (e, ctx) => {
        // toggle drawing mode
        this.map.pm.Draw[ctx.button._button.jsClass].toggle();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      actions: ['cancel'],
    };

    const drawPolyButton = {
      title: getTranslation('buttonTitles.drawPolyButton'),
      className: 'control-icon leaflet-pm-icon-polygon',
      jsClass: 'Polygon',
      onClick: () => {},
      afterClick: (e, ctx) => {
        // toggle drawing mode
        this.map.pm.Draw[ctx.button._button.jsClass].toggle();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      actions: ['finish', 'removeLastVertex', 'cancel'],
    };

    const drawLineButton = {
      className: 'control-icon leaflet-pm-icon-polyline',
      title: getTranslation('buttonTitles.drawLineButton'),
      jsClass: 'Line',
      onClick: () => {},
      afterClick: (e, ctx) => {
        // toggle drawing mode
        this.map.pm.Draw[ctx.button._button.jsClass].toggle();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      actions: ['finish', 'removeLastVertex', 'cancel'],
    };

    const drawCircleButton = {
      title: getTranslation('buttonTitles.drawCircleButton'),
      className: 'control-icon leaflet-pm-icon-circle',
      jsClass: 'Circle',
      onClick: () => {},
      afterClick: (e, ctx) => {
        // toggle drawing mode
        this.map.pm.Draw[ctx.button._button.jsClass].toggle();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      actions: ['cancel'],
    };

    const drawCircleMarkerButton = {
      title: getTranslation('buttonTitles.drawCircleMarkerButton'),
      className: 'control-icon leaflet-pm-icon-circle-marker',
      jsClass: 'CircleMarker',
      onClick: () => {},
      afterClick: (e, ctx) => {
        // toggle drawing mode
        this.map.pm.Draw[ctx.button._button.jsClass].toggle();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      actions: ['cancel'],
    };

    const drawRectButton = {
      title: getTranslation('buttonTitles.drawRectButton'),
      className: 'control-icon leaflet-pm-icon-rectangle',
      jsClass: 'Rectangle',
      onClick: () => {},
      afterClick: (e, ctx) => {
        // toggle drawing mode
        this.map.pm.Draw[ctx.button._button.jsClass].toggle();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      actions: ['cancel'],
    };

    const editButton = {
      title: getTranslation('buttonTitles.editButton'),
      className: 'control-icon leaflet-pm-icon-edit',
      onClick: () => {},
      afterClick: () => {
        this.map.pm.toggleGlobalEditMode();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      tool: 'edit',
      actions: ['finishMode'],
    };

    const dragButton = {
      title: getTranslation('buttonTitles.dragButton'),
      className: 'control-icon leaflet-pm-icon-drag',
      onClick: () => {},
      afterClick: () => {
        this.map.pm.toggleGlobalDragMode();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      tool: 'edit',
      actions: ['finishMode'],
    };

    const cutButton = {
      title: getTranslation('buttonTitles.cutButton'),
      className: 'control-icon leaflet-pm-icon-cut',
      jsClass: 'Cut',
      onClick: () => {},
      afterClick: (e, ctx) => {
        // enable polygon drawing mode without snap
        this.map.pm.Draw[ctx.button._button.jsClass].toggle({
          snappable: true,
          cursorMarker: true,
          allowSelfIntersection: false,
        });
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      tool: 'edit',
      actions: ['finish', 'removeLastVertex', 'cancel'],
    };

    const deleteButton = {
      title: getTranslation('buttonTitles.deleteButton'),
      className: 'control-icon leaflet-pm-icon-delete',
      onClick: () => {},
      afterClick: () => {
        this.map.pm.toggleGlobalRemovalMode();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      tool: 'edit',
      actions: ['finishMode'],
    };

    const rotateButton = {
      title: getTranslation('buttonTitles.rotateButton'),
      className: 'control-icon leaflet-pm-icon-rotate',
      onClick: () => {},
      afterClick: () => {
        this.map.pm.toggleGlobalRotateMode();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      tool: 'edit',
      actions: ['finishMode'],
    };

    const drawTextButton = {
      className: 'control-icon leaflet-pm-icon-text',
      title: getTranslation('buttonTitles.drawTextButton'),
      jsClass: 'Text',
      onClick: () => {},
      afterClick: (e, ctx) => {
        // toggle drawing mode
        this.map.pm.Draw[ctx.button._button.jsClass].toggle();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      actions: ['cancel'],
    };

    const unionButton = {
      title: getTranslation('buttonTitles.unionButton'),
      className: 'control-icon leaflet-pm-icon-union',
      onClick: () => {},
      afterClick: () => {
        // the slot hosts both linked boolean modes:
        // while difference mode is active, clicking it turns difference off
        // instead of starting union
        if (
          this.map.pm.globalDifferenceModeEnabled &&
          this.map.pm.globalDifferenceModeEnabled()
        ) {
          this.map.pm.disableGlobalDifferenceMode();
        } else {
          this.map.pm.toggleGlobalUnionMode();
        }
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      tool: 'edit',
      // switching action to the Subtract mode
      actions: ['differenceMode', 'cancel'],
    };

    const differenceButton = {
      title: getTranslation('buttonTitles.differenceButton'),
      className: 'control-icon leaflet-pm-icon-difference',
      onClick: () => {},
      afterClick: () => {
        this.map.pm.toggleGlobalDifferenceMode();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      tool: 'edit',
      actions: ['unionMode', 'cancel'],
    };

    const splitButton = {
      title: getTranslation('buttonTitles.splitButton'),
      className: 'control-icon leaflet-pm-icon-split',
      onClick: () => {},
      afterClick: () => {
        this.map.pm.toggleGlobalSplitMode({
          snappable: true,
          cursorMarker: true,
          allowSelfIntersection: false,
        });
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      tool: 'edit',
      actions: ['finish', 'removeLastVertex', 'cancel'],
    };

    const scaleButton = {
      title: getTranslation('buttonTitles.scaleButton'),
      className: 'control-icon leaflet-pm-icon-scale',
      onClick: () => {},
      afterClick: () => {
        this.map.pm.toggleGlobalScaleMode();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      tool: 'edit',
      actions: ['finishMode'],
    };

    const lassoButton = {
      title: getTranslation('buttonTitles.lassoButton'),
      className: 'control-icon leaflet-pm-icon-lasso',
      onClick: () => {},
      afterClick: () => {
        this.map.pm.toggleGlobalLassoMode();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      tool: 'edit',
      actions: ['finishMode'],
    };

    const copyLayerButton = {
      title: getTranslation('buttonTitles.copyButton'),
      className: 'control-icon leaflet-pm-icon-copy',
      onClick: () => {},
      afterClick: () => {
        this.map.pm.toggleGlobalCopyLayerMode();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      tool: 'edit',
      actions: ['finishMode'],
    };

    const simplifyButton = {
      title: getTranslation('buttonTitles.simplifyButton'),
      className: 'control-icon leaflet-pm-icon-simplify',
      onClick: () => {},
      afterClick: () => {
        this.map.pm.toggleGlobalLineSimplificationMode();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      tool: 'edit',
      actions: ['finishMode'],
    };

    const bringToFrontButton = {
      title: getTranslation('buttonTitles.bringToFrontButton'),
      className: 'control-icon leaflet-pm-icon-front',
      onClick: () => {},
      afterClick: () => {
        this.map.pm.toggleGlobalBringToFrontMode();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      tool: 'edit',
      actions: ['sendToBackMode', 'cancel'],
    };

    const sendToBackButton = {
      title: getTranslation('buttonTitles.sendToBackButton'),
      className: 'control-icon leaflet-pm-icon-back',
      onClick: () => {},
      afterClick: () => {
        this.map.pm.toggleGlobalSendToBackMode();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      tool: 'edit',
      actions: ['bringToFrontMode', 'cancel'],
    };

    const drawFreehandButton = {
      title: getTranslation('buttonTitles.freehandButton'),
      className: 'control-icon leaflet-pm-icon-freehand',
      jsClass: 'Freehand',
      onClick: () => {},
      afterClick: (e, ctx) => {
        // toggle drawing mode
        this.map.pm.Draw[ctx.button._button.jsClass].toggle();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      actions: ['cancel'],
    };

    const drawPointButton = {
      title: getTranslation('buttonTitles.drawPointButton'),
      className: 'control-icon leaflet-pm-icon-point',
      jsClass: 'Point',
      onClick: () => {},
      afterClick: (e, ctx) => {
        // toggle drawing mode
        this.map.pm.Draw[ctx.button._button.jsClass].toggle();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: true,
      position: this.options.position,
      actions: ['cancel'],
    };

    // option toggles live in the options block and don't disable other modes
    const snappingOptionButton = {
      title: getTranslation('buttonTitles.snappingButton'),
      className: 'control-icon leaflet-pm-icon-snapping',
      onClick: () => {},
      afterClick: () => {
        const snappable = !this.map.pm.getGlobalOptions().snappable;
        this.map.pm.setGlobalOptions({ snappable });
      },
      doToggle: true,
      toggleStatus: true, // globalOptions.snappable defaults to true
      disableOtherButtons: false,
      disableByOtherButtons: false,
      position: this.options.position,
      tool: 'options',
      actions: [],
    };

    const pinningOptionButton = {
      title: getTranslation('buttonTitles.pinningButton'),
      className: 'control-icon leaflet-pm-icon-pin',
      onClick: () => {},
      afterClick: () => {
        this.map.pm.togglePinning();
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: false,
      disableByOtherButtons: false,
      position: this.options.position,
      tool: 'options',
      actions: [],
    };

    const snapGuidesOptionButton = {
      title: getTranslation('buttonTitles.snapGuidesButton'),
      className: 'control-icon leaflet-pm-icon-snapguides',
      onClick: () => {},
      afterClick: () => {
        const showSnapGuides = !this.map.pm.getGlobalOptions().showSnapGuides;
        this.map.pm.setGlobalOptions({ showSnapGuides });
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: false,
      disableByOtherButtons: false,
      position: this.options.position,
      tool: 'options',
      actions: [],
    };

    const autoTracingOptionButton = {
      title: getTranslation('buttonTitles.autoTracingButton'),
      className: 'control-icon leaflet-pm-icon-autotrace',
      onClick: () => {},
      afterClick: () => {
        const autoTrace = !this.map.pm.getGlobalOptions().autoTrace;
        this.map.pm.setGlobalOptions({ autoTrace });
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: false,
      disableByOtherButtons: false,
      position: this.options.position,
      tool: 'options',
      actions: [],
    };

    const measurementOptionButton = {
      title: getTranslation('buttonTitles.measurementButton'),
      className: 'control-icon leaflet-pm-icon-measurement',
      onClick: () => {},
      afterClick: () => {
        const { measurements } = this.map.pm.getGlobalOptions();
        this.map.pm.setGlobalOptions({
          measurements: {
            ...measurements,
            measurement: !measurements.measurement,
          },
        });
      },
      doToggle: true,
      toggleStatus: false,
      disableOtherButtons: false,
      disableByOtherButtons: false,
      position: this.options.position,
      tool: 'options',
      actions: [],
    };

    // registration order = rendering order (draw block, edit block,
    // options block)
    this._addButton('drawMarker', new L.Control.PMButton(drawMarkerButton));
    this._addButton('drawPolyline', new L.Control.PMButton(drawLineButton));
    this._addButton('drawRectangle', new L.Control.PMButton(drawRectButton));
    this._addButton('drawPolygon', new L.Control.PMButton(drawPolyButton));
    this._addButton('drawCircle', new L.Control.PMButton(drawCircleButton));
    this._addButton(
      'drawCircleMarker',
      new L.Control.PMButton(drawCircleMarkerButton)
    );
    this._addButton('drawText', new L.Control.PMButton(drawTextButton));
    this._addButton('editMode', new L.Control.PMButton(editButton));
    this._addButton('dragMode', new L.Control.PMButton(dragButton));
    this._addButton('cutPolygon', new L.Control.PMButton(cutButton));
    this._addButton('removalMode', new L.Control.PMButton(deleteButton));
    this._addButton('rotateMode', new L.Control.PMButton(rotateButton));
    this._addButton('drawFreehand', new L.Control.PMButton(drawFreehandButton));
    this._addButton('drawPoint', new L.Control.PMButton(drawPointButton));
    this._addButton('lassoMode', new L.Control.PMButton(lassoButton));
    this._addButton('splitMode', new L.Control.PMButton(splitButton));
    this._addButton('scaleMode', new L.Control.PMButton(scaleButton));
    this._addButton('unionMode', new L.Control.PMButton(unionButton));
    this._addButton('differenceMode', new L.Control.PMButton(differenceButton));
    // base presentation of the two linked boolean-mode buttons: while
    // difference mode is active the union slot shows the Subtract
    // presentation, so the defaults are kept for switching back
    this.buttons.unionMode._button._familyBase = {
      className: unionButton.className,
      title: unionButton.title,
      actions: unionButton.actions,
    };
    this.buttons.differenceMode._button._familyBase = {
      className: differenceButton.className,
      title: differenceButton.title,
      actions: differenceButton.actions,
    };
    this._addButton(
      'bringToFrontMode',
      new L.Control.PMButton(bringToFrontButton)
    );
    this._addButton('sendToBackMode', new L.Control.PMButton(sendToBackButton));
    this._addButton('copyLayerMode', new L.Control.PMButton(copyLayerButton));
    this._addButton(
      'lineSimplificationMode',
      new L.Control.PMButton(simplifyButton)
    );
    this._addButton(
      'pinningOption',
      new L.Control.PMButton(pinningOptionButton)
    );
    this._addButton(
      'snappingOption',
      new L.Control.PMButton(snappingOptionButton)
    );
    this._addButton(
      'autoTracingOption',
      new L.Control.PMButton(autoTracingOptionButton)
    );
    this._addButton(
      'snapGuidesOption',
      new L.Control.PMButton(snapGuidesOptionButton)
    );
    this._addButton(
      'measurementOption',
      new L.Control.PMButton(measurementOptionButton)
    );
  },

  _showHideButtons() {
    // if Toolbar is not visible, we don't need to update button positions
    if (!this.isVisible) {
      return;
    }

    // remove all buttons, that's because the Toolbar can be added again with
    // different options so it's basically a reset and add again
    this.removeControls();
    // we need to set isVisible = true again, because removeControls() set it to false
    this.isVisible = true;

    const buttons = this.getButtons();
    let ignoreBtns = [];

    if (this.options.drawControls === false) {
      ignoreBtns = ignoreBtns.concat(
        Object.keys(buttons).filter((btn) => !buttons[btn]._button.tool)
      );
    }
    if (this.options.editControls === false) {
      ignoreBtns = ignoreBtns.concat(
        Object.keys(buttons).filter(
          (btn) => buttons[btn]._button.tool === 'edit'
        )
      );
    }
    if (this.options.optionsControls === false) {
      ignoreBtns = ignoreBtns.concat(
        Object.keys(buttons).filter(
          (btn) => buttons[btn]._button.tool === 'options'
        )
      );
    }
    if (this.options.customControls === false) {
      ignoreBtns = ignoreBtns.concat(
        Object.keys(buttons).filter(
          (btn) => buttons[btn]._button.tool === 'custom'
        )
      );
    }

    for (const btn in buttons) {
      if (this.options[btn] && ignoreBtns.indexOf(btn) === -1) {
        // if options say the button should be visible, add it to the map
        let block = buttons[btn]._button.tool;
        if (!block) {
          // undefined is the draw block
          block = 'draw';
        }
        buttons[btn].setPosition(this._getBtnPosition(block));
        buttons[btn].addTo(this.map);
      }
    }
  },
  _getBtnPosition(block) {
    return this.options.positions && this.options.positions[block]
      ? this.options.positions[block]
      : this.options.position;
  },
  setBlockPosition(block, position) {
    this.options.positions[block] = position;
    this._showHideButtons();
    this.changeControlOrder();
  },
  getBlockPositions() {
    return this.options.positions;
  },
  copyDrawControl(copyInstance, options) {
    if (!options) {
      throw new TypeError('Button has no name');
    } else if (typeof options !== 'object') {
      // if only the name is passed and no options object
      options = { name: options };
    }

    const instance = this._btnNameMapping(copyInstance);

    if (!options.name) {
      throw new TypeError('Button has no name');
    }

    if (this.buttons[options.name]) {
      throw new TypeError('Button with this name already exists');
    }
    const drawInstance = this.map.pm.Draw.createNewDrawInstance(
      options.name,
      instance
    );

    const btn = this.buttons[instance]._button;
    options = { ...btn, ...options };
    const control = this.createCustomControl(options);
    return { drawInstance, control };
  },
  createCustomControl(options) {
    if (!options.name) {
      throw new TypeError('Button has no name');
    }

    if (this.buttons[options.name]) {
      throw new TypeError('Button with this name already exists');
    }
    if (!options.onClick) {
      options.onClick = () => {};
    }
    if (!options.afterClick) {
      options.afterClick = () => {};
    }
    if (options.toggle !== false) {
      options.toggle = true;
    }

    if (options.block) {
      options.block = options.block.toLowerCase();
    }
    if (!options.block || options.block === 'draw') {
      options.block = '';
    }

    if (!options.className) {
      options.className = 'control-icon';
    } else if (options.className.indexOf('control-icon') === -1) {
      options.className = `control-icon ${options.className}`;
    }

    const _options = {
      tool: options.block,
      className: options.className,
      title: options.title || '',
      jsClass: options.name,
      onClick: options.onClick,
      afterClick: options.afterClick,
      doToggle: options.toggle,
      toggleStatus: false,
      disableOtherButtons: options.disableOtherButtons ?? true,
      disableByOtherButtons: options.disableByOtherButtons ?? true,
      cssToggle: options.toggle,
      position: this.options.position,
      actions: options.actions || [],
      disabled: !!options.disabled,
    };

    if (this.options[options.name] !== false) {
      this.options[options.name] = true;
    }

    const control = this._addButton(
      options.name,
      new L.Control.PMButton(_options)
    );
    this.changeControlOrder();
    return control;
  },
  controlExists(name) {
    return Boolean(this.getButton(name));
  },
  getButton(name) {
    return this.getButtons()[name];
  },
  getButtonsInBlock(name) {
    const buttonsInBlock = {};
    if (name) {
      for (const buttonName in this.getButtons()) {
        const button = this.getButtons()[buttonName];
        // draw controls doesn't have a block
        if (
          button._button.tool === name ||
          (name === 'draw' && !button._button.tool)
        ) {
          buttonsInBlock[buttonName] = button;
        }
      }
    }
    return buttonsInBlock;
  },
  changeControlOrder(order = []) {
    const shapeMapping = this._shapeMapping();

    const _order = [];
    order.forEach((shape) => {
      if (shapeMapping[shape]) {
        _order.push(shapeMapping[shape]);
      } else {
        _order.push(shape);
      }
    });

    const buttons = this.getButtons();

    // This steps are needed to create a new Object which contains the buttons in the correct sorted order.
    const newbtnorder = {};
    _order.forEach((control) => {
      if (buttons[control]) {
        newbtnorder[control] = buttons[control];
      }
    });

    const drawBtns = Object.keys(buttons).filter(
      (btn) =>
        !buttons[btn]._button.tool || buttons[btn]._button.tool === 'draw'
    );
    drawBtns.forEach((btn) => {
      if (_order.indexOf(btn) === -1) {
        newbtnorder[btn] = buttons[btn];
      }
    });
    const editBtns = Object.keys(buttons).filter(
      (btn) => buttons[btn]._button.tool === 'edit'
    );
    editBtns.forEach((btn) => {
      if (_order.indexOf(btn) === -1) {
        newbtnorder[btn] = buttons[btn];
      }
    });
    const optionsBtns = Object.keys(buttons).filter(
      (btn) => buttons[btn]._button.tool === 'options'
    );
    optionsBtns.forEach((btn) => {
      if (_order.indexOf(btn) === -1) {
        newbtnorder[btn] = buttons[btn];
      }
    });
    const customBtns = Object.keys(buttons).filter(
      (btn) => buttons[btn]._button.tool === 'custom'
    );
    customBtns.forEach((btn) => {
      if (_order.indexOf(btn) === -1) {
        newbtnorder[btn] = buttons[btn];
      }
    });
    // To add all other buttons they are not in a container from above (maybe added manually by a developer)
    Object.keys(buttons).forEach((btn) => {
      if (_order.indexOf(btn) === -1) {
        newbtnorder[btn] = buttons[btn];
      }
    });

    this.map.pm.Toolbar.buttons = newbtnorder;
    this._showHideButtons();
  },
  getControlOrder() {
    const buttons = this.getButtons();
    const order = [];
    for (const btn in buttons) {
      order.push(btn);
    }
    return order;
  },
  changeActionsOfControl(name, actions) {
    const btnName = this._btnNameMapping(name);

    if (!btnName) {
      throw new TypeError('No name passed');
    }
    if (!actions) {
      throw new TypeError('No actions passed');
    }

    if (!this.buttons[btnName]) {
      throw new TypeError('Button with this name not exists');
    }
    this.buttons[btnName]._button.actions = actions;
    this.changeControlOrder();
  },
  setButtonDisabled(name, state) {
    const btnName = this._btnNameMapping(name);
    if (state) {
      this.buttons[btnName].disable();
    } else {
      this.buttons[btnName].enable();
    }
  },
  _shapeMapping() {
    return {
      Marker: 'drawMarker',
      Circle: 'drawCircle',
      Polygon: 'drawPolygon',
      Rectangle: 'drawRectangle',
      Polyline: 'drawPolyline',
      Line: 'drawPolyline',
      CircleMarker: 'drawCircleMarker',
      Edit: 'editMode',
      Drag: 'dragMode',
      Cut: 'cutPolygon',
      Removal: 'removalMode',
      Rotate: 'rotateMode',
      Text: 'drawText',
      Split: 'splitMode',
      Freehand: 'drawFreehand',
      Point: 'drawPoint',
    };
  },
  _btnNameMapping(name) {
    const shapeMapping = this._shapeMapping();
    return shapeMapping[name] ? shapeMapping[name] : name;
  },
});

export default Toolbar;
