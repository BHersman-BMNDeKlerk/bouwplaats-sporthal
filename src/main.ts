import './styles.css';
import * as THREE from 'three';
import { LocalFrame, fmtM, fmtNAP, fmtRD } from './core/coords';
import { mergeLayers, type LayerState, type SporthalMode } from './core/layers';
import { emptyProject, parseProject, ProjectStore, type ProjectData } from './core/project';
import { PROJECT } from './core/projectConfig';
import { CLASS_STYLES } from './data/bgt';
import { effectiveHeights, relative } from './data/heights';
import { loadAll, type LoadedData } from './data/loader';
import { BuildingsLayer, type BuildingObj } from './scene/buildingsLayer';
import { DesignLayer } from './scene/designLayer';
import { placeRings, type Placement } from './data/ifcGeom';
import { ObstaclesLayer, type Obstacle } from './scene/obstaclesLayer';
import { TerrainLayer } from './scene/terrainLayer';
import { effectiveTree, TreesLayer } from './scene/treesLayer';
import { Viewer } from './scene/viewer';
import { closeModal, helpContent, modalOpen, openModal, sourcesContent } from './ui/dialogs';
import { $, escapeHtml, h } from './ui/dom';
import { InfoPanel } from './ui/infoPanel';
import { renderLayersPanel } from './ui/layersPanel';
import { loadLocal, saveLocal } from './core/storage';
import { activeBoundary, ownParcels, type ActiveBoundary } from './core/boundary';
import type { ManualKind, ManualObject } from './core/project';
import { dxfOverlay, GRENS_KLEUR, hitKlic, hitManual, hitSurvey, klicOverlay, MANUAL_STYLE, manualOverlay, surveyOverlay, type KlicHit, type SurveyHit } from './scene/overlays';
import { UserLayer } from './scene/userLayer';
import { DrawTool, type DrawGeom } from './scene/drawTool';
import { EditHandles } from './scene/editHandles';
import { MeasureTool } from './scene/measureTool';
import { ElementsLayer } from './scene/elementsLayer';
import { ElementHandles, type ElementHandleKind } from './scene/elementHandles';
import { alignToEdge, carsForBay, checkCollisions, ELEMENTS, footprint, newElement, snapAngle, totalHeight, type Conflict, type Element, type ElementType, type Obstacle2D } from './core/elements';
import { elementsOverlay } from './scene/overlays';
import { SnapIndex, type MeasurePoint } from './core/measure';
import { BOUWHEK, clampGate, nearestPanel, panels, snapFrom, totalLength, type Pt } from './core/polyline';
import { editCodes, importBoundary, importDxf, importKlic, importPoints, type ImportContext } from './ui/importDialogs';
import { themaStyle } from './data/klic';
import { RouteEngine, newRoute, type Route } from './vehicles/routes';
import { VEHICLES } from './vehicles/vehicles';
import { bboxOf, type RouteObstacle } from './vehicles/sweep';
import type { Sample } from './vehicles/kinematics';
import { RouteLayer, hitRoute, routesOverlay, ROUTE_KLEUR } from './scene/routeLayer';
import { routePanel } from './ui/routePanel';
import { gatePanels } from './core/polyline';
import { canLift, craneWarnings, newMK88, newMobileCrane, newTowerCrane, overlaps, type Crane, type CraneEnv, type CraneWarning, type LiftCheck } from './cranes/cranes';
import { CraneLayer, cranesOverlay, hitCrane, type LiftMarker } from './scene/craneLayer';
import { cranePanel } from './ui/cranePanel';

const AUTOSAVE_KEY = 'bouwplaats-sporthal-latourpad:project';

type Selection =
  | { kind: 'building'; id: string }
  | { kind: 'tree'; index: number }
  | { kind: 'obstacle'; id: string }
  | { kind: 'terrain'; x: number; y: number }
  | { kind: 'design'; zone: number | null }
  | { kind: 'klic'; refId: string; lineId: string; x: number; y: number }
  | { kind: 'meetpunt'; index: number; grens: boolean }
  | { kind: 'manual'; id: string }
  | { kind: 'grens' }
  | { kind: 'klicRef'; id: string }
  | { kind: 'dxf'; id: string }
  | { kind: 'element'; id: string }
  | { kind: 'route'; id: string }
  | { kind: 'crane'; id: string }
  | { kind: 'lift' }
  | null;

async function start() {
  const loadingMsg = $('loadingMsg');
  let data: LoadedData;
  try {
    data = await loadAll((m) => (loadingMsg.textContent = m));
  } catch (e) {
    const l = $('loading');
    l.classList.add('error');
    l.innerHTML = `<h2>Kan de data niet laden</h2><p>${escapeHtml((e as Error).message)}</p>`;
    return;
  }
  loadingMsg.textContent = '3D-scène opbouwen…';
  await new Promise((r) => setTimeout(r, 20));

  const m = data.manifest;
  const frame = new LocalFrame(m.origin.x, m.origin.y);
  const viewer = new Viewer($('viewport'), frame);

  // --- lagen
  const terrain = new TerrainLayer(data, frame);
  viewer.scene.add(terrain.group);
  const buildings = data.buildings ? new BuildingsLayer(data.buildings.gebouwen, data.buildings.origin, frame, PROJECT.bagPandId) : null;
  if (buildings) viewer.scene.add(buildings.group);
  const trees = data.trees ? new TreesLayer(data.trees.bomen, frame) : null;
  if (trees) viewer.scene.add(trees.group);
  const obstacles = new ObstaclesLayer(data, frame, (x, y) => terrain.heightAt(x, y));
  viewer.scene.add(obstacles.group);
  const design = data.design ? new DesignLayer(data.design.model, frame) : null;
  if (design) viewer.scene.add(design.group);

  // --- project
  let initial: ProjectData = emptyProject(PROJECT.naam);
  try {
    const saved = await loadLocal(AUTOSAVE_KEY);
    if (saved) initial = parseProject(saved);
  } catch (e) { console.warn('Automatisch opgeslagen project niet te lezen', e); }
  const store = new ProjectStore(initial);
  let L: LayerState = mergeLayers(initial.weergave?.lagen);
  // Met een ontwerpmodel is het bestaande pand standaard transparant (anders vallen oud en nieuw door elkaar).
  if (data.design && !initial.weergave?.lagen?.sporthal) L.sporthal = 'transparant';

  let autosaveTimer = 0;
  const autosave = () => {
    store.data.weergave = { ...(store.data.weergave ?? {}), lagen: L as any };
    clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => { void saveLocal(AUTOSAVE_KEY, store.serialize(false)); }, 800);
  };

  // --- eigen invoer (fase 2)
  const userLayer = new UserLayer(frame, (x, y) => terrain.heightAt(x, y));
  viewer.scene.add(userLayer.group);
  const drawTool = new DrawTool(frame, (x, y) => terrain.heightAt(x, y), (msg) => status(msg, 0));
  viewer.scene.add(drawTool.group);
  let selectedManual: string | null = null;
  /** Object dat nu gesleept wordt (niet op de terreintextuur tekenen). */
  let dragHidden: string | null = null;
  const handles = new EditHandles(frame, (x, y) => terrain.heightAt(x, y));
  viewer.scene.add(handles.group);
  const measure = new MeasureTool(frame);
  viewer.scene.add(measure.group);
  // fase 3: bouwplaatselementen
  const elementsLayer = new ElementsLayer(frame, (x, y) => terrain.heightAt(x, y));
  viewer.scene.add(elementsLayer.group);
  const ghostLayer = new ElementsLayer(frame, (x, y) => terrain.heightAt(x, y));
  viewer.scene.add(ghostLayer.group);
  const elHandles = new ElementHandles(frame, (x, y) => terrain.heightAt(x, y));
  viewer.scene.add(elHandles.group);
  let selectedElement: string | null = null;
  let conflicts: Conflict[] = [];
  let conflictSet = new Set<string>();
  let placing: Element | null = null;
  let rotStep = 15;
  try { rotStep = Number(localStorage.getItem('bouwplaats-sporthal:draaistap')) || 15; } catch { /* */ }
  const elVisible = (e: Element) => L.elementLagen[e.laag] !== false;
  const snapIndex = new SnapIndex(5);
  terrain.overlays.push(
    dxfOverlay(() => store.data, () => designPlacement()),
    klicOverlay(() => store.data),
    elementsOverlay(() => store.data.elementen, (e) => elVisible(e), () => conflictSet, () => selectedElement, () => dragHidden, () => L.botsingen),
    manualOverlay(() => store.data, () => selectedManual, () => dragHidden),
    surveyOverlay(() => store.data),
  );

  // --- UI
  const info = new InfoPanel($('info'), store, () => select(null));
  let selection: Selection = null;

  const presentClasses = new Set<string>([...terrain.polys.map((p) => p.cls), ...terrain.lines.map((l) => l.cls), ...terrain.points.map((p) => p.cls)]);
  const obstacleCounts: Record<string, number> = {};
  for (const o of obstacles.items) obstacleCounts[o.spec.categorie] = (obstacleCounts[o.spec.categorie] ?? 0) + 1;

  const designPlacement = (): Placement | null => (design ? store.data.ontwerpPlaatsing ?? design.model.plaatsingAuto : null);
  // eigen perceel (BRK) rond de sporthal / het nieuwe pand
  const ownFootprint = (): number[][][] => {
    const p = designPlacement();
    if (design && p) return placeRings(p, design.model.contour);
    return buildings?.sporthal?.rec.footprint ?? [];
  };
  const own = data.percelen ? ownParcels(data.percelen.features, ownFootprint()) : [];
  terrain.ownParcelRings = own.flatMap((p) => p.polys.map((pl) => pl[0]));
  const boundary = (): ActiveBoundary => activeBoundary(store.data.inmeting.grens, own);
  let contourKey = '';
  let overlayKey = '';

  // --- fase 4: routes (swept path)
  const STOEP_KLASSEN = new Set(['voetpad', 'groen', 'struiken', 'bos', 'haag', 'verkeerseiland', 'water', 'oever']);
  const circle = (x: number, y: number, r: number, n = 16) => [...Array(n + 1)].map((_, i) => [x + r * Math.cos((i / n) * 2 * Math.PI), y + r * Math.sin((i / n) * 2 * Math.PI)]);
  function routeObstacles(): RouteObstacle[] {
    const out: RouteObstacle[] = [];
    const add = (o: Omit<RouteObstacle, 'bbox'>) => { const g = o.ring ?? o.lijn; if (g && g.length >= 2) out.push({ ...o, bbox: bboxOf(g) }); };
    for (const b of buildings?.items ?? []) {
      const fp = b.rec.footprint[0];
      if (!fp || (b.isSporthal && design)) continue;
      add({ id: `g:${b.rec.id}`, naam: b.isSporthal ? 'bestaande sporthal' : `pand ${b.rec.bagId}`, soort: 'gebouw', ring: fp });
    }
    const dp = designPlacement();
    if (design && dp) for (const r of placeRings(dp, design.model.contour).filter((q) => q.length > 3)) add({ id: 'ontwerp', naam: 'nieuw pand (IFC)', soort: 'nieuw pand', ring: r });
    for (const e of store.data.elementen) {
      if (!elVisible(e) || ELEMENTS[e.type]?.vlak) continue;
      const fp = footprint(e);
      add({ id: `e:${e.id}`, naam: e.naam || ELEMENTS[e.type].label, soort: 'element', ring: [...fp, fp[0]] });
    }
    for (const t0 of trees?.trees ?? []) {
      const t = effectiveTree(t0, store.data.overschrijvingen.bomen[t0.id]);
      if (t.verborgen) continue;
      add({ id: `b:${t.id}`, naam: `boom (kroon vanaf ${t.kroonOnderkant.toFixed(1).replace('.', ',')} m)`, soort: 'boom', ring: circle(t.x, t.y, t.kroonstraal), vrijeHoogte: t.kroonOnderkant });
      add({ id: `s:${t.id}`, naam: 'boomstam', soort: 'boom', ring: circle(t.x, t.y, 0.3, 8) });
    }
    for (const o of obstacles.items) {
      const r = Math.max(0.15, Math.max(o.spec.breedte, o.spec.diepte) / 2);
      add({ id: `o:${o.id}`, naam: o.spec.omschrijving, soort: 'paal', ring: [[o.x - r, o.y - r], [o.x + r, o.y - r], [o.x + r, o.y + r], [o.x - r, o.y + r], [o.x - r, o.y - r]] });
    }
    for (const m of store.data.handmatig) {
      const ring = m.coords.length >= 3 ? [...m.coords, m.coords[0]] : undefined;
      if (m.soort === 'paaltjes') m.coords.forEach((c, i) => add({ id: `h:${m.id}:${i}`, naam: m.naam || 'paaltje', soort: 'paaltjes', ring: circle(c[0], c[1], 0.15, 8) }));
      else if (m.soort === 'hekwerk') {
        const ps = panels(m.coords), gates = gatePanels(m.poorten ?? [], ps.length);
        ps.forEach((p) => { if (!gates.has(p.index)) add({ id: `h:${m.id}`, naam: m.naam || 'bouwhekken', soort: 'hekwerk', lijn: [p.a, p.b] }); });
      } else if (m.soort === 'doorrijhoogte') {
        const vh = m.vrijeHoogte ?? 4.0, naam = `${m.naam || 'doorrijhoogte'} (${vh.toFixed(2).replace('.', ',')} m)`;
        if (m.geom === 'vlak' && ring) add({ id: `h:${m.id}`, naam, soort: 'doorrijhoogte', ring, vrijeHoogte: vh });
        else add({ id: `h:${m.id}`, naam, soort: 'doorrijhoogte', lijn: m.coords, vrijeHoogte: vh });
      } else if (m.soort === 'nietBerijdbaar' && ring) add({ id: `h:${m.id}`, naam: m.naam || 'niet berijdbaar', soort: 'niet berijdbaar', ring, alleenWielen: true });
    }
    // dubbele id's (hekdelen) samenvoegen tot één melding: uniek per deel maken maar naam gelijk
    const seen = new Map<string, number>();
    return out.map((o) => { const n = seen.get(o.id) ?? 0; seen.set(o.id, n + 1); return n ? { ...o, id: `${o.id}#${n}` } : o; });
  }
  const routeEngine = new RouteEngine(routeObstacles, (x, y) => {
    const p = terrain.bgtAt(x, y, L);
    return p && STOEP_KLASSEN.has(p.cls) ? (CLASS_STYLES[p.cls]?.label ?? p.cls) : null;
  });
  const routeLayer = new RouteLayer(frame, (x, y) => terrain.heightAt(x, y));
  viewer.scene.add(routeLayer.group);
  let selectedRoute: string | null = null;
  let routePos = 0, routePlaying = false, routeDebug = false, lastFrameT = 0;
  let routePanelUpdate: ((s: Sample | null, p: number) => void) | null = null;
  terrain.overlays.push(routesOverlay(() => store.data.routes, routeEngine, () => selectedRoute));
  const routeSampleAt = (r: Route, s: number): Sample | null => {
    const ss = routeEngine.result(r).sim.samples;
    if (!ss.length) return null;
    let lo = 0, hi = ss.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ss[mid].s < s) lo = mid + 1; else hi = mid; }
    return ss[lo];
  };
  function showRoutePos() {
    const r = store.data.routes.find((q) => q.id === selectedRoute);
    if (!r || !L.routes) { routeLayer.hide(); return; }
    const smp = routeSampleAt(r, routePos);
    if (smp) routeLayer.show(r, smp, routeDebug); else routeLayer.hide();
    routePanelUpdate?.(smp, routePos);
  }
  viewer.onFrame(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrameT) / 1000);
    lastFrameT = now;
    if (!routePlaying) return;
    const r = store.data.routes.find((q) => q.id === selectedRoute);
    if (!r) { routePlaying = false; return; }
    const total = routeEngine.result(r).sim.lengte;
    routePos += dt * Math.max(2, (r.voertuig.snelheid / 3.6) * 3);
    if (routePos >= total) { routePos = total; routePlaying = false; refreshInfo(); }
    showRoutePos();
  });
  function startRoute(vehicleId: string) {
    const v = VEHICLES.find((q) => q.id === vehicleId)!;
    drawRouteLeg(null, 'vooruit', `${v.naam}: teken de route van de vooras (vooruit)`, (pts) => {
      const r = newRoute(vehicleId, [{ richting: 'vooruit', punten: pts }]);
      L.routes = true;
      store.change('Route getekend', (d) => { d.routes.push(r); });
      routePos = 0;
      select({ kind: 'route', id: r.id });
    });
  }
  function drawRouteLeg(begin: [number, number] | null, richting: 'vooruit' | 'achteruit', titel: string, done: (pts: [number, number][]) => void) {
    if (measure.active) stopMeasure();
    routePlaying = false;
    $('viewport').classList.add('drawing');
    drawTool.start({
      geom: 'lijn', kleur: ROUTE_KLEUR[richting], titel, begin: begin ?? undefined,
      onFinish: (coords) => { $('viewport').classList.remove('drawing'); measure.showSnap(null); if (coords.length >= 2) done(coords); },
      onCancel: () => { $('viewport').classList.remove('drawing'); measure.showSnap(null); },
    });
  }
  function addRouteLeg(id: string, richting: 'vooruit' | 'achteruit') {
    const r = store.data.routes.find((q) => q.id === id);
    if (!r) return;
    const begin = routeEngine.nextStart(r, richting);
    const wat = richting === 'vooruit' ? 'de vooras' : r.voertuig.soort === 'oplegger' ? 'de as van de oplegger' : 'de achteras';
    drawRouteLeg(begin, richting, `Deel ${r.legs.length + 1} ${richting}: teken de lijn van ${wat}`, (pts) => {
      store.change(`Routedeel ${richting} toegevoegd`, (d) => { const x = d.routes.find((q) => q.id === id); if (x) x.legs.push({ richting, punten: pts }); });
      const nr = store.data.routes.find((q) => q.id === id);
      if (nr) { routePos = routeEngine.result(nr).sim.lengte; showRoutePos(); refreshInfo(); }
    });
  }

  // --- fase 5: kranen
  const WEG_KLASSEN = new Set(['rijbaan', 'woonerf', 'fietspad', 'voetpad', 'parkeervak', 'ovbaan', 'weg_overig', 'verkeerseiland']);
  const craneLayer = new CraneLayer(frame, (x, y) => terrain.heightAt(x, y));
  viewer.scene.add(craneLayer.group);
  let selectedCrane: string | null = null;
  let cranePlace: 'toren' | 'mobiel' | 'mk88' | null = null;
  let craneDrag: { id: string; ox: number; oy: number; sx: number; sy: number; start: [number, number]; moved: boolean } | null = null;
  let craneHidden: string | null = null;
  let craneMove: string | null = null;
  let liftMode: number | null = null;
  let liftLast = 2.0;
  let liftMarker: LiftMarker | null = null;
  let craneWarn = new Map<string, CraneWarning[]>();
  let craneOverlap: { a: string; b: string; tekst: string }[] = [];
  terrain.overlays.push(cranesOverlay(() => store.data.kranen, () => selectedCrane, () => liftMarker, () => new Set([...craneWarn].filter(([, w]) => w.some((q) => q.ernst === 'conflict')).map(([id]) => id)), () => craneHidden));
  function craneEnv(k: Crane): Omit<CraneEnv, 'maaiveld'> {
    const b = boundary();
    const wegen: CraneEnv['wegen'] = [];
    const R = Math.max(k.type === 'toren' ? k.giekLengte : 60, 10) + 5;
    for (const p of terrain.polys) {
      if (!WEG_KLASSEN.has(p.cls)) continue;
      if (p.bbox.xmax < k.x - R || p.bbox.xmin > k.x + R || p.bbox.ymax < k.y - R || p.bbox.ymin > k.y + R) continue;
      for (const poly of p.polys) if (poly[0]) wegen.push({ naam: CLASS_STYLES[p.cls]?.label ?? p.cls, ring: poly[0] });
    }
    const panden: CraneEnv['panden'] = [];
    const hoog: CraneEnv['hoog'] = [];
    for (const bo of buildings?.items ?? []) {
      const fp = bo.rec.footprint[0];
      if (!fp) continue;
      const hgt = effectiveHeights(bo.rec, store.data.overschrijvingen.gebouwen[bo.rec.id]);
      if (bo.isSporthal) { if (!design && hgt.nok != null) hoog.push({ id: bo.rec.id, naam: 'bestaande sporthal', soort: 'nieuw pand', ring: fp, hoogteNAP: hgt.nok }); continue; }
      panden.push({ id: bo.rec.id, naam: `pand ${bo.rec.bagId}`, ring: fp, hoogteNAP: hgt.nok });
    }
    const dp = designPlacement();
    if (design && dp) design.model.zones.forEach((z, i) => { for (const r of placeRings(dp, z.rings)) if (r.length > 3) hoog.push({ id: `z${i}`, naam: 'nieuw pand (IFC)', soort: 'nieuw pand', ring: r, hoogteNAP: dp.peil + z.top }); });
    for (const e of store.data.elementen) {
      if (!elVisible(e) || ELEMENTS[e.type]?.vlak) continue;
      const fp = footprint(e);
      hoog.push({ id: e.id, naam: e.naam || ELEMENTS[e.type].label, soort: 'element', ring: [...fp, fp[0]], hoogteNAP: (terrain.heightAt(e.x, e.y) ?? 0) + totalHeight(e) });
    }
    for (const t0 of trees?.trees ?? []) {
      const t = effectiveTree(t0, store.data.overschrijvingen.bomen[t0.id]);
      if (t.verborgen || Math.hypot(t.x - k.x, t.y - k.y) > R + t.kroonstraal) continue;
      hoog.push({ id: t.id, naam: `boom (${t.hoogte.toFixed(1).replace('.', ',')} m)`, soort: 'boom', ring: circle(t.x, t.y, t.kroonstraal), hoogteNAP: t.maaiveld + t.hoogte });
    }
    return { grens: b.lijnen.length ? { lijnen: b.lijnen, gesloten: b.gesloten, bron: b.bron === 'ingemeten' ? 'ingemeten perceelgrens' : 'perceelgrens (BRK, indicatief)' } : null, wegen, panden, hoog };
  }
  function computeCraneChecks() {
    craneWarn = new Map();
    const vis = store.data.kranen.filter((k) => k.zichtbaar);
    for (const k of vis) craneWarn.set(k.id, craneWarnings(k, { ...craneEnv(k), maaiveld: terrain.heightAt(k.x, k.y) ?? 0 }));
    craneOverlap = overlaps(vis);
  }
  function startCranePlace(t: 'toren' | 'mobiel' | 'mk88') {
    if (drawTool.active) drawTool.cancel();
    if (measure.active) stopMeasure();
    select(null);
    cranePlace = t;
    $('viewport').classList.add('drawing');
    status(`${t === 'toren' ? 'Torenkraan' : t === 'mk88' ? 'Liebherr MK 88 Plus' : 'Mobiele kraan'} plaatsen: klik op de kaart (hart van de kraan) · Esc = annuleren`, 0);
  }
  function stopCraneModes() {
    cranePlace = null; craneMove = null; liftMode = null;
    $('viewport').classList.remove('drawing');
  }
  function doLift(x: number, y: number, last: number) {
    const ks = store.data.kranen.filter((k) => k.zichtbaar);
    const checks: LiftCheck[] = (selection?.kind === 'crane' ? ks.filter((k) => k.id === selectedCrane) : ks).map((k) => canLift(k, x, y, last));
    liftMarker = { x, y, last, checks };
    overlayKey = '';
    applyScene();
    refreshInfo();
  }
  const applyScene = () => {
    // 2D-lagen opnieuw tekenen als de eigen invoer veranderd is
    const d = store.data;
    computeConflicts();
    elementsLayer.apply(d.elementen, elVisible, L.botsingen ? conflictSet : new Set(), selectedElement);
    routeEngine.obstacleKey = JSON.stringify([d.handmatig, d.elementen, d.overschrijvingen.bomen, designPlacement(), L.elementLagen, L.bgtKlassen]);
    computeCraneChecks();
    craneLayer.apply(d.kranen, L.kranen, selectedCrane, liftMarker);
    const ok = JSON.stringify([d.kranen, selectedCrane, liftMarker, L.kranen, d.inmeting, d.klic, d.onderleggers, d.handmatig, selectedManual, d.elementen, [...conflictSet], selectedElement, L.elementLagen, L.botsingen, d.routes, selectedRoute, L.routes, L.routeSporen]);
    terrain.ownParcelHighlight = !d.inmeting.grens;
    if (ok !== overlayKey) { overlayKey = ok; terrain.redraw(L); }
    if (selectedRoute) showRoutePos(); else routeLayer.hide();
    userLayer.apply(d, L, selectedManual);
    const cw = [...craneWarn.values()].flat().filter((w) => w.ernst === 'conflict').length;
    renderWarnings(data, boundary(), L.botsingen ? conflictSet.size : 0, [
      ...(craneOverlap.length ? [`⚠ ${craneOverlap.length}× overlappende zwenkgebieden van kranen.`] : []),
      ...(cw ? [`⚠ ${cw} hoogteconflict(en) bij kranen – zie het kraanpaneel.`] : []),
    ]);
    const ov = store.data.overschrijvingen;
    // plattegrond: 3D-gebouwen, bomen en obstakels uit
    const plan = L.plattegrond;
    const L3 = plan ? { ...L, gebouwen: false, obstakels: Object.fromEntries(Object.keys(L.obstakels).map((k) => [k, false])) } : L;
    buildings?.apply(L3, ov.gebouwen);
    trees?.apply(L.bomen && !plan, ov.bomen);
    obstacles.apply(L3, ov.obstakels);
    const p = designPlacement();
    if (design && p) {
      design.apply(p, L.ontwerp && !L.plattegrond, L.ontwerpTransparant);
      const key = JSON.stringify(p);
      if (key !== contourKey) {
        contourKey = key;
        terrain.designContour = placeRings(p, design.model.contour);
        terrain.redraw(L);
      }
    }
  };
  /** Botsingscontrole: elementen onderling, gebouwen, nieuw pand, perceelgrens, kavel + vergunde zones. */
  function computeConflicts() {
    const obst: Obstacle2D[] = [];
    for (const b of buildings?.items ?? []) {
      const fp = b.rec.footprint;
      // met een ontwerpmodel komt het nieuwe pand op de plek van de bestaande sporthal
      if (!fp.length || (b.isSporthal && design)) continue;
      const xs = fp.flat().map((q) => q[0]), ys = fp.flat().map((q) => q[1]);
      obst.push({ id: b.rec.id, soort: 'gebouw', naam: b.isSporthal ? 'bestaande sporthal' : `pand ${b.rec.bagId}`, rings: [fp[0]], bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    }
    const dp = designPlacement();
    if (design && dp) {
      const r = placeRings(dp, design.model.contour).filter((q) => q.length > 3);
      const xs = r.flat().map((q) => q[0]), ys = r.flat().map((q) => q[1]);
      if (r.length) obst.push({ id: 'ontwerp', soort: 'nieuw pand', naam: 'nieuw pand (IFC)', rings: [r[0]], bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    }
    const b = boundary();
    const zones = store.data.handmatig.filter((o) => o.soort === 'vergundeZone' && o.coords.length >= 3).map((o) => [[...o.coords, o.coords[0]]]);
    const kavel = b.gesloten ? b.lijnen.map((l) => [l]) : [];
    conflicts = checkCollisions({
      elementen: store.data.elementen.filter(elVisible), obstakels: obst,
      grens: b.lijnen.length ? { lijnen: b.lijnen, gesloten: b.gesloten, bron: b.bron === 'ingemeten' ? 'ingemeten perceelgrens' : 'perceelgrens (BRK, indicatief)' } : null,
      toegestaan: [...kavel, ...zones],
    });
    conflictSet = new Set(conflicts.map((c) => c.elementId));
  }
  const designMaaiveld = () => {
    const p = designPlacement();
    return p ? terrain.heightAt(p.x, p.y) : null;
  };
  const renderPanel = () =>
    renderLayersPanel({
      root: $('layers'), data, state: L, hypsoRange: terrain.hypsoRange, presentClasses, obstacleCounts,
      designPlacementIsAuto: !store.data.ontwerpPlaatsing,
      onDesignPlacement: () => select({ kind: 'design', zone: null }),
      onPlattegrond: (on) => { if (on) viewer.to2D(); },
      elementen: store.data.elementen,
      conflicts,
      onSelectElement: (id) => { const e = store.data.elementen.find((q) => q.id === id); if (e) { select({ kind: 'element', id }); viewer.focus(new THREE.Vector3(frame.toLocal(e.x, e.y, 0).x, terrain.heightAt(e.x, e.y) ?? 0, frame.toLocal(e.x, e.y, 0).z), 25); } },
      routeStatus: (r) => { const res = routeEngine.result(r); return { ok: res.sim.uitvoerbaar, botsingen: res.conflicts.length }; },
      craneStatus: (id) => { const w = craneWarn.get(id) ?? []; const ov = craneOverlap.filter((o) => o.a === id || o.b === id).length; return { conflicts: w.filter((q) => q.ernst === 'conflict').length, letop: w.filter((q) => q.ernst !== 'conflict').length + ov }; },
      onSelectCrane: (id) => select({ kind: 'crane', id }),
      onCraneVisible: (id, v) => { const k = store.data.kranen.find((q) => q.id === id); if (k) k.zichtbaar = v; overlayKey = ''; applyScene(); renderPanel(); autosave(); },
      onSelectRoute: (id) => select({ kind: 'route', id }),
      onRouteVisible: (id, v) => { const r = store.data.routes.find((q) => q.id === id); if (r) r.zichtbaar = v; overlayKey = ''; applyScene(); renderPanel(); autosave(); },
      onClearBezet: () => store.change('Bezette parkeervakken gewist', (pd) => { pd.elementen = pd.elementen.filter((q) => !q.groep?.startsWith('bezet')); }),
      project: store.data,
      boundary: boundary(),
      onRefVisible: (kind, id, v) => {
        const r = kind === 'klic' ? store.data.klic.find((k) => k.id === id) : store.data.onderleggers.find((k) => k.id === id);
        if (r) r.zichtbaar = v;
        terrain.redraw(L);
        renderPanel();
        autosave();
      },
      onOpen: (w) => {
        if (w.kind === 'codes') editCodes(importCtx);
        else if (w.kind === 'grens') select({ kind: 'grens' });
        else select({ kind: w.kind, id: w.id });
      },
      onChange: (_s, what) => {
        if (what === 'terrain' || what === 'all') terrain.redraw(L);
        if (what === 'scene' || what === 'all') applyScene();
        renderPanel();
        autosave();
      },
    });

  terrain.redraw(L);
  applyScene();
  renderPanel();

  // --- undo/redo-knoppen
  const btnUndo = $('btnUndo') as HTMLButtonElement, btnRedo = $('btnRedo') as HTMLButtonElement;
  const updateUndo = () => {
    btnUndo.disabled = !store.canUndo();
    btnRedo.disabled = !store.canRedo();
    btnUndo.title = store.canUndo() ? `Ongedaan maken: ${store.undoLabel()} (Ctrl+Z)` : 'Ongedaan maken (Ctrl+Z)';
    btnRedo.title = store.canRedo() ? `Opnieuw: ${store.redoLabel()} (Ctrl+Y)` : 'Opnieuw (Ctrl+Y)';
  };
  updateUndo();
  store.onChange((_p, reden) => {
    rebuildSnap();
    if (selectedManual) handles.set(store.data.handmatig.find((q) => q.id === selectedManual) ?? null);
    if (selectedElement) {
      const e = store.data.elementen.find((q) => q.id === selectedElement) ?? null;
      elHandles.set(e);
      if (!e) selectedElement = null;
    }
    applyScene();
    renderPanel();
    refreshInfo();
    updateUndo();
    autosave();
    status(reden);
  });

  // --- selectie
  function select(s: Selection) {
    selection = s;
    buildings?.setSelected(s?.kind === 'building' ? buildings.byId.get(s.id) ?? null : null);
    trees?.setSelected(s?.kind === 'tree' ? s.index : -1);
    design?.setHighlight(s?.kind === 'design');
    obstacles.setSelected(s?.kind === 'obstacle' ? obstacles.byId.get(s.id) ?? null : null);
    obstacles.apply(L, store.data.overschrijvingen.obstakels);
    const prevEl = selectedElement;
    selectedElement = s?.kind === 'element' ? s.id : null;
    elHandles.set(selectedElement ? store.data.elementen.find((q) => q.id === selectedElement) ?? null : null);
    if (prevEl !== selectedElement) applyScene();
    const prevManual = selectedManual;
    selectedManual = s?.kind === 'manual' ? s.id : null;
    handles.set(selectedManual ? store.data.handmatig.find((q) => q.id === selectedManual) ?? null : null);
    if (prevManual !== selectedManual) applyScene();
    const prevCrane = selectedCrane;
    selectedCrane = s?.kind === 'crane' ? s.id : null;
    if (prevCrane !== selectedCrane) { if (s?.kind !== 'lift') liftMarker = null; applyScene(); }
    const prevRoute = selectedRoute;
    selectedRoute = s?.kind === 'route' ? s.id : null;
    if (prevRoute !== selectedRoute) {
      routePlaying = false;
      if (selectedRoute) routePos = 0;
      if (!selectedRoute) { routePanelUpdate = null; routeLayer.hide(); }
      applyScene();
    }
    refreshInfo();
    if (selectedRoute) showRoutePos();
  }
  function refreshInfo() {
    const s = selection;
    if (!s) return info.hide();
    if (s.kind === 'building') { const b = buildings?.byId.get(s.id); if (b) info.showBuilding(b); }
    else if (s.kind === 'tree' && trees) info.showTree(trees.trees[s.index]);
    else if (s.kind === 'obstacle') { const o = obstacles.byId.get(s.id); if (o) info.showObstacle(o); }
    else if (s.kind === 'design' && design) info.showDesign(design.model, s.zone, designMaaiveld());
    else if (s.kind === 'klic') {
      const k = store.data.bijlagen[s.refId] as any;
      const line = k?.lijnen.find((l: any) => l.id === s.lineId);
      if (line) info.showKlic(s.refId, line, s.x, s.y); else info.hide();
    } else if (s.kind === 'meetpunt') {
      const pt = s.grens ? store.data.inmeting.grens?.punten[s.index] : store.data.inmeting.punten?.punten[s.index];
      if (pt) info.showMeetpunt(pt, s.grens, terrain.heightAt(pt.x, pt.y)); else info.hide();
    } else if (s.kind === 'manual') {
      const o = store.data.handmatig.find((q) => q.id === s.id);
      if (o) info.showManual(o, () => { store.change(`${MANUAL_STYLE[o.soort].label} verwijderd`, (d) => { d.handmatig = d.handmatig.filter((q) => q.id !== o.id); }); select(null); });
      else info.hide();
    } else if (s.kind === 'grens') {
      info.showGrens(
        () => { store.change('Ingemeten perceelgrens verwijderd', (d) => { delete d.inmeting.grens; }); select(null); },
        () => store.change('Grens open/gesloten', (d) => { if (d.inmeting.grens) d.inmeting.grens.gesloten = !d.inmeting.grens.gesloten; }),
        terrain.ownParcelRings, own);
    } else if (s.kind === 'klicRef') {
      info.showKlicRef(s.id, () => { store.change('KLIC-levering verwijderd', (d) => { d.klic = d.klic.filter((k) => k.id !== s.id); }); select(null); });
    } else if (s.kind === 'element') {
      const e = store.data.elementen.find((q) => q.id === s.id);
      if (!e) return info.hide();
      const lagen = [...new Set([...Object.values(ELEMENTS).map((x) => x.categorie), ...store.data.elementen.map((q) => q.laag)])];
      info.showElement(e, conflicts.filter((c) => c.elementId === e.id), lagen, {
        duplicate: () => duplicateElement(e.id),
        remove: () => removeElement(e.id),
        alignFacade: e.type === 'steiger' ? () => alignSteiger(e.id) : undefined,
        rotStep,
        setRotStep: (n) => { rotStep = n; try { localStorage.setItem('bouwplaats-sporthal:draaistap', String(n)); } catch { /* */ } refreshInfo(); },
      });
    } else if (s.kind === 'crane') {
      const k = store.data.kranen.find((q) => q.id === s.id);
      if (!k) return info.hide();
      const others = craneOverlap.filter((o) => o.a === k.id || o.b === k.id).map((o) => o.tekst);
      const lr = liftMarker?.checks.find((q) => q.craneId === k.id) ?? null;
      info.open(k.naam, k.type === 'toren' ? `Torenkraan · giek ${k.giekLengte.toString().replace('.', ',')} m · haak ${k.haakhoogte.toString().replace('.', ',')} m` : `Mobiele kraan · giek ${k.giekLengte.toString().replace('.', ',')} m`,
        ...cranePanel(store, k, craneWarn.get(k.id) ?? [], others, {
          move: () => { craneMove = k.id; $('viewport').classList.add('drawing'); status(`${k.naam} verplaatsen: klik de nieuwe positie · Esc = annuleren`, 0); },
          duplicate: () => { const c = { ...structuredClone(k), id: `k-${Date.now().toString(36)}`, naam: `${k.naam} (kopie)`, x: k.x + 5, y: k.y - 5 }; store.change('Kraan gedupliceerd', (d) => { d.kranen.push(c); }); select({ kind: 'crane', id: c.id }); },
          remove: () => { store.change(`${k.naam} verwijderd`, (d) => { d.kranen = d.kranen.filter((q) => q.id !== k.id); }); select(null); },
          startLift: (last) => { liftLast = last; liftMode = last; $('viewport').classList.add('drawing'); status(`Klik het hijspunt voor ${last.toString().replace('.', ',')} t · Esc = stoppen`, 0); },
          liftResult: lr && liftMarker && Math.abs(liftMarker.last - liftLast) < 1e-9 ? lr : lr,
          liftLast,
        }));
    } else if (s.kind === 'lift') {
      const iLast = h('input', { type: 'text', value: String(liftLast).replace('.', ','), style: { width: '90px' } }) as HTMLInputElement;
      iLast.addEventListener('keydown', (ev) => ev.stopPropagation());
      const go = () => { const n = Number(iLast.value.replace(',', '.')); if (n > 0) { liftLast = n; liftMode = n; $('viewport').classList.add('drawing'); status('Klik het hijspunt op de kaart · Esc = stoppen', 0); } };
      const m = liftMarker;
      const fm = (v: number) => v.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      info.open('Kan last X op positie Y?', 'Controle tegen de lasttabel van alle kranen',
        h('div', { class: 'frow' }, 'Last (t, incl. hijsmiddelen)', iLast),
        h('div', { class: 'btnrow' }, h('button', { class: 'primary', onclick: go }, '⌖ Klik een punt op de kaart')),
        !store.data.kranen.length ? h('div', { class: 'note warn', style: { marginLeft: 0 } }, 'Er zijn nog geen kranen geplaatst.') : null,
        m ? h('table', {}, h('tr', {}, h('th', {}, 'Kraan'), h('th', { style: { textAlign: 'right' } }, 'radius'), h('th', { style: { textAlign: 'right' } }, 'max.'), h('th', {}, '')),
          ...m.checks.map((c) => h('tr', {}, h('td', {}, c.naam), h('td', { class: 'num' }, `${fm(c.radius)} m`), h('td', { class: 'num' }, c.max == null ? '–' : `${fm(c.max)} t`), h('td', { style: { color: c.ok ? '#1b5e20' : '#b71c1c', fontWeight: 600 } }, c.ok ? 'OK' : 'NIET OK')))) : null,
        m ? h('div', { class: 'note', style: { marginLeft: 0 } }, ...m.checks.map((c) => h('div', {}, `${c.naam}: ${c.reden}`))) : null,
        h('div', { class: 'note', style: { marginLeft: 0 } }, 'Lineaire interpolatie tussen de tabelpunten; buiten de tabel wordt niet geëxtrapoleerd (= NIET OK).'));
    } else if (s.kind === 'route') {
      const r = store.data.routes.find((q) => q.id === s.id);
      if (!r) { routePanelUpdate = null; routeLayer.hide(); return info.hide(); }
      const res = routeEngine.result(r);
      routePos = Math.min(routePos, res.sim.lengte);
      const p = routePanel(store, r, res, routePos, {
        addLeg: (richting) => addRouteLeg(r.id, richting),
        removeLastLeg: () => store.change('Routedeel verwijderd', (d) => { const x = d.routes.find((q) => q.id === r.id); if (x) x.legs.pop(); }),
        remove: () => { store.change('Route verwijderd', (d) => { d.routes = d.routes.filter((q) => q.id !== r.id); }); select(null); },
        setPos: (v) => { routePos = v; routePlaying = false; showRoutePos(); },
        togglePlay: () => { if (!routePlaying && routePos >= res.sim.lengte - 0.01) routePos = 0; routePlaying = !routePlaying; return routePlaying; },
        playing: () => routePlaying,
        debug: routeDebug,
        setDebug: (on) => { routeDebug = on; showRoutePos(); },
        focus: (x, y) => { const q = frame.toLocal(x, y, 0); viewer.focus(new THREE.Vector3(q.x, terrain.heightAt(x, y) ?? 0, q.z), 30); },
      });
      info.open(r.naam, `${r.voertuig.naam} · ${r.legs.length} deel/delen · ${(Math.round(res.sim.lengte * 10) / 10).toString().replace('.', ',')} m`, ...p.nodes);
      routePanelUpdate = p.update;
      p.update(routeSampleAt(r, routePos), routePos);
    } else if (s.kind === 'dxf') {
      info.showDxf(s.id, !!design, () => { store.change('Onderlegger verwijderd', (d) => { d.onderleggers = d.onderleggers.filter((k) => k.id !== s.id); }); select(null); });
    }
    else if (s.kind === 'terrain') {
      const bgt = terrain.bgtAt(s.x, s.y, L);
      info.showTerrain(s.x, s.y, terrain.heightAt(s.x, s.y), terrain.measuredAt(s.x, s.y), bgt, L.percelen ? terrain.parcelAt(s.x, s.y) : null);
    }
  }

  // --- picking
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  type Hit =
    | { kind: 'building'; b: BuildingObj; point: THREE.Vector3 }
    | { kind: 'tree'; index: number; point: THREE.Vector3 }
    | { kind: 'obstacle'; o: Obstacle; point: THREE.Vector3 }
    | { kind: 'design'; zone: number; point: THREE.Vector3 }
    | { kind: 'manual'; o: ManualObject; point: THREE.Vector3 }
    | { kind: 'element'; e: Element; point: THREE.Vector3 }
    | { kind: 'survey'; s: SurveyHit; point: THREE.Vector3 }
    | { kind: 'klic'; k: KlicHit; point: THREE.Vector3 }
    | { kind: 'route'; r: Route; point: THREE.Vector3 }
    | { kind: 'crane'; k: Crane; point: THREE.Vector3 }
    | { kind: 'terrain'; point: THREE.Vector3 };
  /** Meters per schermpixel op een punt (voor aanwijstoleranties). */
  const mppAt = (p: THREE.Vector3) => {
    if (viewer.mode === '2d') return viewer.metersPerPixel();
    const d = viewer.perspCam.position.distanceTo(p);
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(viewer.perspCam.fov / 2))) / Math.max(1, canvas.clientHeight);
  };
  const pick = (ev: PointerEvent | MouseEvent): Hit | null => {
    const rect = viewer.renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, viewer.camera);
    const targets: THREE.Object3D[] = [...(buildings?.pickable() ?? []), ...obstacles.pickable(), ...(design?.pickable() ?? []), ...userLayer.pickable(), ...elementsLayer.pickable(), ...craneLayer.pickable()];
    if (trees && trees.group.visible) targets.push(trees.crowns);
    const hits = raycaster.intersectObjects(targets, true);
    const tp = terrain.intersectRay(raycaster.ray);
    // maatlijnen liggen bovenop alles: die gaan voor
    if (tp) {
      const rd0 = frame.toRD(tp.x, tp.y, tp.z);
      const ml = hitManual({ ...store.data, handmatig: store.data.handmatig.filter((q) => q.soort === 'maatlijn') }, L, rd0.x, rd0.y, Math.max(0.3, 6 * mppAt(tp)));
      if (ml) return { kind: 'manual', o: ml, point: tp };
    }
    const tDist = tp ? tp.distanceTo(raycaster.ray.origin) : Infinity;
    for (const hit of hits) {
      if (hit.distance > tDist + 0.5) break;
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.kind) o = o.parent;
      if (!o) continue;
      if (o.userData.kind === 'building') return { kind: 'building', b: buildings!.byId.get(o.userData.id)!, point: hit.point };
      if (o.userData.kind === 'tree' && hit.instanceId != null) return { kind: 'tree', index: hit.instanceId, point: hit.point };
      if (o.userData.kind === 'obstacle') return { kind: 'obstacle', o: obstacles.byId.get(o.userData.id)!, point: hit.point };
      if (o.userData.kind === 'design') return { kind: 'design', zone: o.userData.zone, point: hit.point };
      if (o.userData.kind === 'crane') { const kr = store.data.kranen.find((q) => q.id === o!.userData.id); if (kr) return { kind: 'crane', k: kr, point: hit.point }; }
      if (o.userData.kind === 'element') { const el = store.data.elementen.find((q) => q.id === o!.userData.id); if (el) return { kind: 'element', e: el, point: hit.point }; }
      if (o.userData.kind === 'manual') { const mo = store.data.handmatig.find((q) => q.id === o!.userData.id); if (mo) return { kind: 'manual', o: mo, point: hit.point }; }
      if (o.userData.kind === 'grenspunt' && store.data.inmeting.grens) return { kind: 'survey', s: { kind: 'grenspunt', punt: store.data.inmeting.grens.punten[o.userData.index], index: o.userData.index }, point: hit.point };
      if (o.userData.kind === 'meetpunt' && store.data.inmeting.punten) return { kind: 'survey', s: { kind: 'meetpunt', punt: store.data.inmeting.punten.punten[o.userData.index], index: o.userData.index }, point: hit.point };
    }
    if (!tp) return null;
    // 2D-objecten op het maaiveld
    const rd = frame.toRD(tp.x, tp.y, tp.z);
    const tol = Math.max(0.3, 6 * mppAt(tp));
    const sv = hitSurvey(store.data, L, rd.x, rd.y, tol);
    if (sv && sv.kind !== 'grenslijn') return { kind: 'survey', s: sv, point: tp };
    const mo = hitManual(store.data, L, rd.x, rd.y, tol);
    if (mo) return { kind: 'manual', o: mo, point: tp };
    if (L.kranen) { const kr = hitCrane(store.data.kranen, rd.x, rd.y, tol); if (kr) return { kind: 'crane', k: kr, point: tp }; }
    const ro = hitRoute(store.data.routes, routeEngine, L, rd.x, rd.y, tol);
    if (ro) return { kind: 'route', r: ro, point: tp };
    if (sv) return { kind: 'survey', s: sv, point: tp };
    const kh = hitKlic(store.data, L, rd.x, rd.y, tol);
    if (kh) return { kind: 'klic', k: kh, point: tp };
    return { kind: 'terrain', point: tp };
  };

  const tooltip = $('tooltip');
  const stCoord = $('stCoord'), stHeight = $('stHeight');
  let pendingMove: PointerEvent | null = null;
  const canvas = viewer.renderer.domElement;
  canvas.addEventListener('pointermove', (ev) => { pendingMove = ev; });
  canvas.addEventListener('pointerleave', () => { pendingMove = null; tooltip.hidden = true; buildings?.setHover(null); trees?.setHover(-1); });
  viewer.onFrame(() => {
    if (!pendingMove) return;
    const ev = pendingMove;
    pendingMove = null;
    if (ev.buttons) { tooltip.hidden = true; return; }
    const hit = pick(ev);
    if (placing) {
      tooltip.hidden = true;
      if (hit) {
        const rd = frame.toRD(hit.point.x, hit.point.y, hit.point.z);
        placing.x = rd.x; placing.y = rd.y;
        if (placing.type === 'steiger') { const al = alignToEdge(placing, facadeRings(), 6); if (al) Object.assign(placing, al); }
        ghostLayer.apply([{ ...placing }], () => true, new Set(), placing.id);
      }
      return;
    }
    if (drawTool.active || measure.active) {
      tooltip.hidden = true;
      const mp = hit ? snapPoint(hit.point, ev) : null;
      if (mp) {
        stCoord.textContent = fmtRD(mp.x, mp.y);
        if (drawTool.active) drawTool.move(mp.x, mp.y, ev.shiftKey);
        else measure.move(mp);
      }
      return;
    }
    buildings?.setHover(hit?.kind === 'building' ? hit.b : null);
    trees?.setHover(hit?.kind === 'tree' ? hit.index : -1);
    if (hit) {
      const rd = frame.toRD(hit.point.x, hit.point.y, hit.point.z);
      stCoord.textContent = fmtRD(rd.x, rd.y);
      const mv = terrain.heightAt(rd.x, rd.y);
      const meas = terrain.measuredAt(rd.x, rd.y);
      stHeight.textContent = `maaiveld ${fmtNAP(mv)}${meas === false ? ' (geïnterpoleerd)' : ''}`;
    }
    const html = hit ? tooltipHtml(hit) : '';
    if (!html) { tooltip.hidden = true; return; }
    tooltip.innerHTML = html;
    tooltip.hidden = false;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    tooltip.style.left = `${Math.min(x + 16, rect.width - tooltip.offsetWidth - 8)}px`;
    tooltip.style.top = `${Math.min(y + 16, rect.height - tooltip.offsetHeight - 8)}px`;
  });

  function tooltipHtml(hit: Hit): string {
    if (hit.kind === 'building') {
      const r = hit.b.rec;
      const ov = store.data.overschrijvingen.gebouwen[r.id];
      const e = effectiveHeights(r, ov);
      const cls = (b: boolean) => (b ? ' class="ov"' : '');
      return `<div class="t">${hit.b.isSporthal ? 'Sporthal Latourpad 16' : `Pand ${r.bagId}`}</div>
        <div${cls(e.overschreven.goot)}>Goot: ${fmtNAP(e.goot)} · ${fmtM(relative(e.goot, e.maaiveld))} t.o.v. mv</div>
        <div${cls(e.overschreven.nok)}>Nok: ${fmtNAP(e.nok)} · ${fmtM(relative(e.nok, e.maaiveld))} t.o.v. mv</div>
        <div${cls(e.overschreven.maaiveld)}>Maaiveld: ${fmtNAP(e.maaiveld)}</div>
        ${r.bron === 'bgt-aanname' ? '<div class="ov">Niet in 3D BAG – hoogte is een aanname</div>' : r.bron === 'bgt-ahn' ? '<div style="color:#bbb">Niet in 3D BAG – blok uit BGT + AHN</div>' : ''}<div style="color:#bbb">Peildatum: ${(r.pwBron ?? '?').toUpperCase()} ${r.pwDatum ?? ''} · bouwjaar ${r.bouwjaar ?? '?'}</div>
        ${e.overschreven.goot || e.overschreven.nok || e.overschreven.maaiveld ? '<div class="ov">✎ handmatig overschreven</div>' : ''}`;
    }
    if (hit.kind === 'tree' && trees) {
      const t = effectiveTree(trees.trees[hit.index], store.data.overschrijvingen.bomen[trees.trees[hit.index].id]);
      return `<div class="t">Boom (${t.bron})</div><div>Hoogte ${fmtM(t.hoogte, 1)}${t.aanname ? ' (aanname)' : ''} · kroon r = ${fmtM(t.kroonstraal, 1)}</div><div>Onderkant kroon ${fmtM(t.kroonOnderkant, 1)} (aanname)</div>`;
    }
    if (hit.kind === 'design' && design) {
      const p = designPlacement()!;
      const z = design.model.zones[hit.zone];
      return `<div class="t">Nieuw pand (ontwerp)</div>
        <div>Bovenkant: ${fmtNAP(p.peil + z.top)} · ${fmtM(z.top)} boven peil</div>
        <div style="color:#bbb">Peil 0 P = ${fmtNAP(p.peil)}</div>`;
    }
    if (hit.kind === 'element') {
      const e = hit.e;
      const cs = conflicts.filter((c) => c.elementId === e.id);
      return `<div class="t">${escapeHtml(e.naam)}</div><div>${fmtM(e.lengte)} × ${fmtM(e.breedte)} · hoogte ${fmtM(totalHeight(e))}</div>${cs.length ? `<div class="ov" style="color:#ff8a80">⚠ ${cs.length} botsing(en)</div>` : ''}<div style="color:#bbb">laag ${escapeHtml(e.laag)}</div>`;
    }
    if (hit.kind === 'manual') {
      const o = hit.o;
      const extra = o.soort === 'doorrijhoogte' ? ` · vrije hoogte ${fmtM(o.vrijeHoogte ?? null)}` : o.hoogte != null ? ` · hoogte ${fmtM(o.hoogte)}` : '';
      return `<div class="t">${escapeHtml(o.naam || MANUAL_STYLE[o.soort].label)}</div><div>${MANUAL_STYLE[o.soort].label}${extra}</div>`;
    }
    if (hit.kind === 'survey') {
      const sv = hit.s;
      if (sv.kind === 'grenslijn') return `<div class="t" style="color:${GRENS_KLEUR}">Ingemeten perceelgrens</div><div style="color:#bbb">heeft voorrang op BRK</div>`;
      const pt = sv.punt;
      return `<div class="t">${sv.kind === 'grenspunt' ? 'Grenspunt' : 'Meetpunt'} ${escapeHtml(pt.nr)}${pt.code ? ` · ${escapeHtml(pt.code)}` : ''}</div><div>Z ${pt.z != null ? fmtNAP(pt.z, 3) : '–'}</div>`;
    }
    if (hit.kind === 'klic') {
      const l = hit.k.line;
      const st = themaStyle(l.thema);
      const dia = l.props['Diameter'] ?? l.props['Bedrijfsspanning'] ?? l.props['Nominale spanning'] ?? '';
      return `<div class="t"><span style="display:inline-block;width:18px;height:4px;background:${st.kleur};vertical-align:middle;margin-right:5px"></span>${escapeHtml(st.label)}</div><div>${escapeHtml(l.beheerder)} · ${l.status}${dia ? ` · ${escapeHtml(String(dia))}` : ''}</div><div style="color:#bbb">klik voor diepte en details</div>`;
    }
    if (hit.kind === 'obstacle') {
      const o = hit.o;
      const hv = store.data.overschrijvingen.obstakels[o.id]?.hoogte;
      return `<div class="t">${escapeHtml(o.spec.omschrijving)}</div><div>Hoogte ${fmtM(hv ?? o.spec.hoogte, 1)} ${hv == null ? '(aanname)' : '<span class="ov">(handmatig)</span>'}</div>`;
    }
    const rd = frame.toRD(hit.point.x, hit.point.y, hit.point.z);
    const bgt = L.bgt ? terrain.bgtAt(rd.x, rd.y, L) : null;
    return bgt ? `<div class="t">${escapeHtml(CLASS_STYLES[bgt.cls].label)}</div><div style="color:#bbb">${escapeHtml(bgt.props.functie ?? bgt.props.fysiek_voorkomen ?? bgt.collection)}</div>` : '';
  }

  // klik (zonder slepen) = selecteren
  let downAt: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (ev) => { downAt = { x: ev.clientX, y: ev.clientY }; });
  canvas.addEventListener('pointerup', (ev) => {
    if (!downAt || ev.button !== 0) return;
    const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
    downAt = null;
    if (moved > 4) return;
    const hit = pick(ev);
    if (placing) {
      if (hit) placeElement();
      return;
    }
    if (cranePlace || craneMove || liftMode) {
      if (!hit) return;
      const rd = frame.toRD(hit.point.x, hit.point.y, hit.point.z);
      const x = Math.round(rd.x * 100) / 100, y = Math.round(rd.y * 100) / 100;
      if (cranePlace) {
        const k = cranePlace === 'toren' ? newTowerCrane(x, y) : cranePlace === 'mk88' ? newMK88(x, y) : newMobileCrane(x, y);
        const n = store.data.kranen.filter((q) => q.naam.startsWith(k.naam)).length;
        if (n) k.naam += ` ${n + 1}`;
        stopCraneModes();
        L.kranen = true;
        store.change(`${k.naam} geplaatst`, (d) => { d.kranen.push(k); });
        select({ kind: 'crane', id: k.id });
        status(`${k.naam} geplaatst – vul de lasttabel van de fabrikant in`);
      } else if (craneMove) {
        const id = craneMove;
        stopCraneModes();
        store.change('Kraan verplaatst', (d) => { const k = d.kranen.find((q) => q.id === id); if (k) { k.x = x; k.y = y; } });
      } else if (liftMode) {
        doLift(rd.x, rd.y, liftMode);
      }
      return;
    }
    if (drawTool.active || measure.active) {
      const mp = hit ? snapPoint(hit.point, ev) : null;
      if (mp && drawTool.active) drawTool.click(mp.x, mp.y, ev.shiftKey);
      else if (mp) { measure.add(mp); showMeasure(); }
      return;
    }
    if (!hit) return select(null);
    if (hit.kind === 'element') return select({ kind: 'element', id: hit.e.id });
    if (hit.kind === 'manual') return select({ kind: 'manual', id: hit.o.id });
    if (hit.kind === 'route') return select({ kind: 'route', id: hit.r.id });
    if (hit.kind === 'crane') return select({ kind: 'crane', id: hit.k.id });
    if (hit.kind === 'survey') {
      if (hit.s.kind === 'grenslijn') return select({ kind: 'grens' });
      return select({ kind: 'meetpunt', index: hit.s.index, grens: hit.s.kind === 'grenspunt' });
    }
    if (hit.kind === 'klic') { const rd = frame.toRD(hit.point.x, hit.point.y, hit.point.z); return select({ kind: 'klic', refId: hit.k.refId, lineId: hit.k.line.id, x: rd.x, y: rd.y }); }
    if (hit.kind === 'building') select({ kind: 'building', id: hit.b.rec.id });
    else if (hit.kind === 'tree') select({ kind: 'tree', index: hit.index });
    else if (hit.kind === 'obstacle') select({ kind: 'obstacle', id: hit.o.id });
    else if (hit.kind === 'design') select({ kind: 'design', zone: hit.zone });
    else { const rd = frame.toRD(hit.point.x, hit.point.y, hit.point.z); select({ kind: 'terrain', x: rd.x, y: rd.y }); }
  });

  canvas.addEventListener('dblclick', (ev) => {
    if (drawTool.active) { ev.preventDefault(); drawTool.finish(); }
    else if (measure.active) { ev.preventDefault(); measure.finish(); showMeasure(); }
  });

  // --- snappen en meten
  function rebuildSnap() {
    snapIndex.clear();
    for (const b of buildings?.items ?? []) snapIndex.addRings(b.rec.footprint, 'gebouw');
    const dp = designPlacement();
    if (design && dp) snapIndex.addRings(placeRings(dp, design.model.contour), 'nieuw pand');
    for (const p of terrain.parcels) snapIndex.addRings(p.polys.flat(), 'perceelgrens (BRK)');
    const d = store.data;
    for (const q of d.inmeting.grens?.punten ?? []) snapIndex.add(q.x, q.y, `grenspunt ${q.nr}`);
    for (const q of d.inmeting.punten?.punten ?? []) snapIndex.add(q.x, q.y, `meetpunt ${q.nr}`);
    for (const o of d.handmatig) for (const q of o.coords) snapIndex.add(q[0], q[1], MANUAL_STYLE[o.soort].label);
  }
  rebuildSnap();
  /** Punt onder de muis, gesprongen naar een hoekpunt (tenzij Shift). Hoogte: geraakt punt of maaiveld. */
  function snapPoint(p: THREE.Vector3, ev: MouseEvent): MeasurePoint {
    const rd = frame.toRD(p.x, p.y, p.z);
    const mpp = mppAt(p);
    const s = ev.shiftKey ? null : snapIndex.nearest(rd.x, rd.y, Math.max(0.15, 10 * mpp));
    if (s) {
      const out = { x: s.x, y: s.y, h: terrain.heightAt(s.x, s.y) ?? rd.h };
      measure.showSnap(out, Math.max(0.15, 9 * mpp));
      status(`Gesprongen naar ${s.bron}${drawTool.active ? '' : ' – Shift = vrij'}`, 0);
      return out;
    }
    measure.showSnap(null);
    return { x: rd.x, y: rd.y, h: rd.h };
  }
  function showMeasure() {
    info.showMeasure(measure.pts, measure.finished, {
      toDimension: () => {
        const pts = measure.pts.map((q) => [Math.round(q.x * 1000) / 1000, Math.round(q.y * 1000) / 1000] as [number, number]);
        stopMeasure();
        const id = `m-${Date.now().toString(36)}`;
        L.handmatig.maatlijn = true;
        store.change('Maatlijn geplaatst', (pd) => { pd.handmatig.push({ id, soort: 'maatlijn', geom: 'lijn', coords: pts, naam: '', offset: 1.0 }); });
        select({ kind: 'manual', id });
      },
      clear: () => { measure.start(); showMeasure(); },
      stop: () => stopMeasure(),
    });
  }
  function startMeasure() {
    if (drawTool.active) drawTool.cancel();
    select(null);
    measure.start();
    $('viewport').classList.add('drawing');
    $('btnMeasure').classList.add('active');
    showMeasure();
  }
  function stopMeasure() {
    measure.stop();
    $('viewport').classList.remove('drawing');
    $('btnMeasure').classList.remove('active');
    info.hide();
    status('Meten gestopt');
  }
  $('btnMeasure').onclick = () => (measure.active ? stopMeasure() : startMeasure());

  // --- importeren en tekenen
  const importCtx: ImportContext = {
    store,
    heightAt: (x, y) => terrain.heightAt(x, y),
    brkLines: () => terrain.ownParcelRings,
    center: { x: (m.kernpunten.reduce((a, q) => a + q.x, 0)) / m.kernpunten.length, y: (m.kernpunten.reduce((a, q) => a + q.y, 0)) / m.kernpunten.length },
    ifcPlacement: () => designPlacement(),
    status: (msg) => status(msg),
  };
  const fileImport = $('fileImport') as HTMLInputElement;
  let importKind = '';
  const menus = [['btnImport', 'menuImport'], ['btnDraw', 'menuDraw'], ['btnRoute', 'menuRoute'], ['btnCrane', 'menuCrane']] as const;
  {
    const mc = $('menuCrane');
    mc.append(
      h('button', { onclick: () => { closeMenus(); startCranePlace('toren'); } }, 'Torenkraan plaatsen'),
      h('button', { onclick: () => { closeMenus(); startCranePlace('mobiel'); } }, 'Mobiele kraan plaatsen'),
      h('div', { class: 'mcat' }, 'Uit lastblad'),
      h('button', { onclick: () => { closeMenus(); startCranePlace('mk88'); } }, 'Liebherr MK 88 Plus – mobiele torenkraan 45 m'),
      h('hr'),
      h('button', { onclick: () => { closeMenus(); select({ kind: 'lift' }); } }, 'Kan last X op positie Y? (alle kranen)'),
    );
  }
  {
    const mr = $('menuRoute');
    mr.append(h('div', { class: 'mcat' }, 'Route tekenen voor'));
    for (const v of VEHICLES) mr.append(h('button', { onclick: () => { closeMenus(); startRoute(v.id); } }, v.naam));
    mr.append(h('div', { class: 'note', style: { margin: '6px 10px', maxWidth: '300px' } }, 'Teken de lijn van de vooras; daarna kun je in het paneel delen vooruit of achteruit toevoegen. Indicatief – geen vervanging van AutoTURN e.d.'));
  }
  const closeMenus = () => { for (const [, mid] of menus) $(mid).hidden = true; };
  for (const [bid, mid] of menus) $(bid).onclick = (e) => { e.stopPropagation(); const was = $(mid).hidden; closeMenus(); $(mid).hidden = !was; };
  document.addEventListener('click', closeMenus);
  for (const b of $('menuImport').querySelectorAll('button')) (b as HTMLButtonElement).onclick = () => {
    importKind = (b as HTMLElement).dataset.imp!;
    fileImport.accept = importKind === 'klic' ? '.zip,.xml' : importKind === 'dxf' ? '.dxf' : '.csv,.txt,.xyz,.asc';
    fileImport.value = '';
    fileImport.click();
    closeMenus();
  };
  fileImport.addEventListener('change', async () => {
    const f = fileImport.files?.[0];
    if (!f) return;
    if (importKind === 'grens') await importBoundary(f, importCtx);
    else if (importKind === 'punten') await importPoints(f, importCtx);
    else if (importKind === 'klic') await importKlic(f, importCtx);
    else if (importKind === 'dxf') await importDxf(f, importCtx);
  });
  const DRAW: Record<string, { soort: ManualKind; geom: DrawGeom; naam: string; extra: Partial<ManualObject> }> = {
    'doorrijhoogte-lijn': { soort: 'doorrijhoogte', geom: 'lijn', naam: 'Doorrijhoogte', extra: { vrijeHoogte: 4.0 } },
    'doorrijhoogte-vlak': { soort: 'doorrijhoogte', geom: 'vlak', naam: 'Doorrijhoogte', extra: { vrijeHoogte: 4.0 } },
    paaltjes: { soort: 'paaltjes', geom: 'punten', naam: 'Paaltjes', extra: { hoogte: 0.9 } },
    hekwerk: { soort: 'hekwerk', geom: 'lijn', naam: 'Bouwhekken', extra: { hoogte: BOUWHEK.hoogte, poorten: [] } },
    nietBerijdbaar: { soort: 'nietBerijdbaar', geom: 'vlak', naam: 'Niet berijdbaar', extra: {} },
    looproute: { soort: 'looproute', geom: 'lijn', naam: 'Looproute', extra: {} },
    vluchtroute: { soort: 'vluchtroute', geom: 'lijn', naam: 'Vluchtroute', extra: {} },
    vrijvlak: { soort: 'vrijvlak', geom: 'vlak', naam: 'Vlak', extra: {} },
    vrijelijn: { soort: 'vrijelijn', geom: 'lijn', naam: 'Lijn', extra: {} },
    vergundeZone: { soort: 'vergundeZone', geom: 'vlak', naam: 'Vergunde zone', extra: {} },
    maatlijn: { soort: 'maatlijn', geom: 'lijn', naam: '', extra: { offset: 1.0 } },
  };
  const startDraw = (key: string) => {
    const d = DRAW[key];
    if (measure.active) stopMeasure();
    select(null);
    $('viewport').classList.add('drawing');
    drawTool.start({
      geom: d.geom, kleur: MANUAL_STYLE[d.soort].kleur, titel: `${MANUAL_STYLE[d.soort].label} tekenen`,
      ...(d.soort === 'hekwerk' ? {
        snap: (prev: Pt, t: Pt) => snapFrom(prev, t),
        info: (pts: Pt[]) => `${panels(pts).length} bouwhekken (${BOUWHEK.lengte.toLocaleString('nl-NL')} m) – Shift = vrij`,
      } : {}),
      onFinish: (coords) => {
        $('viewport').classList.remove('drawing');
        measure.showSnap(null);
        const id = `m-${Date.now().toString(36)}`;
        L.handmatig[d.soort] = true;
        store.change(`${MANUAL_STYLE[d.soort].label} getekend`, (pd) => { pd.handmatig.push({ id, soort: d.soort, geom: d.geom, coords, naam: d.naam, ...d.extra }); });
        select({ kind: 'manual', id });
      },
      onCancel: () => { $('viewport').classList.remove('drawing'); measure.showSnap(null); },
    });
  };
  for (const b of $('menuDraw').querySelectorAll('button')) (b as HTMLButtonElement).onclick = () => { closeMenus(); startDraw((b as HTMLElement).dataset.draw!); };

  // --- bouwplaatselementen: plaatsen, dupliceren, verwijderen
  function facadeRings(): number[][][] {
    const r: number[][][] = [];
    for (const b of buildings?.items ?? []) if (b.rec.footprint[0] && !(b.isSporthal && design)) r.push(b.rec.footprint[0]);
    const dp = designPlacement();
    if (design && dp) r.push(...placeRings(dp, design.model.contour));
    return r;
  }
  function startPlacing(type: ElementType) {
    if (drawTool.active) drawTool.cancel();
    if (measure.active) stopMeasure();
    select(null);
    placing = newElement(type, 0, 0, 0);
    $('viewport').classList.add('drawing');
    status(`${ELEMENTS[type].label} plaatsen: klik op de kaart · R = draaien · Esc = annuleren${type === 'steiger' ? ' · springt naar de dichtstbijzijnde gevel' : ''}`, 0);
  }
  function stopPlacing() {
    placing = null;
    ghostLayer.apply([], () => true, new Set(), null);
    $('viewport').classList.remove('drawing');
  }
  function placeElement() {
    if (!placing) return;
    const e = { ...placing, x: Math.round(placing.x * 100) / 100, y: Math.round(placing.y * 100) / 100 };
    stopPlacing();
    L.elementLagen[e.laag] = true;
    store.change(`${ELEMENTS[e.type].label} geplaatst`, (d) => { d.elementen.push(e); });
    select({ kind: 'element', id: e.id });
  }
  function duplicateElement(id: string) {
    const e = store.data.elementen.find((q) => q.id === id);
    if (!e) return;
    const a = ((e.rotatie + 90) * Math.PI) / 180;
    const c = { ...e, id: newElement(e.type, 0, 0).id, x: e.x + Math.cos(a) * (e.breedte + 0.5), y: e.y + Math.sin(a) * (e.breedte + 0.5), groep: undefined };
    store.change(`${e.naam} gedupliceerd`, (d) => { d.elementen.push(c); });
    select({ kind: 'element', id: c.id });
  }
  function removeElement(id: string) {
    const e = store.data.elementen.find((q) => q.id === id);
    store.change(`${e?.naam ?? 'Element'} verwijderd`, (d) => { d.elementen = d.elementen.filter((q) => q.id !== id); });
    select(null);
  }
  function alignSteiger(id: string) {
    const e = store.data.elementen.find((q) => q.id === id);
    if (!e) return;
    const al = alignToEdge(e, facadeRings(), 8);
    if (!al) { status('Geen gevel binnen 8 m gevonden'); return; }
    store.change('Steiger uitgelijnd op gevel', (d) => { const x = d.elementen.find((q) => q.id === id); if (x) Object.assign(x, al); });
  }
  function updateElement(id: string, label: string, fn: (e: Element) => void) {
    store.change(label, (d) => { const x = d.elementen.find((q) => q.id === id); if (x) fn(x); });
  }
  // menu met de elementbibliotheek
  {
    const menu = $('menuElement');
    const cats = new Map<string, ElementType[]>();
    for (const [t, sp] of Object.entries(ELEMENTS) as [ElementType, (typeof ELEMENTS)[ElementType]][]) {
      if (!cats.has(sp.categorie)) cats.set(sp.categorie, []);
      cats.get(sp.categorie)!.push(t);
    }
    for (const [cat, types] of cats) {
      menu.append(h('div', { class: 'mcat' }, cat));
      for (const t of types) {
        const sp = ELEMENTS[t];
        const maat = sp.vlak && sp.hoogte === 0 ? `${sp.lengte} × ${sp.breedte} m` : `${sp.lengte} × ${sp.breedte} × ${sp.hoogte} m`;
        menu.append(h('button', { onclick: () => { menu.hidden = true; startPlacing(t); } }, `${sp.label}  `, h('span', { style: { color: '#888', fontSize: '12px' } }, maat.replace(/\./g, ','))));
      }
    }
    menu.append(h('hr'), h('button', { onclick: () => { menu.hidden = true; startOccupy(); } }, 'Parkeervakken bezet (worst case)…'));
    $('btnElement').onclick = (e) => { e.stopPropagation(); const was = menu.hidden; for (const id of ['menuImport', 'menuDraw', 'menuRoute', 'menuCrane']) $(id).hidden = true; menu.hidden = !was; };
    document.addEventListener('click', () => { menu.hidden = true; });
  }
  // parkeervakken bezet: zone tekenen → auto's in alle BGT-parkeervakken erin
  function startOccupy() {
    select(null);
    $('viewport').classList.add('drawing');
    drawTool.start({
      geom: 'vlak', kleur: '#546e7a', titel: 'Zone voor "parkeervakken bezet" tekenen',
      onFinish: (zone) => {
        $('viewport').classList.remove('drawing');
        measure.showSnap(null);
        const groep = `bezet-${Date.now().toString(36)}`;
        const cars: Element[] = [];
        for (const p of terrain.polys) {
          if (p.cls !== 'parkeervak') continue;
          const outer = p.polys[0]?.[0];
          if (!outer) continue;
          const cx = outer.reduce((a, q) => a + q[0], 0) / outer.length, cy = outer.reduce((a, q) => a + q[1], 0) / outer.length;
          if (!pointInRingZone(cx, cy, zone)) continue;
          for (const c of carsForBay(outer)) cars.push({ ...newElement('auto', c.x, c.y, c.rotatie), laag: 'Geparkeerde voertuigen (bezet)', groep, naam: 'Auto (bezet vak)' });
        }
        if (!cars.length) { status('Geen BGT-parkeervakken in deze zone gevonden'); return; }
        L.elementLagen['Geparkeerde voertuigen (bezet)'] = true;
        store.change(`${cars.length} parkeervakken bezet`, (d) => { d.elementen.push(...cars); });
        status(`${cars.length} auto's geplaatst in BGT-parkeervakken (laag "Geparkeerde voertuigen (bezet)")`);
      },
      onCancel: () => { $('viewport').classList.remove('drawing'); measure.showSnap(null); },
    });
  }
  function pointInRingZone(x: number, y: number, r: number[][]) {
    let ins = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > y) !== (r[j][1] > y) && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) ins = !ins;
    return ins;
  }

  // --- slepen van elementen (verplaatsen, maat, draaien)
  type EDrag = { id: string; orig: Element; kind: ElementHandleKind | 'move'; start: Pt; moved: boolean; sx: number; sy: number };
  let eDrag: EDrag | null = null;
  const applyEDrag = (d: EDrag, p: Pt, free: boolean) => {
    const e = store.data.elementen.find((q) => q.id === d.id);
    if (!e) return;
    const o = d.orig;
    const a = (o.rotatie * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
    if (d.kind === 'move') {
      e.x = Math.round((o.x + p[0] - d.start[0]) * 100) / 100;
      e.y = Math.round((o.y + p[1] - d.start[1]) * 100) / 100;
    } else if (d.kind === 'rotate') {
      const deg = (Math.atan2(p[1] - o.y, p[0] - o.x) * 180) / Math.PI;
      e.rotatie = free ? Math.round(((deg % 360) + 360) % 360 * 10) / 10 : snapAngle(deg, rotStep);
    } else {
      const along = d.kind.startsWith('len');
      const sign = d.kind.endsWith('+') ? 1 : -1;
      const ax = along ? ux : vx, ay = along ? uy : vy;
      const u = (p[0] - o.x) * ax + (p[1] - o.y) * ay;
      const half = along ? o.lengte / 2 : o.breedte / 2;
      const size = Math.max(0.2, Math.round((sign * u + half) * 10) / 10);
      const shift = (size - 2 * half) / 2 * sign;
      if (along) e.lengte = size; else e.breedte = size;
      e.x = o.x + ax * shift;
      e.y = o.y + ay * shift;
    }
  };
  $('viewport').addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || drawTool.active || measure.active || placing || !selectedElement) return;
    const e = store.data.elementen.find((q) => q.id === selectedElement);
    if (!e) return;
    let kind: EDrag['kind'] | null = elHandles.pick(rayAt(ev));
    if (!kind) {
      const hit = pick(ev);
      if (hit?.kind !== 'element' || hit.e.id !== e.id) return;
      kind = 'move';
    }
    const p = terrainRD(ev);
    if (!p) return;
    ev.stopPropagation();
    eDrag = { id: e.id, orig: { ...e }, kind, start: p, moved: false, sx: ev.clientX, sy: ev.clientY };
    viewer.controls.enabled = false;
  }, { capture: true });
  window.addEventListener('pointermove', (ev) => {
    if (!eDrag) return;
    if (!eDrag.moved && Math.hypot(ev.clientX - eDrag.sx, ev.clientY - eDrag.sy) < 4) return;
    const p = terrainRD(ev);
    if (!p) return;
    if (!eDrag.moved) { eDrag.moved = true; dragHidden = eDrag.id; terrain.redraw(L); }
    applyEDrag(eDrag, p, ev.shiftKey);
    computeConflicts();
    elementsLayer.apply(store.data.elementen, elVisible, L.botsingen ? conflictSet : new Set(), selectedElement);
    const e = store.data.elementen.find((q) => q.id === eDrag!.id)!;
    elHandles.set(e);
    const nc = conflicts.filter((c) => c.elementId === e.id).length;
    status(`${e.naam}: ${fmt2(e.lengte)} × ${fmt2(e.breedte)} m · ${fmt2(e.rotatie)}°${nc ? ` · ⚠ ${nc} botsing(en)` : ''}${eDrag.kind === 'rotate' ? ` — stap ${rotStep}°, Shift = vrij` : ''}`, 0);
  });
  window.addEventListener('pointerup', () => {
    if (!eDrag) return;
    const d = eDrag;
    eDrag = null;
    viewer.controls.enabled = true;
    if (!d.moved) return;
    dragHidden = null;
    const e = store.data.elementen.find((q) => q.id === d.id)!;
    const now = { x: e.x, y: e.y, rotatie: e.rotatie, lengte: e.lengte, breedte: e.breedte };
    Object.assign(e, d.orig);
    updateElement(d.id, { move: `${e.naam} verplaatst`, rotate: `${e.naam} gedraaid` }[d.kind as 'move' | 'rotate'] ?? `${e.naam} maat aangepast`, (x) => Object.assign(x, now));
  });
  viewer.onFrame(() => { if (elHandles.el) elHandles.scale(mppAt(viewer.controls.target)); });

  // --- kranen slepen (fase 5)
  $('viewport').addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || drawTool.active || measure.active || placing || cranePlace || craneMove || liftMode || !L.kranen) return;
    // alleen de kraan zelf (3D-delen of voetafdruk op maaiveld), ook onder boomkronen
    const rect = viewer.renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, viewer.camera);
    let kr: Crane | null = null;
    for (const hh of raycaster.intersectObjects(craneLayer.pickable(), true)) {
      const id = hh.object.userData.id;
      kr = store.data.kranen.find((q) => q.id === id) ?? null;
      if (kr) break;
    }
    const p = terrainRD(ev);
    if (!p) return;
    if (!kr) { const tp = terrain.intersectRay(raycaster.ray); kr = hitCrane(store.data.kranen, p[0], p[1], tp ? Math.max(0.5, 4 * mppAt(tp)) : 1); }
    if (!kr) return;
    ev.stopPropagation();
    craneDrag = { id: kr.id, ox: kr.x, oy: kr.y, sx: ev.clientX, sy: ev.clientY, start: p, moved: false };
    viewer.controls.enabled = false;
  }, { capture: true });
  let craneDragFrame = false;
  window.addEventListener('pointermove', (ev) => {
    if (!craneDrag) return;
    if (!craneDrag.moved && Math.hypot(ev.clientX - craneDrag.sx, ev.clientY - craneDrag.sy) < 4) return;
    const p = terrainRD(ev);
    if (!p) return;
    const k = store.data.kranen.find((q) => q.id === craneDrag!.id);
    if (!k) return;
    if (!craneDrag.moved) { craneDrag.moved = true; craneHidden = k.id; liftMarker = null; terrain.redraw(L); }
    k.x = Math.round((craneDrag.ox + p[0] - craneDrag.start[0]) * 100) / 100;
    k.y = Math.round((craneDrag.oy + p[1] - craneDrag.start[1]) * 100) / 100;
    if (!craneDragFrame) {
      craneDragFrame = true;
      requestAnimationFrame(() => {
        craneDragFrame = false;
        craneLayer.apply(store.data.kranen, L.kranen, craneDrag?.id ?? selectedCrane, null);
        status(`${k.naam}: ${fmtRD(k.x, k.y)} – loslaten om te plaatsen`, 0);
      });
    }
  });
  window.addEventListener('pointerup', () => {
    if (!craneDrag) return;
    const d = craneDrag;
    craneDrag = null;
    viewer.controls.enabled = true;
    if (!d.moved) { select({ kind: 'crane', id: d.id }); return; }
    craneHidden = null;
    const k = store.data.kranen.find((q) => q.id === d.id);
    if (!k) return;
    const nx = k.x, ny = k.y;
    k.x = d.ox; k.y = d.oy;
    store.change(`${k.naam} verplaatst`, (pd) => { const x = pd.kranen.find((q) => q.id === d.id); if (x) { x.x = nx; x.y = ny; } });
    if (selectedCrane !== d.id) select({ kind: 'crane', id: d.id });
    status(`${k.naam} verplaatst – controles bijgewerkt`);
  });

  // --- slepen van eigen objecten (hoekpunten, tussenpunten, poorten, geheel)
  type Drag = {
    o: ManualObject; orig: ManualObject; kind: 'vertex' | 'mid' | 'gate' | 'body'; index: number; gateId?: string;
    start: Pt; moved: boolean; sx: number; sy: number;
  };
  let drag: Drag | null = null;
  const rayAt = (ev: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, viewer.camera);
    return raycaster;
  };
  const terrainRD = (ev: MouseEvent): Pt | null => {
    const tp = terrain.intersectRay(rayAt(ev).ray);
    if (!tp) return null;
    const rd = frame.toRD(tp.x, tp.y, tp.z);
    return [rd.x, rd.y];
  };
  const fmt2 = (v: number) => v.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const shapeStatus = (o: ManualObject, seg?: number): string => {
    const pts = o.coords as Pt[];
    if (o.soort === 'hekwerk') {
      const ps = panels(pts);
      const ing = ps.filter((p) => !p.heel).length;
      const z = seg != null && seg >= 0 && seg < pts.length - 1 ? ` · zijde ${fmt2(Math.hypot(pts[seg + 1][0] - pts[seg][0], pts[seg + 1][1] - pts[seg][1]))} m` : '';
      return `Bouwhekken: ${ps.length} stuks${ing ? ` (${ing} ingekort)` : ''} · ${fmt2(totalLength(pts))} m${z} · ${(o.poorten ?? []).length} poort(en)`;
    }
    if (o.geom === 'vlak') {
      let a = 0;
      for (let i = 0; i < pts.length; i++) { const q = pts[(i + 1) % pts.length]; a += pts[i][0] * q[1] - q[0] * pts[i][1]; }
      return `${MANUAL_STYLE[o.soort].label}: ${fmt2(Math.abs(a) / 2)} m²`;
    }
    return `${MANUAL_STYLE[o.soort].label}: ${pts.length > 1 ? `${fmt2(totalLength(pts))} m` : `${pts.length} punt(en)`}`;
  };
  const applyDrag = (d: Drag, p: Pt, free: boolean) => {
    const o = d.o;
    const fence = o.soort === 'hekwerk' && !free;
    if (d.kind === 'mid') {
      o.coords.splice(d.index + 1, 0, p);
      d.kind = 'vertex';
      d.index = d.index + 1;
    }
    if (d.kind === 'vertex') {
      let q = p;
      if (fence && o.coords.length >= 2) q = snapFrom(d.index > 0 ? o.coords[d.index - 1] as Pt : o.coords[1] as Pt, p);
      o.coords[d.index] = [Math.round(q[0] * 1000) / 1000, Math.round(q[1] * 1000) / 1000];
    } else if (d.kind === 'gate' && o.poorten) {
      const ps = panels(o.coords as Pt[]);
      const g = o.poorten.find((x) => x.id === d.gateId);
      if (g) Object.assign(g, clampGate({ ...g, start: nearestPanel(ps, p[0], p[1]) - Math.floor((g.aantal - 1) / 2) }, ps.length));
    } else if (d.kind === 'body') {
      const dx = p[0] - d.start[0], dy = p[1] - d.start[1];
      o.coords = d.orig.coords.map(([x, y]) => [Math.round((x + dx) * 1000) / 1000, Math.round((y + dy) * 1000) / 1000]);
    }
  };
  $('viewport').addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || drawTool.active || !selectedManual) return;
    const o = store.data.handmatig.find((q) => q.id === selectedManual);
    if (!o) return;
    const hInfo = handles.pick(rayAt(ev));
    let kind: Drag['kind'];
    if (hInfo) kind = hInfo.kind;
    else {
      const hit = pick(ev);
      if (hit?.kind !== 'manual' || hit.o.id !== o.id) return;
      kind = 'body';
    }
    const p = terrainRD(ev);
    if (!p) return;
    ev.stopPropagation();
    drag = { o, orig: JSON.parse(JSON.stringify(o)), kind, index: hInfo?.index ?? 0, gateId: hInfo?.gateId, start: p, moved: false, sx: ev.clientX, sy: ev.clientY };
    viewer.controls.enabled = false;
  }, { capture: true });
  window.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 4) return;
    const p = terrainRD(ev);
    if (!p) return;
    if (!drag.moved) { drag.moved = true; dragHidden = drag.o.id; terrain.redraw(L); }
    applyDrag(drag, p, ev.shiftKey);
    userLayer.apply(store.data, L, selectedManual);
    handles.set(drag.o, true);
    status(`${shapeStatus(drag.o, drag.kind === 'vertex' ? drag.index - 1 : undefined)}${drag.o.soort === 'hekwerk' ? ' — Shift = vrij slepen' : ''}`, 0);
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    viewer.controls.enabled = true;
    if (!d.moved) return;
    dragHidden = null;
    const coords = d.o.coords.map((q) => [q[0], q[1]] as [number, number]);
    const poorten = d.o.poorten ? JSON.parse(JSON.stringify(d.o.poorten)) : undefined;
    d.o.coords = d.orig.coords;
    d.o.poorten = d.orig.poorten;
    const label = { vertex: 'Hoekpunt verplaatst', mid: 'Hoekpunt toegevoegd', gate: 'Poort verschoven', body: `${MANUAL_STYLE[d.o.soort].label} verplaatst` }[d.kind];
    store.change(label, (pd) => {
      const x = pd.handmatig.find((q) => q.id === d.o.id);
      if (x) { x.coords = coords; if (poorten) x.poorten = poorten; }
    });
    status(shapeStatus(store.data.handmatig.find((q) => q.id === d.o.id)!));
  });
  // dubbelklik op een hoekpunt = verwijderen
  canvas.addEventListener('dblclick', (ev) => {
    if (drawTool.active || !selectedManual) return;
    const h0 = handles.pick(rayAt(ev));
    if (h0?.kind !== 'vertex') return;
    const o = store.data.handmatig.find((q) => q.id === selectedManual)!;
    const min = o.geom === 'vlak' ? 3 : o.geom === 'lijn' ? 2 : 1;
    if (o.coords.length <= min) { status(`Minimaal ${min} punt(en) nodig`); return; }
    store.change('Hoekpunt verwijderd', (pd) => { const x = pd.handmatig.find((q) => q.id === o.id); if (x) x.coords.splice(h0.index, 1); });
  });
  viewer.onFrame(() => { if (handles.visible) handles.scale(mppAt(viewer.controls.target)); });

  // --- camera
  const sporthalCenter = (): THREE.Vector3 => {
    const sh = buildings?.sporthal;
    if (sh) {
      sh.mesh.geometry.computeBoundingBox();
      const c = sh.mesh.geometry.boundingBox!.getCenter(new THREE.Vector3());
      return new THREE.Vector3(c.x, terrain.heightAt(frame.toRD(c.x, 0, c.z).x, frame.toRD(c.x, 0, c.z).y) ?? 0, c.z);
    }
    const k = m.kernpunten;
    const p = frame.toLocal(k.reduce((s, q) => s + q.x, 0) / k.length, k.reduce((s, q) => s + q.y, 0) / k.length, 0);
    return new THREE.Vector3(p.x, 0, p.z);
  };
  const zoomSporthal = () => {
    const c = sporthalCenter();
    viewer.focus(c, 45);
  };
  {
    const c = sporthalCenter();
    viewer.controls.target.copy(c);
    viewer.camera.position.copy(c.clone().add(new THREE.Vector3(-110, 140, 150)));
  }
  const compass = $('compass');
  viewer.onFrame(() => {
    compass.style.transform = `rotate(${THREE.MathUtils.radToDeg(viewer.azimuth())}deg)`;
  });

  // --- opslaan / openen
  const saveProject = () => {
    autosave();
    const blob = new Blob([store.serialize()], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = `project-sporthal-latourpad-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    store.dirty = false;
    status('Project opgeslagen (download)');
  };
  const fileOpen = $('fileOpen') as HTMLInputElement;
  fileOpen.addEventListener('change', async () => {
    const f = fileOpen.files?.[0];
    if (!f) return;
    try {
      const p = parseProject(await f.text());
      L = mergeLayers(p.weergave?.lagen ?? L);
      store.replace(p);
      select(null);
      terrain.redraw(L);
      applyScene();
      renderPanel();
      status(`Project "${f.name}" geopend`);
    } catch (e) {
      alert(`Kan het project niet openen:\n${(e as Error).message}`);
    }
    fileOpen.value = '';
  });

  // --- knoppen
  const toggleLayers = () => {
    const el = $('layers');
    el.hidden = !el.hidden;
    $('btnLayers').classList.toggle('active', !el.hidden);
    try { localStorage.setItem('bouwplaats-sporthal:lagen-paneel', el.hidden ? 'dicht' : 'open'); } catch { /* */ }
  };
  $('btnLayers').onclick = toggleLayers;
  try { if (localStorage.getItem('bouwplaats-sporthal:lagen-paneel') === 'dicht') $('layers').hidden = true; } catch { /* */ }
  $('btnLayers').classList.toggle('active', !$('layers').hidden);
  $('btnSave').onclick = saveProject;
  $('btnOpen').onclick = () => fileOpen.click();
  btnUndo.onclick = () => store.undo();
  btnRedo.onclick = () => store.redo();
  $('btnTop').onclick = () => viewer.to2D();
  $('btnOblique').onclick = () => viewer.to3D();
  const scalebar = $('scalebar');
  const syncMode = (mode: string) => {
    $('btnTop').classList.toggle('active', mode === '2d');
    $('btnOblique').classList.toggle('active', mode === '3d');
    scalebar.hidden = mode !== '2d';
    status(mode === '2d' ? '2D-bovenaanzicht: orthografisch, zonder perspectief' : '3D-aanzicht');
  };
  viewer.onModeChange(syncMode);
  syncMode(viewer.mode);
  viewer.onFrame(() => {
    if (viewer.mode !== '2d') return;
    const mpp = viewer.metersPerPixel();
    const target = mpp * 120;
    const p10 = 10 ** Math.floor(Math.log10(target));
    const nice = [1, 2, 5, 10].map((k) => k * p10).filter((v) => v <= target).pop() ?? p10;
    const px = nice / mpp;
    (scalebar.querySelector('.bar') as HTMLElement).style.width = `${px}px`;
    scalebar.querySelector('.lbl')!.textContent = `${nice.toLocaleString('nl-NL')} m  ·  scherm ≈ 1:${Math.round(mpp / 0.0002646).toLocaleString('nl-NL')}`;
  });
  $('btnSporthal').onclick = zoomSporthal;
  $('btnHelp').onclick = () => openModal(helpContent());
  $('btnSources').onclick = () => openModal(sourcesContent(m));
  $('lnkSources').onclick = (e) => { e.preventDefault(); openModal(sourcesContent(m)); };
  compass.onclick = () => viewer.northUp();

  // --- sneltoetsen
  window.addEventListener('keydown', (ev) => {
    const tag = (ev.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const ctrl = ev.ctrlKey || ev.metaKey;
    const key = ev.key.toLowerCase();
    if ((cranePlace || craneMove || liftMode) && ev.key === 'Escape') { ev.preventDefault(); stopCraneModes(); status('Gestopt'); return; }
    if (placing) {
      if (ev.key === 'Escape') { ev.preventDefault(); stopPlacing(); status('Plaatsen geannuleerd'); return; }
      if (key === 'r') { ev.preventDefault(); placing.rotatie = snapAngle(placing.rotatie + (ev.shiftKey ? -rotStep : rotStep), rotStep); ghostLayer.apply([{ ...placing }], () => true, new Set(), placing.id); return; }
    }
    if (selectedElement && !modalOpen()) {
      const id = selectedElement;
      if (ctrl && key === 'd') { ev.preventDefault(); duplicateElement(id); return; }
      if (!ctrl && (ev.key === 'Delete' || ev.key === 'Backspace')) { ev.preventDefault(); removeElement(id); return; }
      if (!ctrl && key === 'r') { ev.preventDefault(); updateElement(id, 'Element gedraaid', (x) => { x.rotatie = snapAngle(x.rotatie + (ev.shiftKey ? -rotStep : rotStep), rotStep); }); return; }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      if (!ctrl && arrows[ev.key]) {
        ev.preventDefault();
        const st = ev.shiftKey ? 1 : 0.1;
        updateElement(id, 'Element geschoven', (x) => { x.x = Math.round((x.x + arrows[ev.key][0] * st) * 100) / 100; x.y = Math.round((x.y + arrows[ev.key][1] * st) * 100) / 100; });
        return;
      }
    }
    if (ctrl && key === 'z' && !ev.shiftKey) { ev.preventDefault(); store.undo(); return; }
    if (ctrl && (key === 'y' || (key === 'z' && ev.shiftKey))) { ev.preventDefault(); store.redo(); return; }
    if (ctrl && key === 's') { ev.preventDefault(); saveProject(); return; }
    if (ctrl && key === 'o') { ev.preventDefault(); fileOpen.click(); return; }
    if (measure.active && !modalOpen()) {
      if (ev.key === 'Enter') { ev.preventDefault(); measure.finish(); showMeasure(); return; }
      if (ev.key === 'Escape') { ev.preventDefault(); stopMeasure(); return; }
      if (ev.key === 'Backspace') { ev.preventDefault(); measure.undoPoint(); showMeasure(); return; }
    }
    if (drawTool.active) {
      if (ev.key === 'Enter') { ev.preventDefault(); drawTool.finish(); return; }
      if (ev.key === 'Escape') { ev.preventDefault(); drawTool.cancel(); return; }
      if (ev.key === 'Backspace') { ev.preventDefault(); drawTool.undoPoint(); return; }
    }
    if (ctrl || ev.altKey) return;
    if (ev.key === 'Escape') { if (modalOpen()) closeModal(); else select(null); return; }
    if (ev.key === 'F1' || ev.key === '?') { ev.preventDefault(); openModal(helpContent()); return; }
    if (modalOpen()) return;
    if (key === 't') viewer.to2D();
    else if (key === 'p') viewer.to3D();
    else if (key === 'z') zoomSporthal();
    else if (key === 'n') viewer.northUp();
    else if (key === 'm') (measure.active ? stopMeasure() : startMeasure());
    else if (key === 'k') { L.plattegrond = !L.plattegrond; if (L.plattegrond) viewer.to2D(); terrain.redraw(L); applyScene(); renderPanel(); autosave(); status(L.plattegrond ? 'Plattegrond (kadasterkaart)' : 'Luchtfoto / 3D'); }
    else if (key === 'b') openModal(sourcesContent(m));
    else if (key === 'l') toggleLayers();
    else if (key === 's') {
      const order: SporthalMode[] = ['normaal', 'transparant', 'verborgen'];
      L.sporthal = order[(order.indexOf(L.sporthal) + 1) % order.length];
      applyScene(); renderPanel(); autosave();
      status(`Sporthal: ${L.sporthal}`);
    }
  });
  window.addEventListener('beforeunload', autosave);

  $('loading').remove();
  status(`Geladen: ${data.buildings?.gebouwen.length ?? 0} gebouwen, ${data.trees?.bomen.length ?? 0} bomen, ${obstacles.items.length} obstakels`);
}

let statusTimer = 0;
/** Statusmelding; `ms` = 0 laat de melding staan. */
function status(msg: string, ms = 6000) {
  const el = $('stMsg');
  el.textContent = msg;
  clearTimeout(statusTimer);
  if (ms) statusTimer = window.setTimeout(() => (el.textContent = ''), ms);
}

function renderWarnings(data: LoadedData, b: ActiveBoundary, nConflicts = 0, extra: string[] = []) {
  const w = $('warnings');
  w.innerHTML = '';
  const failed = data.manifest.bronnen.filter((s) => s.status !== 'ok');
  for (const s of failed) w.append(h('div', { class: 'warnbox' }, `⚠ Bron niet beschikbaar: ${s.naam}. Draai "npm run data" opnieuw.`));
  if (nConflicts) w.append(h('div', { class: 'warnbox', style: { background: '#fdecea', color: '#b71c1c', borderColor: '#f5a3a3' } }, `⚠ ${nConflicts} element(en) met een botsing – zie het lagenpaneel (Bouwplaatselementen).`));
  for (const t of extra) w.append(h('div', { class: 'warnbox', style: { background: '#fdecea', color: '#b71c1c', borderColor: '#f5a3a3' } }, t));
  if (b.bron !== 'ingemeten') w.append(h('div', { class: 'warnbox' }, `⚠ Indicatieve grens: ${b.omschrijving}. Nog geen ingemeten perceelgrens geïmporteerd.`));
}

start();
