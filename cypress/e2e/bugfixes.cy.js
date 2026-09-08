/**
 * Regression tests for bugs found during the e2e hardening pass.
 * Every test here failed before the corresponding fix.
 */
describe('Bugfixes', () => {
  const mapSelector = '#map';

  describe('Measurements', () => {
    it('shows a numeric area in the draw tooltip (no NaN)', () => {
      cy.window().then(({ map }) => {
        map.pm.setGlobalOptions({ showMeasurements: true });
      });

      cy.toolbarButton('polygon').click();
      cy.get(mapSelector).click(290, 250);
      cy.get(mapSelector).click(300, 50);
      cy.get(mapSelector).trigger('mousemove', 350, 100);

      cy.get('.leaflet-tooltip-bottom').then((el) => {
        expect(el.text()).to.not.include('NaN');
        expect(el.text()).to.match(/m²|ha|km²/);
      });
    });

    it('measureLayer does not crash on an empty polygon', () => {
      cy.window().then(({ map, L }) => {
        const layer = L.polygon([]).addTo(map);
        const m = map.pm.getMeasurement(layer);
        expect(m.area).to.eq(0);
        expect(m.length).to.eq(0);
      });
    });

    it('subtracts holes and sums parts in area & perimeter', () => {
      cy.window().then(({ map, L }) => {
        // 0.02 x 0.02 deg square with a centered 0.01 x 0.01 deg hole
        const outer = [
          [0, 0],
          [0, 0.02],
          [0.02, 0.02],
          [0.02, 0],
        ];
        const hole = [
          [0.005, 0.005],
          [0.005, 0.015],
          [0.015, 0.015],
          [0.015, 0.005],
        ];
        const withHole = L.polygon([outer, hole]).addTo(map);
        const solid = L.polygon([outer]).addTo(map);

        const mHole = map.pm.getMeasurement(withHole);
        const mSolid = map.pm.getMeasurement(solid);

        // the holed polygon must have a smaller area than the solid one
        expect(mHole.area).to.be.lessThan(mSolid.area);
        // roughly: outer area minus hole area
        const expected =
          map.pm.getMeasurement(L.polygon([outer])).area -
          map.pm.getMeasurement(L.polygon([hole])).area;
        expect(mHole.area).to.be.closeTo(expected, expected * 0.02);

        // perimeter of the holed polygon = outer ring + hole ring
        expect(mHole.length).to.be.greaterThan(mSolid.length);
      });
    });
  });

  describe('Undo / Redo', () => {
    it('tracks a copy exactly once', () => {
      cy.window().then(({ map, L }) => {
        L.polygon([
          [51.51, -0.1],
          [51.51, -0.08],
          [51.5, -0.08],
        ]).addTo(map);
        map.pm.clearUndoRedo();

        const source = map.pm.getGeomanLayers()[0];
        map.pm.copyLayer(source);

        expect(map.pm.hasUndo()).to.eq(true);
        // a single undo must remove the copy - a second phantom entry would
        // leave hasUndo() true and eat one more Ctrl+Z
        map.pm.undo();
        expect(map.pm.hasUndo()).to.eq(false);
        expect(map.pm.getGeomanLayers().length).to.eq(1);
      });
    });

    it('restores boolean-op sources as fully functional layers', () => {
      cy.window().then(({ map, L }) => {
        const a = L.polygon([
          [51.51, -0.12],
          [51.51, -0.1],
          [51.52, -0.1],
          [51.52, -0.12],
        ]).addTo(map);
        const b = L.polygon([
          [51.515, -0.11],
          [51.515, -0.09],
          [51.525, -0.09],
          [51.525, -0.11],
        ]).addTo(map);

        map.pm.union(a, b);
        expect(map.pm.getGeomanLayers().length).to.eq(1);

        map.pm.undo();
        const restored = map.pm.getGeomanLayers();
        expect(restored.length).to.eq(2);
        restored.forEach((layer) => {
          // restored layers must not stay internal temp layers
          expect(layer._pmTempLayer).to.eq(undefined);
        });
        // and they must be found by the global modes again
        const found = L.PM.Utils.findLayers(map);
        expect(found.filter((l) => l === a || l === b).length).to.eq(2);
      });
    });

    it('redo of a boolean op re-removes the sources', () => {
      cy.window().then(({ map, L }) => {
        const a = L.polygon([
          [51.51, -0.12],
          [51.51, -0.1],
          [51.52, -0.1],
          [51.52, -0.12],
        ]).addTo(map);
        const b = L.polygon([
          [51.515, -0.11],
          [51.515, -0.09],
          [51.525, -0.09],
          [51.525, -0.11],
        ]).addTo(map);

        map.pm.union(a, b);
        map.pm.undo();
        map.pm.redo();

        const layers = map.pm.getGeomanLayers();
        expect(layers.length).to.eq(1);
        expect(layers[0]).to.not.eq(a);
        expect(layers[0]).to.not.eq(b);
      });
    });
  });

  describe('Freehand', () => {
    it('restores map dragging when the mode is disabled mid-stroke', () => {
      cy.window().then(({ map, L }) => {
        map.pm.Draw.Freehand.enable();

        const center = map.getCenter();
        map.fire('mousedown', {
          latlng: center,
          originalEvent: { button: 0 },
        });
        map.fire('mousemove', {
          latlng: L.latLng(center.lat + 0.01, center.lng + 0.01),
          originalEvent: { button: 0 },
        });

        expect(map.dragging.enabled(), 'dragging disabled mid-stroke').to.eq(
          false
        );
        // exiting the mode mid-stroke must re-enable map dragging
        map.pm.Draw.Freehand.disable();
        expect(map.dragging.enabled(), 'dragging restored on disable').to.eq(
          true
        );
      });
    });
  });

  describe('Events', () => {
    it('fires pm:globallinesimplificationmodetoggled with the correct name', () => {
      cy.window().then(({ map, L }) => {
        L.polyline([
          [51.5, -0.1],
          [51.51, -0.09],
        ]).addTo(map);

        let fired = 0;
        map.on('pm:globallinesimplificationmodetoggled', () => {
          fired += 1;
        });
        map.pm.enableGlobalLineSimplificationMode();
        map.pm.disableGlobalLineSimplificationMode();
        expect(fired).to.eq(2);
      });
    });
  });

  describe('Copy mode', () => {
    it('copies a text layer without stealing the original textarea', () => {
      cy.window().then(({ map, L }) => {
        const textLayer = L.marker(map.getCenter(), {
          textMarker: true,
          text: 'Hello Copy',
        }).addTo(map);
        textLayer.pm.setText('Hello Copy');

        const copy = map.pm.copyLayer(textLayer);

        // both layers must have their own textarea showing the text
        const originalElement = textLayer.getElement();
        const copyElement = copy.getElement();
        expect(originalElement).to.not.eq(copyElement);

        const originalTextArea = originalElement.querySelector('textarea');
        const copyTextArea = copyElement.querySelector('textarea');
        expect(originalTextArea, 'original keeps its textarea').to.not.eq(null);
        expect(copyTextArea, 'copy has its own textarea').to.not.eq(null);
        expect(originalTextArea.value).to.eq('Hello Copy');
        expect(copyTextArea.value).to.eq('Hello Copy');
      });
    });

    it('copies an ImageOverlay', () => {
      cy.window().then(({ map, L }) => {
        // 1x1 transparent png
        const url =
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
        const bounds = [
          [51.5, -0.1],
          [51.51, -0.09],
        ];
        const overlay = L.imageOverlay(url, bounds).addTo(map);

        const copy = map.pm.copyLayer(overlay);
        expect(copy, 'copy created').to.not.eq(undefined);
        expect(copy.getBounds().equals(L.latLngBounds(bounds))).to.eq(false);
        expect(copy.getBounds().getSouth()).to.be.closeTo(
          overlay.getBounds().getSouth(),
          0.01
        );
      });
    });
  });

  describe('Categories', () => {
    it('propagates the category onto cut results', () => {
      cy.window().then(({ map, L }) => {
        map.pm.setCategory('river', { pathOptions: { color: '#0088ff' } });
        const poly = L.polygon([
          [51.5, -0.12],
          [51.5, -0.08],
          [51.53, -0.08],
          [51.53, -0.12],
        ]).addTo(map);
        poly.pm.setCategory('river', { silent: true });
        map.fitBounds(poly.getBounds());

        // cut the polygon with a thin vertical strip through the middle
        // (programmatic cut with snapping disabled for determinism)
        const b = poly.getBounds().pad(0.2);
        const midLng = (b.getWest() + b.getEast()) / 2;
        const eps = (b.getEast() - b.getWest()) * 0.02;
        map.pm.Draw.Cut.enable({ snappable: false });
        map.pm.Draw.Cut._layer.setLatLngs([
          [b.getSouth(), midLng - eps],
          [b.getNorth(), midLng - eps],
          [b.getNorth(), midLng + eps],
          [b.getSouth(), midLng + eps],
        ]);
        map.pm.Draw.Cut._finishShape();

        const results = L.PM.Utils.findLayers(map).filter(
          (l) => l instanceof L.Polygon
        );
        expect(map.hasLayer(poly), 'original layer removed').to.eq(false);
        expect(results.length, 'cut produced result layers').to.be.greaterThan(
          0
        );
        results.forEach((layer) => {
          expect(layer.pm.getCategory()).to.eq('river');
        });
      });
    });

    it('does not stamp a category when only some sources have one', () => {
      cy.window().then(({ map, L }) => {
        const categorized = L.polygon([
          [51.51, -0.12],
          [51.51, -0.1],
          [51.52, -0.1],
          [51.52, -0.12],
        ]).addTo(map);
        categorized.pm.setCategory('river', { silent: true });
        const plain = L.polygon([
          [51.515, -0.11],
          [51.515, -0.09],
          [51.525, -0.09],
          [51.525, -0.11],
        ]).addTo(map);

        const result = map.pm.union(categorized, plain);
        expect(result).to.not.eq(undefined);
        expect(result.pm.getCategory()).to.eq(undefined);
      });
    });
  });

  describe('Global options', () => {
    it('setGlobalOptions() without arguments does not throw', () => {
      cy.window().then(({ map }) => {
        expect(() => map.pm.setGlobalOptions()).to.not.throw();
      });
    });
  });

  describe('Keyboard', () => {
    it('Ctrl+Z only undoes the map the user interacts with', () => {
      cy.window().then(({ map, L, document: doc }) => {
        // draw undo history on the first map
        const source1 = L.polygon([
          [51.51, -0.12],
          [51.51, -0.1],
          [51.52, -0.1],
        ]).addTo(map);
        map.pm.copyLayer(source1);
        expect(map.pm.hasUndo()).to.eq(true);

        // a second map on the same page
        const el = doc.createElement('div');
        el.id = 'second-map';
        el.style.cssText =
          'width:300px;height:200px;position:absolute;top:0;left:0;z-index:5000;';
        doc.body.appendChild(el);
        const map2 = L.map('second-map').setView([51.505, -0.09], 13);
        const source2 = L.polygon([
          [51.51, -0.12],
          [51.51, -0.1],
          [51.52, -0.1],
        ]).addTo(map2);
        map2.pm.copyLayer(source2);
        expect(map2.pm.hasUndo()).to.eq(true);

        // press Ctrl+Z while interacting with the second map
        const event = new KeyboardEvent('keydown', {
          key: 'z',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        map2.getContainer().dispatchEvent(event);

        expect(map2.pm.hasUndo(), 'second map undid its action').to.eq(false);
        expect(map.pm.hasUndo(), 'first map keeps its history').to.eq(true);

        map2.remove();
        el.remove();
      });
    });
  });

  describe('Large layer rendering (issue #366)', () => {
    // builds a noisy line with 1500 vertices (> largeLayerThreshold 1000)
    const makeLargeLine = (L) => {
      const pts = [];
      for (let i = 0; i < 1500; i += 1) {
        pts.push([
          51.49 + (i / 1500) * 0.04,
          -0.13 + (i / 1500) * 0.04 + Math.sin(i / 20) * 0.002,
        ]);
      }
      return pts;
    };

    it('whole-layer drag of an optimized layer persists after map move', () => {
      cy.window().then(({ map, L }) => {
        const layer = L.polyline(makeLargeLine(L)).addTo(map);
        map.fitBounds(layer.getBounds());
        // sanity: the layer got optimized
        expect(layer._pmOptimize, 'layer is optimized').to.not.eq(undefined);

        const before = map.pm
          ._fullLatLngsOf(layer)
          .map((ll) => ({ lat: ll.lat, lng: ll.lng }));

        map.pm.enableGlobalDragMode();

        // drag the layer 50px to the right via the drag mixin handlers
        layer.pm._dragMixinOnMouseDown({
          originalEvent: { button: 0 },
          target: layer,
          latlng: map.containerPointToLatLng([400, 250]),
        });
        layer.pm._dragMixinOnMouseMove({
          originalEvent: { button: 0 },
          target: layer,
          latlng: map.containerPointToLatLng([450, 250]),
        });
        layer.pm._dragMixinOnMouseUp({
          originalEvent: { button: 0 },
          target: layer,
          latlng: map.containerPointToLatLng([450, 250]),
        });

        cy.wrap(before).as('beforeDrag');
        cy.wrap(layer).as('draggedLayer');
      });

      // wait for the drag-end timeout inside the drag mixin
      cy.wait(50);

      cy.window().then(({ map }) => {
        // re-render happens on moveend - before the fix the drag reverted here
        map.fire('moveend');
      });

      cy.window().then(({ map }) => {
        cy.get('@beforeDrag').then((before) => {
          cy.get('@draggedLayer').then((layer) => {
            const after = map.pm._fullLatLngsOf(layer);
            expect(after.length).to.eq(before.length);
            // the drag moved every vertex to the east
            expect(after[0].lng).to.be.greaterThan(before[0].lng);
            expect(after[10].lat).to.be.closeTo(before[10].lat, 1e-6);
          });
        });
      });

      cy.window().then(({ map }) => {
        map.pm.disableGlobalDragMode();
      });
    });

    it('external setLatLngs on an optimized layer replaces the full geometry', () => {
      cy.window().then(({ map, L }) => {
        const layer = L.polyline(makeLargeLine(L)).addTo(map);
        map.fitBounds(layer.getBounds());
        expect(layer._pmOptimize).to.not.eq(undefined);

        const newCoords = [
          [51.52, -0.12],
          [51.52, -0.1],
          [51.53, -0.11],
        ];
        layer.setLatLngs(newCoords);

        // re-render on moveend used to revert the write
        map.fire('moveend');

        const full = map.pm._fullLatLngsOf(layer);
        expect(full.length).to.eq(3);
        expect(full[0].lat).to.be.closeTo(51.52, 1e-9);
      });
    });

    it('cutting an optimized polygon keeps the full vertex detail', () => {
      cy.window().then(({ map, L }) => {
        // a polygon with > 1000 vertices on its ring
        const ring = [];
        for (let i = 0; i < 1200; i += 1) {
          const angle = (i / 1200) * Math.PI * 2;
          ring.push([
            51.51 + Math.sin(angle) * 0.02,
            -0.1 + Math.cos(angle) * 0.02,
          ]);
        }
        const poly = L.polygon(ring).addTo(map);
        map.fitBounds(poly.getBounds());
        expect(poly._pmOptimize, 'layer is optimized').to.not.eq(undefined);

        // cut the polygon with a thin vertical strip through the middle
        // (programmatic cut with snapping disabled for determinism)
        const b = poly.getBounds().pad(0.2);
        const midLng = (b.getWest() + b.getEast()) / 2;
        const eps = (b.getEast() - b.getWest()) * 0.02;
        map.pm.Draw.Cut.enable({ snappable: false });
        map.pm.Draw.Cut._layer.setLatLngs([
          [b.getSouth(), midLng - eps],
          [b.getNorth(), midLng - eps],
          [b.getNorth(), midLng + eps],
          [b.getSouth(), midLng + eps],
        ]);
        map.pm.Draw.Cut._finishShape();

        const results = L.PM.Utils.findLayers(map).filter(
          (l) => l instanceof L.Polygon
        );
        // the original layer must be replaced by the cut result(s)
        expect(map.hasLayer(poly), 'original layer removed').to.eq(false);
        expect(results.length, 'cut produced result layers').to.be.greaterThan(
          0
        );
        const totalVertices = results.reduce(
          (sum, l) =>
            sum +
            (map.pm._fullLatLngsOf(l) || l.getLatLngs()).flat(Infinity).length,
          0
        );
        // the original ring had 1200 vertices - the cut adds intersection
        // points but must not lose the original vertices to the decimation
        expect(totalVertices).to.be.greaterThan(1000);
      });
    });

    it('rotateLayer() on an optimized layer persists after map move', () => {
      cy.window().then(({ map, L }) => {
        const pts = [];
        for (let i = 0; i < 1500; i += 1) {
          pts.push([51.5 + (i / 1500) * 0.03, -0.12 + (i / 1500) * 0.03]);
        }
        const layer = L.polyline(pts).addTo(map);
        map.fitBounds(layer.getBounds());
        expect(layer._pmOptimize).to.not.eq(undefined);

        const before = map.pm
          ._fullLatLngsOf(layer)
          .map((ll) => ({ lat: ll.lat, lng: ll.lng }));

        layer.pm.rotateLayer(45);

        map.fire('moveend');

        const after = map.pm._fullLatLngsOf(layer);
        expect(after.length).to.eq(before.length);
        // rotated geometry differs from the original
        expect(after[0].lat).to.not.be.closeTo(before[0].lat, 1e-9);
      });
    });

    it('does not optimize layers with pmIgnore', () => {
      cy.window().then(({ map, L }) => {
        const pts = makeLargeLine(L);
        const layer = L.polyline(pts, { pmIgnore: true }).addTo(map);
        // pmIgnore layers are excluded from geoman - the optimization must
        // not swap their geometry either
        expect(layer._pmOptimize).to.eq(undefined);
        expect(layer.getLatLngs().length).to.eq(1500);
      });
    });
  });

  describe('Undo / Redo (extended)', () => {
    it('programmatic rotateLayer is undoable and restores the angle', () => {
      cy.window().then(({ map, L }) => {
        const layer = L.polygon([
          [51.51, -0.12],
          [51.51, -0.1],
          [51.52, -0.1],
          [51.52, -0.12],
        ]).addTo(map);
        map.fitBounds(layer.getBounds());
        map.pm.clearUndoRedo();

        const before = layer
          .getLatLngs()[0]
          .map((ll) => ({ lat: ll.lat, lng: ll.lng }));

        layer.pm.rotateLayer(45);
        expect(map.pm.hasUndo(), 'rotation is tracked').to.eq(true);
        expect(layer.pm.getAngle()).to.be.closeTo(45, 0.5);

        map.pm.undo();
        expect(layer.pm.getAngle(), 'angle restored').to.be.closeTo(0, 0.5);
        const after = layer.getLatLngs()[0];
        expect(after[0].lat).to.be.closeTo(before[0].lat, 1e-9);
        expect(after[0].lng).to.be.closeTo(before[0].lng, 1e-9);
      });
    });

    it('tracks ImageOverlay drags for undo', () => {
      cy.window().then(({ map, L }) => {
        const url =
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
        const overlay = L.imageOverlay(url, [
          [51.5, -0.1],
          [51.51, -0.09],
        ]).addTo(map);
        map.fitBounds(overlay.getBounds());
        map.pm.clearUndoRedo();

        const before = overlay.getBounds();

        overlay.pm.enableLayerDrag();
        overlay.pm._dragMixinOnMouseDown({
          originalEvent: { button: 0 },
          target: overlay,
          latlng: map.containerPointToLatLng([400, 250]),
        });
        overlay.pm._dragMixinOnMouseMove({
          originalEvent: { button: 0 },
          target: overlay,
          latlng: map.containerPointToLatLng([430, 270]),
        });
        overlay.pm._dragMixinOnMouseUp({
          originalEvent: { button: 0 },
          target: overlay,
          latlng: map.containerPointToLatLng([430, 270]),
        });

        cy.wrap(overlay).as('overlay');
        cy.wrap([
          [before.getSouth(), before.getWest()],
          [before.getNorth(), before.getEast()],
        ]).as('beforeBounds');
      });

      // wait for the drag-end timeout inside the drag mixin
      cy.wait(50);

      cy.window().then(({ map }) => {
        cy.get('@overlay').then((overlay) => {
          cy.get('@beforeBounds').then((before) => {
            expect(
              overlay.getBounds().getSouth(),
              'drag moved the overlay'
            ).to.not.be.closeTo(before[0][0], 1e-9);
            expect(map.pm.hasUndo(), 'drag is tracked').to.eq(true);

            map.pm.undo();
            expect(overlay.getBounds().getSouth()).to.be.closeTo(
              before[0][0],
              1e-9
            );
            expect(overlay.getBounds().getWest()).to.be.closeTo(
              before[0][1],
              1e-9
            );
          });
        });
      });
    });

    it('removing the last vertices of a layer is undoable', () => {
      // draw a triangle
      cy.toolbarButton('polygon').click();
      cy.get(mapSelector).click(120, 150);
      cy.get(mapSelector).click(120, 100);
      cy.get(mapSelector).click(300, 100);
      cy.get(mapSelector).click(120, 150);
      cy.hasDrawnLayers(1);

      // remove a vertex -> a polygon below 3 vertices is removed entirely
      cy.toolbarButton('edit').click();
      cy.get('.marker-icon:not(.marker-icon-middle)')
        .first()
        .trigger('contextmenu');
      cy.hasDrawnLayers(0);

      cy.window().then(({ map }) => {
        expect(map.pm.hasUndo(), 'removal is tracked').to.eq(true);
        map.pm.undo();
        const layers = map.pm.getGeomanLayers();
        expect(layers.length, 'layer restored').to.eq(1);
        expect(
          layers[0].getLatLngs()[0].length,
          'with its vertices'
        ).to.be.greaterThan(2);
      });
    });
  });

  describe('Measurements (extended)', () => {
    it('never overwrites or removes a user-bound tooltip', () => {
      cy.window().then(({ map, L }) => {
        const layer = L.polygon([
          [51.5, -0.12],
          [51.5, -0.1],
          [51.52, -0.1],
        ]).addTo(map);
        layer.bindTooltip('my tooltip', { permanent: true });

        map.pm.setGlobalOptions({ showMeasurements: true });
        expect(layer.getTooltip().getContent(), 'user tooltip untouched').to.eq(
          'my tooltip'
        );

        map.pm.setGlobalOptions({ showMeasurements: false });
        expect(layer.getTooltip(), 'user tooltip not removed').to.not.eq(
          undefined
        );
        expect(layer.getTooltip().getContent()).to.eq('my tooltip');
      });
    });

    it('binds and removes its own measurement tooltip', () => {
      cy.window().then(({ map, L }) => {
        const layer = L.polygon([
          [51.5, -0.12],
          [51.5, -0.1],
          [51.52, -0.1],
        ]).addTo(map);

        map.pm.setGlobalOptions({ showMeasurements: true });
        const tooltip = layer.getTooltip();
        expect(tooltip, 'measurement tooltip bound').to.not.eq(undefined);
        expect(tooltip.getContent()).to.match(/m²|ha|km²/);

        map.pm.setGlobalOptions({ showMeasurements: false });
        expect(layer.getTooltip(), 'measurement tooltip removed').to.not.exist;
      });
    });
  });

  describe('Snapping / Pinning cannot create degenerate vertices (stress)', () => {
    const mapSelector = '#map';

    const ringHasAdjacentDuplicates = (ring) =>
      ring.some((ll, i) => ll.equals(ring[(i + 1) % ring.length]));

    const ringHasDuplicateVertices = (ring) =>
      ring.some((a, i) => ring.some((b, j) => i !== j && a.equals(b)));

    // a rectangle whose north-east corner is shared with a triangle vertex
    const setupSharedCornerLayers = ({ map, L }) => {
      const c = map.getCenter();
      const shared = L.latLng(c.lat + 0.004, c.lng - 0.006);
      const rect = L.rectangle([
        L.latLng(c.lat - 0.004, c.lng - 0.008),
        shared,
      ]).addTo(map);
      const tri = L.polygon([
        shared,
        L.latLng(c.lat + 0.004, c.lng - 0.013),
        L.latLng(c.lat + 0.01, c.lng - 0.009),
      ]).addTo(map);
      return { shared, rect, tri };
    };

    const dragVertexTo = (map, marker, targetPoint) => {
      const from = map.latLngToContainerPoint(marker.getLatLng());
      const steps = 6;
      cy.get(mapSelector).trigger('mousedown', from.x, from.y, {
        which: 1,
      });
      for (let i = 1; i <= steps; i += 1) {
        const x = from.x + ((targetPoint.x - from.x) * i) / steps;
        const y = from.y + ((targetPoint.y - from.y) * i) / steps;
        cy.get(mapSelector).trigger('mousemove', x, y, { which: 1 });
      }
      cy.get(mapSelector).trigger('mouseup', targetPoint.x, targetPoint.y, {
        which: 1,
      });
    };

    beforeEach(() => {
      cy.window().then(({ map }) => {
        map.pm.setGlobalOptions({ snappable: true, snapDistance: 30 });
      });
    });

    it("snapping doesn't collapse a vertex onto another vertex of the same layer", () => {
      cy.window().then(({ map, L }) => {
        const { shared, tri } = setupSharedCornerLayers({ map, L });
        tri.pm.enable();
        cy.wrap(tri).as('tri');
        cy.wrap(shared).as('shared');

        // drag the second triangle vertex right next to the corner the
        // triangle shares with the rectangle
        const marker = tri.pm._markers[0][1];
        const target = map.latLngToContainerPoint(shared);
        dragVertexTo(map, marker, {
          x: target.x - 2,
          y: target.y - 2,
        });
      });

      cy.window().then(() => {
        cy.get('@tri').then((tri) => {
          cy.get('@shared').then((shared) => {
            const ring = tri.getLatLngs()[0];
            expect(
              ring[1].equals(shared),
              'vertex not snapped onto the shared corner'
            ).to.eq(false);
            expect(
              ringHasAdjacentDuplicates(ring),
              'no zero-length edge'
            ).to.eq(false);
          });
        });
      });
    });

    it("several vertices can't be snapped onto the same point (repeated drags)", () => {
      cy.window().then(({ map, L }) => {
        const { shared, tri } = setupSharedCornerLayers({ map, L });
        tri.pm.enable();
        cy.wrap(tri).as('tri');

        const target = map.latLngToContainerPoint(shared);
        dragVertexTo(map, tri.pm._markers[0][1], {
          x: target.x + 3,
          y: target.y - 2,
        });
        dragVertexTo(map, tri.pm._markers[0][2], {
          x: target.x - 2,
          y: target.y + 3,
        });
        // and drag the first one back near the shared corner again
        dragVertexTo(map, tri.pm._markers[0][1], {
          x: target.x - 4,
          y: target.y - 1,
        });
      });

      cy.window().then(() => {
        cy.get('@tri').then((tri) => {
          const ring = tri.getLatLngs()[0];
          expect(ringHasDuplicateVertices(ring), 'all vertices distinct').to.eq(
            false
          );
          expect(ringHasAdjacentDuplicates(ring), 'no zero-length edge').to.eq(
            false
          );
        });
      });
    });

    it("drawing can't place two vertices on the same snapped point", () => {
      cy.window().then(({ map, L }) => {
        const c = map.getCenter();
        L.rectangle([
          L.latLng(c.lat - 0.004, c.lng - 0.008),
          L.latLng(c.lat + 0.004, c.lng - 0.006),
        ]).addTo(map);
        const corner = map.latLngToContainerPoint(
          L.latLng(c.lat + 0.004, c.lng - 0.006)
        );
        cy.wrap(corner).as('corner');
      });

      cy.toolbarButton('polygon').click();
      cy.get('@corner').then(({ x, y }) => {
        // start away from the corner so the near-corner clicks don't hit
        // the first-vertex anchor (which would try to finish the polygon)
        cy.get(mapSelector).click(x - 60, y - 40);
        // both following clicks are within snapDistance of the rectangle corner
        cy.get(mapSelector).click(x - 2, y - 2);
        cy.get(mapSelector).click(x + 15, y + 15);
        cy.get('.active .action-finish').click();
      });

      cy.window().then(({ map }) => {
        const layers = map.pm.getGeomanDrawLayers();
        expect(layers.length).to.eq(1);
        const ring = layers[0].getLatLngs()[0];
        expect(
          ringHasDuplicateVertices(ring),
          'no two vertices on the same point'
        ).to.eq(false);
      });
    });

    it("pinning doesn't move a shared vertex onto another vertex of the pinned layer", () => {
      cy.window().then(({ map, L }) => {
        map.pm.setGlobalOptions({ pinning: true });
        const { rect, tri } = setupSharedCornerLayers({ map, L });
        tri.pm.enable();
        rect.pm.enable();
        cy.wrap(tri).as('tri');
        cy.wrap(rect).as('rect');

        // drag the shared corner (both a triangle and a rectangle vertex)
        // towards the second triangle vertex, stopping just short of it
        const marker = tri.pm._markers[0][0];
        const target = map.latLngToContainerPoint(tri.getLatLngs()[0][1]);
        dragVertexTo(map, marker, {
          x: target.x - 8,
          y: target.y - 8,
        });
      });

      cy.window().then(() => {
        cy.get('@tri').then((tri) => {
          cy.get('@rect').then((rect) => {
            expect(
              ringHasAdjacentDuplicates(tri.getLatLngs()[0]),
              'triangle has no zero-length edge'
            ).to.eq(false);
            expect(
              ringHasAdjacentDuplicates(rect.getLatLngs()[0]),
              'pinned rectangle has no zero-length edge'
            ).to.eq(false);
          });
        });
      });
    });

    it('polygon completion still snaps to the first vertex', () => {
      cy.toolbarButton('polygon').click();
      cy.get(mapSelector).click(230, 230);
      cy.get(mapSelector).click(330, 230);
      cy.get(mapSelector).click(280, 300);
      // move and click next to the first vertex - the completion snap
      // (first-vertex anchor) must still be allowed
      cy.get(mapSelector).click(235, 235);
      cy.window().then(({ map }) => {
        const layers = map.pm.getGeomanDrawLayers();
        expect(layers.length).to.eq(1);
        const ring = layers[0].getLatLngs()[0];
        expect(ring.length).to.eq(3);
        expect(ringHasDuplicateVertices(ring)).to.eq(false);
      });
    });

    it("rectangle draw doesn't get stuck on a stale hint-marker snap", () => {
      let mapCanvas;

      cy.window().then(({ L, map }) => {
        map.remove();
        mapCanvas = L.map('map', { preferCanvas: true }).setView(
          [51.505, -0.09],
          13
        );
        mapCanvas.pm.addControls();
      });

      cy.toolbarButton('rectangle').click();
      cy.get(mapSelector).click(191, 216).click(608, 323);

      // the start click at (230, 230) is within snapDistance of the first
      // rectangle's top edge, so the hint marker snaps there. No mousemove
      // happens before the finish click at (350, 350) - the stale snap must
      // not pin the finish corner to the (equal) start position, which
      // would leave the draw stuck (every further click hits the same
      // `A.equals(B)` early-return in _finishShape)
      cy.toolbarButton('rectangle').click();
      cy.get(mapSelector).click(230, 230).click(350, 350);

      cy.window().then(() => {
        const layers = mapCanvas.pm.getGeomanDrawLayers();
        expect(layers.length, 'both rectangles created').to.eq(2);
        const ring = layers[1].getLatLngs()[0];
        expect(
          ringHasAdjacentDuplicates(ring),
          'no degenerate rectangle'
        ).to.eq(false);
      });
    });
  });
});
