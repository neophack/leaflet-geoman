import merge from 'lodash/merge';

/**
 * SnapGuides Mixin.
 * While snapping, dashed guide lines are displayed: one along the snapped
 * segment (extended) and a cross of guides through the snap position for
 * every angle in `snapGuidesAngles` (each angle draws a line at that angle
 * plus its perpendicular, e.g. the default `[90]` draws a horizontal +
 * vertical cross). Enabled with `map.pm.setGlobalOptions({ showSnapGuides:
 * true })` or via the toolbar options block; style with `snapGuidesStyle`.
 * Included in every class that includes the Snapping mixin.
 */
const SnapGuidesMixin = {
  _updateSnapGuides(eventInfo) {
    const globalOptions =
      this._map && this._map.pm && this._map.pm.globalOptions;
    const enabled = globalOptions && globalOptions.showSnapGuides;

    if (!enabled) {
      this._hideSnapGuides();
      return;
    }

    const angles =
      globalOptions.snapGuidesAngles && globalOptions.snapGuidesAngles.length
        ? globalOptions.snapGuidesAngles
        : [90];
    const guideStyle = merge(
      {
        color: '#20c997',
        weight: 1,
        dashArray: '5,5',
        interactive: false,
        pmIgnore: true,
      },
      globalOptions.snapGuidesStyle || {}
    );

    // (re)create one guide for the snapped segment plus two per angle
    // (the angle itself and its perpendicular)
    const neededGuides = 1 + angles.length * 2;
    if (
      !this._snapGuideLayers ||
      this._snapGuideLayers.length !== neededGuides
    ) {
      this._hideSnapGuides();
      this._snapGuideLayers = Array.from({ length: neededGuides }, () =>
        L.polyline([], guideStyle)
      );
      this._snapGuideLayers.forEach((guide) => {
        guide._pmTempLayer = true;
        this._setPane(guide, 'layerPane');
        guide.addTo(this._map);
      });
    } else {
      this._snapGuideLayers.forEach((guide) => guide.setStyle(guideStyle));
    }

    const { snapLatLng, segment } = eventInfo;

    // guide along the snapped segment, extended beyond both ends
    if (segment && segment.length === 2) {
      const p1 = this._map.project(segment[0]);
      const p2 = this._map.project(segment[1]);
      const dir = p2.subtract(p1);
      const len = dir.distanceTo(L.point(0, 0)) || 1;
      const ext = dir.multiplyBy(5000 / len);
      this._snapGuideLayers[0].setLatLngs([
        this._map.unproject(p1.subtract(ext)),
        this._map.unproject(p2.add(ext)),
      ]);
    } else {
      this._snapGuideLayers[0].setLatLngs([]);
    }

    // one perpendicular cross of guides through the snap position per angle
    const bounds = this._map.getBounds().pad(0.5);
    const center = this._map.project(snapLatLng);
    const diag =
      L.point(bounds.getEast(), bounds.getNorth())
        .subtract(L.point(bounds.getWest(), bounds.getSouth()))
        .distanceTo(L.point(0, 0)) || 1;

    angles.forEach((angle, i) => {
      [angle, angle + 90].forEach((a, j) => {
        const rad = (a * Math.PI) / 180;
        const dir = L.point(Math.sin(rad), -Math.cos(rad)).multiplyBy(diag);
        this._snapGuideLayers[1 + i * 2 + j].setLatLngs([
          this._map.unproject(center.subtract(dir)),
          this._map.unproject(center.add(dir)),
        ]);
      });
    });
  },
  _hideSnapGuides() {
    if (this._snapGuideLayers) {
      this._snapGuideLayers.forEach((guide) => guide.remove());
      this._snapGuideLayers = undefined;
    }
  },
};

export default SnapGuidesMixin;
