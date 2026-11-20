/**
 * Terrein: AHN-maaiveld als mesh (per tegel) met een samengestelde textuur:
 * luchtfoto en/of BGT-vlakken, reliëfschaduw, hoogtekleuren, lijnen,
 * perceelgrenzen en labels. Alles 2D wordt op de textuur "gedrapeerd", zodat
 * het precies het maaiveld volgt.
 */
import * as THREE from 'three';
import type { BBox, LocalFrame } from '../core/coords';
import type { LayerState } from '../core/layers';
import { tileBBox } from '../core/tiles';
import { CLASS_STYLES, classify, putColor } from '../data/bgt';
import { bboxIntersects, linesOf, pointInPolygon, polygonsOf, ringsBBox } from '../data/geom';
import type { LoadedData } from '../data/loader';
import { sampleGrid } from '../data/terrain';

interface PolyItem {
  kind: 'poly';
  collection: string;
  cls: string;
  props: Record<string, any>;
  id: string;
  polys: number[][][][];
  bbox: BBox;
  level: number;
  order: number;
}
interface LineItem {
  kind: 'line';
  collection: string;
  cls: string;
  props: Record<string, any>;
  id: string;
  lines: number[][][];
  bbox: BBox;
  order: number;
}
interface PointItem {
  kind: 'point';
  collection: string;
  cls: string;
  props: Record<string, any>;
  id: string;
  x: number;
  y: number;
}

interface Chunk {
  bbox: BBox;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  mesh: THREE.Mesh;
  ortho?: HTMLImageElement;
  polys: PolyItem[];
  lines: LineItem[];
}

/** Hulpmiddelen voor extra 2D-lagen die op de terreintextuur tekenen. */
export interface DrawContext {
  ctx: CanvasRenderingContext2D;
  bb: BBox;
  /** Pixels per meter. */
  ppm: number;
  X: (x: number) => number;
  Y: (y: number) => number;
  ring: (r: number[][]) => void;
  path: (l: number[][]) => void;
  label: (txt: string, x: number, y: number, angleDeg: number, sizeM: number, fill: string, halo: string, bold?: boolean) => void;
}
export type CanvasOverlay = (c: DrawContext, L: LayerState) => void;

export interface Parcel {
  id: string;
  props: Record<string, any>;
  polys: number[][][][];
  bbox: BBox;
}

export const HYPSO_STOPS: [number, string][] = [
  [0, '#2c7bb6'], [0.25, '#00a6ca'], [0.45, '#90d18c'], [0.65, '#f9d057'], [0.85, '#f29e2e'], [1, '#a5502a'],
];

export class TerrainLayer {
  readonly group = new THREE.Group();
  readonly chunks: Chunk[] = [];
  readonly polys: PolyItem[] = [];
  readonly lines: LineItem[] = [];
  readonly points: PointItem[] = [];
  readonly parcels: Parcel[] = [];
  readonly parcelLines: number[][][] = [];
  hypsoRange = { min: 0, max: 1 };
  /** Buitencontour van het ontwerpmodel in RD (of null). */
  designContour: number[][][] | null = null;
  /** Extra 2D-lagen (KLIC, inmeting, DXF, eigen obstakels), getekend vóór de labels. */
  readonly overlays: CanvasOverlay[] = [];
  /** Eigen perceel (BRK) – geaccentueerd zolang er geen ingemeten grens is. */
  ownParcelRings: number[][][] = [];
  ownParcelHighlight = false;
  private hillCanvas: HTMLCanvasElement | null = null;
  private hypsoCanvas: HTMLCanvasElement | null = null;

  constructor(private readonly data: LoadedData, private readonly frame: LocalFrame) {
    this.indexFeatures();
    this.buildOverlays();
    this.buildChunks();
  }

  // ---------------------------------------------------------------- data-index
  private indexFeatures() {
    for (const [col, fc] of this.data.bgt) {
      for (const f of fc.features) {
        const cls = classify(col, f.properties);
        if (!cls || !CLASS_STYLES[cls]) continue;
        const st = CLASS_STYLES[cls];
        const g = f.geometry;
        if (g.type === 'Point') {
          this.points.push({ kind: 'point', collection: col, cls, props: f.properties, id: f.id, x: g.coordinates[0], y: g.coordinates[1] });
        } else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
          const polys = polygonsOf(g);
          if (st.fill || cls === 'pand_bgt')
            this.polys.push({
              kind: 'poly', collection: col, cls, props: f.properties, id: f.id, polys,
              bbox: ringsBBox(polys.flat()), level: Number(f.properties.relatieve_hoogteligging ?? 0), order: st.order,
            });
        } else {
          const lines = linesOf(g);
          this.lines.push({ kind: 'line', collection: col, cls, props: f.properties, id: f.id, lines, bbox: ringsBBox(lines), order: st.order });
        }
      }
    }
    this.polys.sort((a, b) => a.level - b.level || a.order - b.order);
    this.lines.sort((a, b) => a.order - b.order);
    for (const f of this.data.percelen?.features ?? []) {
      const polys = polygonsOf(f.geometry);
      this.parcels.push({ id: f.id, props: f.properties, polys, bbox: ringsBBox(polys.flat()) });
    }
    if (this.data.grenzen) for (const f of this.data.grenzen.features) this.parcelLines.push(...linesOf(f.geometry));
    else for (const p of this.parcels) this.parcelLines.push(...p.polys.flat());
  }

  // ---------------------------------------------------------------- reliëf/hoogtekleur
  private buildOverlays() {
    const t = this.data.terrain;
    if (!t) return;
    const { width: w, height: h, values, mask } = t;
    // hoogtebereik: 2e–98e percentiel van gemeten cellen
    const meas: number[] = [];
    for (let i = 0; i < values.length; i += 3) if (mask[i]) meas.push(values[i]);
    meas.sort((a, b) => a - b);
    const lo = meas[Math.floor(meas.length * 0.02)] ?? t.header.min;
    const hi = meas[Math.floor(meas.length * 0.98)] ?? t.header.max;
    this.hypsoRange = { min: Math.floor(lo * 10) / 10, max: Math.ceil(hi * 10) / 10 };

    const hill = document.createElement('canvas');
    hill.width = w; hill.height = h;
    const hc = hill.getContext('2d')!;
    const hid = hc.createImageData(w, h);
    const hyp = document.createElement('canvas');
    hyp.width = w; hyp.height = h;
    const yc = hyp.getContext('2d')!;
    const yid = yc.createImageData(w, h);
    const az = (315 * Math.PI) / 180, alt = (45 * Math.PI) / 180;
    const exag = 4; // reliëf overdreven (vlak terrein)
    const ramp = HYPSO_STOPS.map(([s, c]) => [s, new THREE.Color(c)] as const);
    const v = (r: number, c: number) => values[Math.min(h - 1, Math.max(0, r)) * w + Math.min(w - 1, Math.max(0, c))];
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++) {
        const dzdx = ((v(r, c + 1) - v(r, c - 1)) / (2 * t.res)) * exag;
        const dzdy = ((v(r - 1, c) - v(r + 1, c)) / (2 * t.res)) * exag;
        const slope = Math.atan(Math.hypot(dzdx, dzdy));
        const aspect = Math.atan2(dzdy, -dzdx);
        let shade = Math.sin(alt) * Math.cos(slope) + Math.cos(alt) * Math.sin(slope) * Math.cos(az - aspect);
        shade = Math.max(0, Math.min(1, shade));
        const g = Math.round(150 + 105 * shade);
        const i = (r * w + c) * 4;
        hid.data[i] = hid.data[i + 1] = hid.data[i + 2] = g;
        hid.data[i + 3] = 255;
        const s = Math.max(0, Math.min(1, (values[r * w + c] - lo) / Math.max(0.01, hi - lo)));
        let k = 0;
        while (k < ramp.length - 2 && s > ramp[k + 1][0]) k++;
        const [s0, c0] = ramp[k], [s1, c1] = ramp[k + 1];
        const tt = (s - s0) / (s1 - s0);
        yid.data[i] = Math.round((c0.r + (c1.r - c0.r) * tt) * 255);
        yid.data[i + 1] = Math.round((c0.g + (c1.g - c0.g) * tt) * 255);
        yid.data[i + 2] = Math.round((c0.b + (c1.b - c0.b) * tt) * 255);
        yid.data[i + 3] = mask[r * w + c] ? 255 : 150; // geïnterpoleerd = lichter
      }
    hc.putImageData(hid, 0, 0);
    yc.putImageData(yid, 0, 0);
    this.hillCanvas = hill;
    this.hypsoCanvas = hyp;
  }

  // ---------------------------------------------------------------- mesh
  private buildChunks() {
    const m = this.data.manifest;
    const { nx, ny } = m.tegels;
    const t = this.data.terrain;
    const orthoByRC = new Map<string, HTMLImageElement>();
    if (this.data.ortho) for (const tile of this.data.ortho.index.tiles) {
      const im = this.data.ortho.images.get(tile.file);
      if (im) orthoByRC.set(`${tile.row}_${tile.col}`, im);
    }
    for (let row = 0; row < ny; row++)
      for (let col = 0; col < nx; col++) {
        const bb = tileBBox(m.bbox, nx, ny, row, col);
        const ortho = orthoByRC.get(`${row}_${col}`);
        const canvas = document.createElement('canvas');
        const ppm = ortho ? ortho.width / (bb.xmax - bb.xmin) : 12;
        canvas.width = Math.round((bb.xmax - bb.xmin) * ppm);
        canvas.height = Math.round((bb.ymax - bb.ymin) * ppm);
        const ctx = canvas.getContext('2d')!;
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        const geom = t ? this.chunkGeometry(bb) : this.flatGeometry(bb);
        const mat = new THREE.MeshBasicMaterial({ map: texture });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.name = `terrein_${row}_${col}`;
        mesh.userData.kind = 'terrain';
        this.group.add(mesh);
        this.chunks.push({
          bbox: bb, canvas, ctx, texture, mesh, ortho,
          polys: this.polys.filter((p) => bboxIntersects(p.bbox, bb)),
          lines: this.lines.filter((l) => bboxIntersects(l.bbox, bb)),
        });
      }
  }

  private chunkGeometry(bb: BBox): THREE.BufferGeometry {
    const t = this.data.terrain!;
    const c0 = Math.max(0, Math.round((bb.xmin - t.x0) / t.res));
    const c1 = Math.min(t.width - 1, Math.round((bb.xmax - t.x0) / t.res));
    const r0 = Math.max(0, Math.round((t.y0 - bb.ymax) / t.res));
    const r1 = Math.min(t.height - 1, Math.round((t.y0 - bb.ymin) / t.res));
    const nc = c1 - c0 + 1, nr = r1 - r0 + 1;
    const pos = new Float32Array(nc * nr * 3);
    const uv = new Float32Array(nc * nr * 2);
    const tw = bb.xmax - bb.xmin, th = bb.ymax - bb.ymin;
    for (let r = 0; r < nr; r++)
      for (let c = 0; c < nc; c++) {
        // randen van de tegel exact op de tegelgrens leggen (naadloos)
        let x = t.x0 + (c0 + c) * t.res;
        let y = t.y0 - (r0 + r) * t.res;
        if (c === 0) x = bb.xmin; else if (c === nc - 1) x = bb.xmax;
        if (r === 0) y = bb.ymax; else if (r === nr - 1) y = bb.ymin;
        const hgt = sampleGrid(t, x, y) ?? 0;
        const L = this.frame.toLocal(x, y, hgt);
        const i = r * nc + c;
        pos[i * 3] = L.x; pos[i * 3 + 1] = L.y; pos[i * 3 + 2] = L.z;
        uv[i * 2] = (x - bb.xmin) / tw;
        uv[i * 2 + 1] = (y - bb.ymin) / th;
      }
    const idx: number[] = [];
    for (let r = 0; r < nr - 1; r++)
      for (let c = 0; c < nc - 1; c++) {
        const a = r * nc + c, b = a + 1, d = a + nc, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  private flatGeometry(bb: BBox): THREE.BufferGeometry {
    const g = new THREE.PlaneGeometry(bb.xmax - bb.xmin, bb.ymax - bb.ymin);
    g.rotateX(-Math.PI / 2);
    const c = this.frame.toLocal((bb.xmin + bb.xmax) / 2, (bb.ymin + bb.ymax) / 2, 0);
    g.translate(c.x, 0, c.z);
    return g;
  }

  // ---------------------------------------------------------------- tekenen
  redraw(L: LayerState) {
    for (const ch of this.chunks) this.drawChunk(ch, L);
  }

  private drawChunk(ch: Chunk, L: LayerState) {
    const { ctx, canvas, bbox: bb } = ch;
    const W = canvas.width, H = canvas.height;
    const ppm = W / (bb.xmax - bb.xmin);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const plan = L.plattegrond;
    const photo = !plan && L.luchtfoto && ch.ortho;
    if (photo) ctx.drawImage(ch.ortho!, 0, 0, W, H);
    else { ctx.fillStyle = plan ? '#ffffff' : '#efeee9'; ctx.fillRect(0, 0, W, H); }

    const t = this.data.terrain;
    const gridSrc = (cv: HTMLCanvasElement) => {
      if (!t) return;
      const sx = (bb.xmin - (t.x0 - t.res / 2)) / t.res;
      const sy = ((t.y0 + t.res / 2) - bb.ymax) / t.res;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(cv, sx, sy, (bb.xmax - bb.xmin) / t.res, (bb.ymax - bb.ymin) / t.res, 0, 0, W, H);
    };

    // wereld (RD) → pixel
    const X = (x: number) => (x - bb.xmin) * ppm;
    const Y = (y: number) => (bb.ymax - y) * ppm;
    const ring = (r: number[][]) => {
      ctx.moveTo(X(r[0][0]), Y(r[0][1]));
      for (let i = 1; i < r.length; i++) ctx.lineTo(X(r[i][0]), Y(r[i][1]));
      ctx.closePath();
    };
    const path = (l: number[][]) => {
      ctx.moveTo(X(l[0][0]), Y(l[0][1]));
      for (let i = 1; i < l.length; i++) ctx.lineTo(X(l[i][0]), Y(l[i][1]));
    };

    if (L.bgt && !plan) {
      ctx.globalAlpha = photo ? L.bgtDekking : 1;
      for (const p of ch.polys) {
        if (!L.bgtKlassen[p.cls]) continue;
        const st = CLASS_STYLES[p.cls];
        if (!st.fill) continue;
        ctx.beginPath();
        for (const poly of p.polys) for (const r of poly) ring(r);
        ctx.fillStyle = st.fill;
        ctx.fill('evenodd');
      }
      ctx.globalAlpha = photo ? Math.min(1, L.bgtDekking + 0.35) : 1;
      for (const p of ch.polys) {
        if (!L.bgtKlassen[p.cls]) continue;
        const st = CLASS_STYLES[p.cls];
        if (!st.stroke) continue;
        ctx.beginPath();
        for (const poly of p.polys) for (const r of poly) ring(r);
        ctx.strokeStyle = st.stroke;
        ctx.lineWidth = Math.max(1, (st.width ?? 0.1) * ppm);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // hoogtekleur over luchtfoto/BGT heen (half transparant), zodat de ondergrond herkenbaar blijft
    if (!plan && L.hoogtekleur && this.hypsoCanvas) {
      ctx.globalAlpha = photo || L.bgt ? 0.7 : 1;
      gridSrc(this.hypsoCanvas);
      ctx.globalAlpha = 1;
    }

    if (!plan && L.relief && this.hillCanvas) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = photo ? 0.5 : 0.9;
      gridSrc(this.hillCanvas);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    if (plan) {
      // plattegrond: gebouwomtrekken (BGT-pand) zoals op de kadasterkaart
      ctx.beginPath();
      for (const p of ch.polys) if (p.cls === 'pand_bgt') for (const poly of p.polys) for (const r of poly) ring(r);
      ctx.fillStyle = '#f6eadb';
      ctx.fill('evenodd');
      ctx.strokeStyle = '#9c6b3c';
      ctx.lineWidth = Math.max(1, 0.1 * ppm);
      ctx.stroke();
    }
    if (L.bgt && !plan) {
      for (const l of ch.lines) {
        if (!L.bgtKlassen[l.cls]) continue;
        const st = CLASS_STYLES[l.cls];
        ctx.beginPath();
        for (const ln of l.lines) path(ln);
        ctx.strokeStyle = st.stroke ?? '#444';
        ctx.lineWidth = Math.max(1, (st.width ?? 0.1) * ppm);
        ctx.setLineDash(st.dash ? st.dash.map((d) => d * ppm) : []);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      if (L.bgtKlassen.put) {
        for (const p of this.points) {
          if (p.cls !== 'put' || p.x < bb.xmin - 1 || p.x > bb.xmax + 1 || p.y < bb.ymin - 1 || p.y > bb.ymax + 1) continue;
          ctx.beginPath();
          ctx.arc(X(p.x), Y(p.y), 0.3 * ppm, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffffcc';
          ctx.fill();
          ctx.lineWidth = Math.max(1, 0.07 * ppm);
          ctx.strokeStyle = putColor(p.props);
          ctx.stroke();
        }
      }
    }

    if (L.projectgebied) {
      const k = this.data.manifest.kernpunten;
      ctx.beginPath();
      ring(k.map((p) => [p.x, p.y]));
      ctx.strokeStyle = '#1565c0';
      ctx.lineWidth = Math.max(2, 0.35 * ppm);
      ctx.setLineDash([1.5 * ppm, 0.8 * ppm]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (L.ontwerpContour && this.designContour) {
      ctx.beginPath();
      for (const r of this.designContour) ring(r);
      ctx.strokeStyle = '#ffffffcc';
      ctx.lineWidth = Math.max(4, 0.55 * ppm);
      ctx.stroke();
      ctx.strokeStyle = '#7b1fa2';
      ctx.lineWidth = Math.max(2, 0.28 * ppm);
      ctx.stroke();
    }

    if (plan) {
      ctx.beginPath();
      for (const l of this.parcelLines) path(l);
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = Math.max(1.5, 0.12 * ppm);
      ctx.stroke();
    } else if (L.percelen) {
      ctx.beginPath();
      for (const l of this.parcelLines) path(l);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, 0.3 * ppm);
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#c2185b';
      ctx.lineWidth = Math.max(1, 0.14 * ppm);
      ctx.stroke();
    }

    // labels
    const label = (txt: string, x: number, y: number, angleDeg: number, sizeM: number, fill: string, halo: string, bold = false) => {
      if (x < bb.xmin - 30 || x > bb.xmax + 30 || y < bb.ymin - 30 || y > bb.ymax + 30) return;
      let a = ((angleDeg % 360) + 360) % 360;
      if (a > 90 && a < 270) a -= 180;
      ctx.save();
      ctx.translate(X(x), Y(y));
      ctx.rotate((-a * Math.PI) / 180);
      ctx.font = `${bold ? '600 ' : ''}${Math.round(sizeM * ppm)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, sizeM * ppm * 0.22);
      ctx.strokeStyle = halo;
      ctx.lineJoin = 'round';
      ctx.strokeText(txt, 0, 0);
      ctx.fillStyle = fill;
      ctx.fillText(txt, 0, 0);
      ctx.restore();
    };
    if ((L.percelen || plan) && L.eigenPerceel && this.ownParcelHighlight && this.ownParcelRings.length) {
      ctx.beginPath();
      for (const r of this.ownParcelRings) ring(r);
      ctx.strokeStyle = '#c2185b';
      ctx.lineWidth = Math.max(3, 0.45 * ppm);
      ctx.setLineDash([2 * ppm, 1 * ppm]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const o of this.overlays) {
      ctx.save();
      try { o({ ctx, bb, ppm, X, Y, ring, path, label }, L); } catch (e) { console.error('Fout in kaartlaag:', e); }
      ctx.restore();
    }
    if (plan || (L.percelen && L.perceelnummers)) {
      for (const p of this.parcels) {
        const pr = p.props;
        const x = pr.perceelnummer_plaatscoordinaat_x, y = pr.perceelnummer_plaatscoordinaat_y;
        if (x == null) continue;
        label(plan ? String(pr.perceelnummer ?? '') : `${pr.sectie ?? ''} ${pr.perceelnummer ?? ''}`.trim(), x, y, pr.perceelnummer_rotatie ?? 0, plan ? 1.3 : 1.1, plan ? '#1a1a1a' : '#8e0f45', '#ffffffdd', plan);
      }
    }
    if (L.bgt || plan) {
      for (const p of this.points) {
        if (p.cls === 'straatnaam' && (plan || L.bgtKlassen.straatnaam) && p.props.openbareruimtenaam)
          label(p.props.openbareruimtenaam, p.x, p.y, p.props.hoek ?? 0, 2.4, plan ? '#0d47a1' : '#1d1d1d', '#ffffffee', true);
        if (p.cls === 'huisnummer' && (plan || L.bgtKlassen.huisnummer) && p.props.tekst)
          label(String(p.props.tekst), p.x, p.y, p.props.hoek ?? 0, 1.0, '#3b2a1a', '#ffffffcc');
      }
    }
    ch.texture.needsUpdate = true;
  }

  // ---------------------------------------------------------------- bevragen
  /** Maaiveldhoogte (m NAP) op RD-positie. */
  heightAt(x: number, y: number): number | null {
    return this.data.terrain ? sampleGrid(this.data.terrain, x, y) : 0;
  }

  /** Is het maaiveld hier gemeten (true) of geïnterpoleerd (false)? */
  measuredAt(x: number, y: number): boolean | null {
    const t = this.data.terrain;
    if (!t) return null;
    const c = Math.round((x - t.x0) / t.res), r = Math.round((t.y0 - y) / t.res);
    if (c < 0 || r < 0 || c >= t.width || r >= t.height) return null;
    return t.mask[r * t.width + c] === 1;
  }

  /** Bovenste BGT-vlak op een punt (respecteert de laag-instellingen). */
  bgtAt(x: number, y: number, L: LayerState): PolyItem | null {
    for (let i = this.polys.length - 1; i >= 0; i--) {
      const p = this.polys[i];
      if (p.cls === 'pand_bgt' || !L.bgtKlassen[p.cls]) continue;
      if (x < p.bbox.xmin || x > p.bbox.xmax || y < p.bbox.ymin || y > p.bbox.ymax) continue;
      if (p.polys.some((poly) => pointInPolygon(x, y, poly))) return p;
    }
    return null;
  }

  parcelAt(x: number, y: number): Parcel | null {
    for (const p of this.parcels) {
      if (x < p.bbox.xmin || x > p.bbox.xmax || y < p.bbox.ymin || y > p.bbox.ymax) continue;
      if (p.polys.some((poly) => pointInPolygon(x, y, poly))) return p;
    }
    return null;
  }

  /**
   * Snijpunt van een (lokale) straal met het terrein via ray-marching over het
   * hoogteraster (veel sneller dan driehoeken raycasten).
   */
  intersectRay(ray: THREE.Ray, maxDist = 3000): THREE.Vector3 | null {
    const m = this.data.manifest.bbox;
    const p = new THREE.Vector3();
    let prevAbove = true;
    let prevT = 0;
    const step = 0.5;
    const h = (v: THREE.Vector3) => {
      const rd = this.frame.toRD(v.x, v.y, v.z);
      if (rd.x < m.xmin || rd.x > m.xmax || rd.y < m.ymin || rd.y > m.ymax) return null;
      return this.heightAt(rd.x, rd.y);
    };
    // begin waar de straal het hoogtebereik binnenkomt
    const top = (this.data.terrain?.header.max ?? 0) + 1;
    let t0 = 0;
    if (ray.origin.y > top && ray.direction.y < 0) t0 = (ray.origin.y - top) / -ray.direction.y;
    for (let t = t0; t < maxDist; t += step * (1 + t / 400)) {
      ray.at(t, p);
      const g = h(p);
      if (g == null) { if (p.y < (this.data.terrain?.header.min ?? 0) - 5) return null; prevT = t; continue; }
      const above = p.y >= g;
      if (!above && prevAbove) {
        // verfijn met bisectie
        let a = prevT, b = t;
        for (let k = 0; k < 20; k++) {
          const mid = (a + b) / 2;
          ray.at(mid, p);
          const gm = h(p);
          if (gm != null && p.y >= gm) a = mid; else b = mid;
        }
        ray.at((a + b) / 2, p);
        return p.clone();
      }
      prevAbove = above;
      prevT = t;
    }
    return null;
  }
}
