import { getTranslation } from './index';

/**
 * Shared helpers for the boolean-operation modes (Union, Difference, Split).
 * They replace existing layers with the result of a geometry operation and
 * follow the same lifecycle as Draw.Cut (see L.PM.Draw.Cut).
 */

export function isPolygonLayer(layer) {
  return layer instanceof L.Polygon; // includes L.Rectangle & GeoJSON polygons
}

/**
 * Applies the `layerPane` from the map global options (the map pm object has
 * no `_setPane`, that helper only exists on the Draw/Edit classes).
 */
export function setLayerPane(map, layer) {
  const panes = map.pm.globalOptions.panes;
  layer.options.pane = (panes && panes.layerPane) || 'overlayPane';
}

export function isRelevantLayer(layer) {
  return (
    layer.pm &&
    !(layer instanceof L.LayerGroup) &&
    ((!L.PM.optIn && !layer.options.pmIgnore) ||
      (L.PM.optIn && layer.options.pmIgnore === false)) &&
    !layer._pmTempLayer
  );
}

/**
 * Replaces `layers` on the map with the geometry of `geojson`.
 * Returns the resulting layer (or LayerGroup for multi-part results) or
 * null if the geojson is empty.
 */
export function replaceLayersWithGeoJSON(
  map,
  layers,
  geojson,
  keepOptionsFrom
) {
  if (!geojson) {
    return null;
  }

  const template = keepOptionsFrom || layers[0];

  let resultLayer = L.geoJSON(geojson, template.options);
  if (resultLayer.getLayers().length === 1) {
    [resultLayer] = resultLayer.getLayers(); // prevent an unnecessary layergroup
  }
  setLayerPane(map, resultLayer);
  const resultingLayer = resultLayer.addTo(map.pm._getContainingLayer());

  // transfer the pm options of the original layer
  resultingLayer.pm.enable(template.pm.options);
  resultingLayer.pm.disable();

  // remove the input layers without firing pm:remove
  layers.forEach((layer) => {
    layer._pmTempLayer = true;
    layer.remove();
    layer.removeFrom(map.pm._getContainingLayer());
  });

  if (resultingLayer instanceof L.LayerGroup) {
    resultingLayer.eachLayer((_layer) => {
      _layer._drawnByGeoman = true;
    });
  }
  resultingLayer._drawnByGeoman = true;

  return resultingLayer;
}

/**
 * Creates a temporary highlight polygon above a layer, so the selection of the
 * boolean modes is visible without touching the style of the original layer.
 */
export function addSelectionHighlight(layer, style) {
  const fullLatLngs = layer._map?.pm?._fullLatLngsOf?.(layer);
  const highlight = L.polygon(fullLatLngs || layer.getLatLngs(), {
    color: '#3388ff',
    weight: 3,
    fillOpacity: 0.1,
    dashArray: '5,5',
    interactive: false,
    pmIgnore: true,
    ...style,
  });
  highlight._pmTempLayer = true;
  highlight.addTo(layer._map);
  return highlight;
}

export function removeSelectionHighlight(highlight) {
  if (highlight) {
    highlight.remove();
  }
}

export function actionTooltip(key, action) {
  return getTranslation(key).replace('{action}', getTranslation(action));
}
