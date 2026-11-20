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
import { ObstaclesLayer, type Obstacle } from './scene/obstaclesLayer';
import { TerrainLayer } from './scene/terrainLayer';
import { effectiveTree, TreesLayer } from './scene/treesLayer';
import { Viewer } from './scene/viewer';
import { closeModal, helpContent, modalOpen, openModal, sourcesContent } from './ui/dialogs';
import { $, escapeHtml, h } from './ui/dom';
import { InfoPanel } from './ui/infoPanel';
import { renderLayersPanel } from './ui/layersPanel';

const AUTOSAVE_KEY = 'bouwplaats-sporthal-latourpad:project';

type Selection =
  | { kind: 'building'; id: string }
  | { kind: 'tree'; index: number }
  | { kind: 'obstacle'; id: string }
  | { kind: 'terrain'; x: number; y: number }
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

  // --- project
  let initial: ProjectData = emptyProject(PROJECT.naam);
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) initial = parseProject(saved);
  } catch { /* geen opslag beschikbaar */ }
  const store = new ProjectStore(initial);
  let L: LayerState = mergeLayers(initial.weergave?.lagen);

  const autosave = () => {
    store.data.weergave = { ...(store.data.weergave ?? {}), lagen: L as any };
    try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(store.data)); } catch { /* negeren */ }
  };

  // --- UI
  const info = new InfoPanel($('info'), store, () => select(null));
  let selection: Selection = null;

  const presentClasses = new Set<string>([...terrain.polys.map((p) => p.cls), ...terrain.lines.map((l) => l.cls), ...terrain.points.map((p) => p.cls)]);
  const obstacleCounts: Record<string, number> = {};
  for (const o of obstacles.items) obstacleCounts[o.spec.categorie] = (obstacleCounts[o.spec.categorie] ?? 0) + 1;

  const applyScene = () => {
    const ov = store.data.overschrijvingen;
    buildings?.apply(L, ov.gebouwen);
    trees?.apply(L.bomen, ov.bomen);
    obstacles.apply(L, ov.obstakels);
  };
  const renderPanel = () =>
    renderLayersPanel({
      root: $('layers'), data, state: L, hypsoRange: terrain.hypsoRange, presentClasses, obstacleCounts,
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
  renderWarnings(data);

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
    applyScene();
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
    obstacles.setSelected(s?.kind === 'obstacle' ? obstacles.byId.get(s.id) ?? null : null);
    obstacles.apply(L, store.data.overschrijvingen.obstakels);
    refreshInfo();
  }
  function refreshInfo() {
    const s = selection;
    if (!s) return info.hide();
    if (s.kind === 'building') { const b = buildings?.byId.get(s.id); if (b) info.showBuilding(b); }
    else if (s.kind === 'tree' && trees) info.showTree(trees.trees[s.index]);
    else if (s.kind === 'obstacle') { const o = obstacles.byId.get(s.id); if (o) info.showObstacle(o); }
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
    | { kind: 'terrain'; point: THREE.Vector3 };
  const pick = (ev: PointerEvent | MouseEvent): Hit | null => {
    const rect = viewer.renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, viewer.camera);
    const targets: THREE.Object3D[] = [...(buildings?.pickable() ?? []), ...obstacles.pickable()];
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
    }
    return tp ? { kind: 'terrain', point: tp } : null;
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
        <div style="color:#bbb">Peildatum: ${(r.pwBron ?? '?').toUpperCase()} ${r.pwDatum ?? ''} · bouwjaar ${r.bouwjaar ?? '?'}</div>
        ${e.overschreven.goot || e.overschreven.nok || e.overschreven.maaiveld ? '<div class="ov">✎ handmatig overschreven</div>' : ''}`;
    }
    if (hit.kind === 'tree' && trees) {
      const t = effectiveTree(trees.trees[hit.index], store.data.overschrijvingen.bomen[trees.trees[hit.index].id]);
      return `<div class="t">Boom (${t.bron})</div><div>Hoogte ${fmtM(t.hoogte, 1)}${t.aanname ? ' (aanname)' : ''} · kroon r = ${fmtM(t.kroonstraal, 1)}</div><div>Onderkant kroon ${fmtM(t.kroonOnderkant, 1)} (aanname)</div>`;
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
    if (!hit) return select(null);
    if (hit.kind === 'building') select({ kind: 'building', id: hit.b.rec.id });
    else if (hit.kind === 'tree') select({ kind: 'tree', index: hit.index });
    else if (hit.kind === 'obstacle') select({ kind: 'obstacle', id: hit.o.id });
    else { const rd = frame.toRD(hit.point.x, hit.point.y, hit.point.z); select({ kind: 'terrain', x: rd.x, y: rd.y }); }
  });

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
    viewer.flyTo(c.clone().add(new THREE.Vector3(-55, 70, 75)), c);
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
  $('btnTop').onclick = () => viewer.topView();
  $('btnOblique').onclick = () => viewer.obliqueView();
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
    if (ctrl || ev.altKey) return;
    if (ev.key === 'Escape') { if (modalOpen()) closeModal(); else select(null); return; }
    if (ev.key === 'F1' || ev.key === '?') { ev.preventDefault(); openModal(helpContent()); return; }
    if (modalOpen()) return;
    if (key === 't') viewer.topView();
    else if (key === 'p') viewer.obliqueView();
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
function status(msg: string) {
  const el = $('stMsg');
  el.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (el.textContent = ''), 6000);
}

function renderWarnings(data: LoadedData) {
  const w = $('warnings');
  w.innerHTML = '';
  const failed = data.manifest.bronnen.filter((b) => b.status !== 'ok');
  for (const b of failed) w.append(h('div', { class: 'warnbox' }, `⚠ Bron niet beschikbaar: ${b.naam}. Draai "npm run data" opnieuw.`));
  w.append(h('div', { class: 'warnbox' }, '⚠ Perceelgrenzen: indicatieve grens (BRK) – nog geen ingemeten grens geïmporteerd.'));
}

start();
