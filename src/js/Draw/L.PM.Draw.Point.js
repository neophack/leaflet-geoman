import Draw from './L.PM.Draw';
import { getTranslation } from '../helpers';

/**
 * Point drawing: marks an exact position with a small solid dot (like the
 * circle at the endpoints of polylines), in contrast to the teardrop shaped
 * Marker. The radius is in screen pixels, so the dot stays the same size at
 * every zoom level. Placed with a single click.
 */
Draw.Point = Draw.CircleMarker.extend({
  initialize(map) {
    // runs the CircleMarker initialize (sets f.ex. _BaseCircleClass)
    Draw.CircleMarker.prototype.initialize.call(this, map);
    this._map = map;
    this._shape = 'Point';
    this.toolbarButtonName = 'drawPoint';
    this._defaultRadius = 6;
    // merge into a copy of the inherited options (L.Class.extend shadows options)
    L.Util.setOptions(this, {
      resizeableCircleMarker: false,
      pathOptions: {
        color: '#424242',
        fillColor: '#ffffff',
        fillOpacity: 1,
        weight: 2,
      },
    });
  },
  enable(options) {
    Draw.CircleMarker.prototype.enable.call(this, options);
    // show the point tooltip instead of the circle marker one
    if (this.options.tooltips && this._hintMarker?.getTooltip()) {
      this._hintMarker.setTooltipContent(getTranslation('tooltips.placePoint'));
    }
  },
});

export default Draw.Point;
