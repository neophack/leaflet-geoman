import SnapMixin from './Snapping';


const PinningMixin = {
  _initPinning: function() {
    if (this.options.allowPinning) {
      this._assignPinEvents(this._markers);
    }
  },

  _disablePinning: function(markers = this._markers) {
    const self = this;
    markers.forEach(function(marker) {
      if (Array.isArray(marker)) {
        self._disablePinning(marker);
      } else {
        marker.off('dragstart', self._onPinnedMarkerDragStart, self);
      }
    });
  },

  _assignPinEvents: function(markers) {
    const self = this;
    markers.forEach(function(marker) {
      if (Array.isArray(marker)) {
        self._assignPinEvents(marker);
      } else {
        marker.off('dragstart', self._onPinnedMarkerDragStart, self);
        marker.on('dragstart', self._onPinnedMarkerDragStart, self);
      }
    });
  },

  _onPinnedMarkerDragStart: function(event) {
    const self = this;
    this.pinnedVertices = [];
    this._enabledLayers = [];

    const target = event.target;
    const latlng = target.getLatLng();

    this.relevantLayers = [];
    L.PM.Utils.findLayers(this._map).forEach(function(layer) {
      if (self._isRelevantForPinning(layer) && self._layer !== layer) {
        self.relevantLayers.push(layer);
      }
    });

    this.relevantLayers.forEach(function(layer) {
      const latLngs = layer instanceof L.Marker || layer instanceof L.CircleMarker ? [layer.getLatLng()] : layer.getLatLngs();
      const indexPaths = L.PM.Utils.findDeepCoordIndex(latLngs, latlng, false);
      const pinnedVertex = { indexPaths: indexPaths, layer: layer };

      if (Object.keys(indexPaths).length > 0) {
        self.pinnedVertices.push(pinnedVertex);
        layer._pmTempLayer = true;

        if (layer.pm.enabled()) {
          self._enabledLayers.push(layer);
          layer.pm.disable();
        }

        if (layer instanceof L.Polyline && layer.pm && !layer.pm.options.allowSelfIntersection) {
          pinnedVertex.layer.pm._coordsBeforeEdit = Te(pinnedVertex.layer, pinnedVertex.layer.getLatLngs());
          if (!pinnedVertex.layer.pm.options.allowSelfIntersection && pinnedVertex.layer.pm.options.allowSelfIntersectionEdit && pinnedVertex.layer.pm.hasSelfIntersection()) {
            console.warn('allowSelfIntersectionEdit doesn\'t work with pinning.');
            pinnedVertex.layer.pm._markerAllowedToDrag = false;
          } else {
            pinnedVertex.layer.pm._markerAllowedToDrag = null;
          }
        }
      }
    });

    const eventType = event.type.includes('pm:') ? 'pm:' : '';
    if (this.pinnedVertices.length > 0) {
      target.on(eventType + 'drag', this._applyAnchorLatLng, this);
      target.off(eventType + 'dragend', this._onPinnedMarkerDragEnd, this);
      target.on(eventType + 'dragend', this._onPinnedMarkerDragEnd, this);
    }
  },

  _onPinnedMarkerDragEnd: function(event) {
    const self = this;
    const target = event.target;

    if (this.pinnedVertices.length > 0) {
      this._applyAnchorLatLng({ target: target, latlng: target.getLatLng() });

      const eventType = event.type.includes('pm:') ? 'pm:' : '';
      target.off(eventType + 'drag', this._applyAnchorLatLng, this);

      this.pinnedVertices.forEach(function(pinnedVertex) {
        const layer = pinnedVertex.layer;
        const indexPaths = pinnedVertex.indexPaths;

        delete layer._pmTempLayer;

        if (layer.pm || self) {
          layer.pm.enable();
        }

        if (layer instanceof L.Polyline && layer.pm) {
          let hasSelfIntersection = layer.pm.hasSelfIntersection();
          if (hasSelfIntersection && layer.pm.options.allowSelfIntersectionEdit && layer.pm._markerAllowedToDrag) {
            hasSelfIntersection = false;
          }

          if (!layer.pm.options.allowSelfIntersection && hasSelfIntersection) {
            layer.setLatLngs(layer.pm._coordsBeforeEdit);
            layer.pm._coordsBeforeEdit = null;
            layer.pm._handleLayerStyle();
            layer.pm._fireLayerReset(event, indexPaths.indexPath);
          } else if (!layer.pm.options.allowSelfIntersection && layer.pm.options.allowSelfIntersectionEdit) {
            layer.pm._handleLayerStyle();
          }
        }

        (layer.pm || self)._fireEdit(layer);
      });
    }

    this._enabledLayers.forEach(function(layer) {
      layer.pm.enable();
    });

    this.pinnedVertices = [];
    this._enabledLayers = [];
  },

  _applyAnchorLatLng: function(event) {
    const self = this;
    const latlng = event.target.getLatLng();

    // 遍历所有固定顶点
    this.pinnedVertices.forEach(function(pinnedVertex) {
      const layer = pinnedVertex.layer;
      const isMarker = layer instanceof L.Marker || layer instanceof L.CircleMarker;
      const isRectangle = layer instanceof L.Rectangle;
      var latLngs = isMarker ? [layer.getLatLng()] : layer.getLatLngs();
      const indexPaths = pinnedVertex.indexPaths;
      const indexPath = indexPaths.indexPath;
      const index = indexPaths.index;
      const parentPath = indexPaths.parentPath;

      // 如果顶点的路径长度大于1，说明顶点所在的图层是多边形的一部分，需要进行纬度限制
      // if (indexPath.length > 1) {
      //   // latLngs = self.kt(latLngs, parentPath);
      // }

      // if(latLngs.length==0){
      //   return;
      // }
      if(!Array.isArray(latLngs[0])){
        latLngs=[latLngs];
      }
      // console.log(latLngs);
      // 将顶点的经纬度替换为新的经纬度
      latLngs[0].splice(index, 1, latlng);

      if (isMarker) {
        // 如果图层是标记点或圆形标记点，则更新经纬度
        layer.setLatLng(latLngs[0][0]);
        if (layer.pm && layer instanceof L.CircleMarker) {
          layer.pm._updateHiddenPolyCircle();
        }
      } else if (isRectangle) {
        // 如果图层是矩形，则根据新的顶点经纬度计算旋转后的矩形，并更新图层的经纬度
        const nextIndex = (index + 2) % 4;
        const nextLatLng = latLngs[0][nextIndex];
        const rotatedRectangle = L.PM.Utils._getRotatedRectangle(latlng, nextLatLng, layer.pm?._angle || 0, self._map);
        layer.setLatLngs(rotatedRectangle);
        pinnedVertex.indexPaths = L.PM.Utils.findDeepCoordIndex(layer.getLatLngs(), latlng, false);
      } else if (layer instanceof L.Polyline && layer.pm) {
        // 如果图层是折线且具有编辑功能
        if (!layer.pm.options.allowSelfIntersection && layer.pm.options.allowSelfIntersectionEdit && layer.pm.hasSelfIntersection() && layer.pm._markerAllowedToDrag === false) {
          // 如果不允许自相交且编辑模式下发生了自相交且标记点不允许拖动，则恢复编辑前的经纬度并处理图层样式
          layer.setLatLngs(layer.pm._coordsBeforeEdit);
          layer.pm._handleLayerStyle();
        } else {
          // 允许自相交或处理图层样式后，更新经纬度
          if (self.options.allowSelfIntersection || layer.pm._handleLayerStyle()) {
            layer.setLatLngs(latLngs);
          }
        }
      } else {
        // 其他类型的图层直接更新经纬度
        layer.setLatLngs(latLngs);
      }
    });
  },

  clampLatitude: function(latitude, options) {
    if (options && options.crs && options.crs.projection && options.crs.projection.MAX_LATITUDE) {
      var maxLatitude = options.crs.projection.MAX_LATITUDE;
      latitude = Math.max(Math.min(maxLatitude, latitude), -maxLatitude);
    }
    return latitude;
  },
  _isRelevantForPinning: function(layer) {
    return (
      layer.pm &&
      !(layer instanceof L.LayerGroup) &&
      (!L.PM.optIn && !layer.options.pmIgnore || L.PM.optIn && layer.options.pmIgnore === false) &&
      !layer._pmTempLayer &&
      layer.pm.options.allowPinning &&
      (layer._latlng || (layer._latlngs && layer._latlngs.length > 0))
    );
  },
};
export default PinningMixin;