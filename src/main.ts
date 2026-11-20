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
import { BOUWHEK, clampGate, nearestPanel, panels, snapFrom, totalLength, type Pt } from './core/polyline';
import { editCodes, importBoundary, importDxf, importKlic, importPoints, type ImportContext } from './ui/importDialogs';
import { themaStyle } from './data/klic';

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
  terrain.overlays.push(
    dxfOverlay(() => store.data, () => designPlacement()),
    klicOverlay(() => store.data),
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
  const applyScene = () => {
    // 2D-lagen opnieuw tekenen als de eigen invoer veranderd is
    const d = store.data;
    const ok = JSON.stringify([d.inmeting, d.klic, d.onderleggers, d.handmatig, selectedManual]);
    terrain.ownParcelHighlight = !d.inmeting.grens;
    if (ok !== overlayKey) { overlayKey = ok; terrain.redraw(L); }
    userLayer.apply(d, L, selectedManual);
    renderWarnings(data, boundary());
    const ov = store.data.overschrijvingen;
    buildings?.apply(L, ov.gebouwen);
    trees?.apply(L.bomen, ov.bomen);
    obstacles.apply(L, ov.obstakels);
    const p = designPlacement();
    if (design && p) {
      design.apply(p, L.ontwerp, L.ontwerpTransparant);
      const key = JSON.stringify(p);
      if (key !== contourKey) {
        contourKey = key;
        terrain.designContour = placeRings(p, design.model.contour);
        terrain.redraw(L);
      }
    }
  };
  const designMaaiveld = () => {
    const p = designPlacement();
    return p ? terrain.heightAt(p.x, p.y) : null;
  };
  const renderPanel = () =>
    renderLayersPanel({
      root: $('layers'), data, state: L, hypsoRange: terrain.hypsoRange, presentClasses, obstacleCounts,
      designPlacementIsAuto: !store.data.ontwerpPlaatsing,
      onDesignPlacement: () => select({ kind: 'design', zone: null }),
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
    if (selectedManual) handles.set(store.data.handmatig.find((q) => q.id === selectedManual) ?? null);
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
    const prevManual = selectedManual;
    selectedManual = s?.kind === 'manual' ? s.id : null;
    handles.set(selectedManual ? store.data.handmatig.find((q) => q.id === selectedManual) ?? null : null);
    if (prevManual !== selectedManual) applyScene();
    refreshInfo();
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
    | { kind: 'survey'; s: SurveyHit; point: THREE.Vector3 }
    | { kind: 'klic'; k: KlicHit; point: THREE.Vector3 }
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
    const targets: THREE.Object3D[] = [...(buildings?.pickable() ?? []), ...obstacles.pickable(), ...(design?.pickable() ?? []), ...userLayer.pickable()];
    if (trees && trees.group.visible) targets.push(trees.crowns);
    const hits = raycaster.intersectObjects(targets, true);
    const tp = terrain.intersectRay(raycaster.ray);
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
    if (drawTool.active) {
      tooltip.hidden = true;
      const tp = hit?.point;
      if (tp) { const rd = frame.toRD(tp.x, tp.y, tp.z); drawTool.move(rd.x, rd.y, ev.shiftKey); stCoord.textContent = fmtRD(rd.x, rd.y); }
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
    if (drawTool.active) {
      if (hit) { const rd = frame.toRD(hit.point.x, hit.point.y, hit.point.z); drawTool.click(rd.x, rd.y, ev.shiftKey); }
      return;
    }
    if (!hit) return select(null);
    if (hit.kind === 'manual') return select({ kind: 'manual', id: hit.o.id });
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

  canvas.addEventListener('dblclick', (ev) => { if (drawTool.active) { ev.preventDefault(); drawTool.finish(); } });

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
  const menus = [['btnImport', 'menuImport'], ['btnDraw', 'menuDraw']] as const;
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
  };
  const startDraw = (key: string) => {
    const d = DRAW[key];
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
        const id = `m-${Date.now().toString(36)}`;
        L.handmatig[d.soort] = true;
        store.change(`${MANUAL_STYLE[d.soort].label} getekend`, (pd) => { pd.handmatig.push({ id, soort: d.soort, geom: d.geom, coords, naam: d.naam, ...d.extra }); });
        select({ kind: 'manual', id });
      },
      onCancel: () => $('viewport').classList.remove('drawing'),
    });
  };
  for (const b of $('menuDraw').querySelectorAll('button')) (b as HTMLButtonElement).onclick = () => { closeMenus(); startDraw((b as HTMLElement).dataset.draw!); };

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
    if (ctrl && key === 'z' && !ev.shiftKey) { ev.preventDefault(); store.undo(); return; }
    if (ctrl && (key === 'y' || (key === 'z' && ev.shiftKey))) { ev.preventDefault(); store.redo(); return; }
    if (ctrl && key === 's') { ev.preventDefault(); saveProject(); return; }
    if (ctrl && key === 'o') { ev.preventDefault(); fileOpen.click(); return; }
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
    else if (key === 'b') openModal(sourcesContent(m));
    else if (key === 'l') { const el = $('layers'); el.hidden = !el.hidden; }
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

function renderWarnings(data: LoadedData, b: ActiveBoundary) {
  const w = $('warnings');
  w.innerHTML = '';
  const failed = data.manifest.bronnen.filter((s) => s.status !== 'ok');
  for (const s of failed) w.append(h('div', { class: 'warnbox' }, `⚠ Bron niet beschikbaar: ${s.naam}. Draai "npm run data" opnieuw.`));
  if (b.bron !== 'ingemeten') w.append(h('div', { class: 'warnbox' }, `⚠ Indicatieve grens: ${b.omschrijving}. Nog geen ingemeten perceelgrens geïmporteerd.`));
}

start();
