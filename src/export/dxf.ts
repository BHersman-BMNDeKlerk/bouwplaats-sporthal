/**
 * DXF-export (AutoCAD R12 / AC1009, ASCII): breed leesbaar in AutoCAD,
 * BricsCAD, QGIS e.d. Coördinaten in RD (m), hoogte 0. Eén laag per soort.
 */
import type { DrawFeature } from './features';

/** AutoCAD-kleurindex (ACI) die het dichtst bij een hex-kleur ligt (basis + grijzen). */
const ACI: [number, number, number, number][] = [
  [1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255], [5, 0, 0, 255], [6, 255, 0, 255], [7, 0, 0, 0],
  [8, 128, 128, 128], [9, 192, 192, 192], [30, 255, 127, 0], [40, 255, 191, 0], [34, 165, 82, 0], [94, 0, 127, 0],
  [150, 0, 127, 255], [174, 0, 63, 127], [200, 127, 0, 255], [230, 255, 0, 127], [250, 51, 51, 51], [252, 130, 130, 130], [254, 190, 190, 190],
];
export function aciFromHex(hex: string): number {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return 7;
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  let best = 7, bd = Infinity;
  for (const [i, R, G, B] of ACI) { const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}

/** Laagnaam geschikt voor R12 (hoofdletters, cijfers, _ en -; max. 31 tekens). */
export function dxfLayerName(s: string): string {
  const t = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return (t || '0').slice(0, 31);
}

const f = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3);

export function toDxf(features: DrawFeature[], kop: { titel: string }): string {
  const out: string[] = [];
  const g = (code: number, val: string | number) => { out.push(String(code), typeof val === 'number' ? String(val) : val); };
  const layers = new Map<string, number>();
  for (const ft of features) { const n = dxfLayerName(ft.laag); if (!layers.has(n)) layers.set(n, aciFromHex(ft.kleur)); }
  // extents
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  const ext = (p: number[]) => { xmin = Math.min(xmin, p[0]); ymin = Math.min(ymin, p[1]); xmax = Math.max(xmax, p[0]); ymax = Math.max(ymax, p[1]); };
  for (const ft of features) {
    const gm = ft.geom;
    if (gm.type === 'polygon') gm.rings.forEach((r) => r.forEach(ext));
    else if (gm.type === 'line') gm.coords.forEach(ext);
    else if (gm.type === 'circle') { ext([gm.center[0] - gm.radius, gm.center[1] - gm.radius]); ext([gm.center[0] + gm.radius, gm.center[1] + gm.radius]); }
    else ext(gm.coord);
  }
  if (!Number.isFinite(xmin)) { xmin = ymin = 0; xmax = ymax = 1; }
  // HEADER
  g(999, `${kop.titel} – RD New (EPSG:28992), eenheden meter`);
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSUNITS'); g(70, 6);
  g(9, '$EXTMIN'); g(10, f(xmin)); g(20, f(ymin)); g(30, '0.0');
  g(9, '$EXTMAX'); g(10, f(xmax)); g(20, f(ymax)); g(30, '0.0');
  g(0, 'ENDSEC');
  // TABLES
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, '0.0');
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.size + 1);
  g(0, 'LAYER'); g(2, '0'); g(70, 0); g(62, 7); g(6, 'CONTINUOUS');
  for (const [n, c] of layers) { g(0, 'LAYER'); g(2, n); g(70, 0); g(62, c); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  // ENTITIES
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const poly = (layer: string, pts: number[][], closed: boolean) => {
    if (pts.length < 2) return;
    let p = pts;
    if (closed && p.length > 2 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) p = p.slice(0, -1);
    g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(10, '0.0'); g(20, '0.0'); g(30, '0.0'); g(70, closed ? 1 : 0);
    for (const q of p) { g(0, 'VERTEX'); g(8, layer); g(10, f(q[0])); g(20, f(q[1])); g(30, '0.0'); }
    g(0, 'SEQEND'); g(8, layer);
  };
  for (const ft of features) {
    const L = dxfLayerName(ft.laag), gm = ft.geom;
    if (gm.type === 'polygon') gm.rings.forEach((r) => poly(L, r, true));
    else if (gm.type === 'line') poly(L, gm.coords, false);
    else if (gm.type === 'circle') { g(0, 'CIRCLE'); g(8, L); g(10, f(gm.center[0])); g(20, f(gm.center[1])); g(30, '0.0'); g(40, f(gm.radius)); }
    else if (gm.type === 'point') { g(0, 'POINT'); g(8, L); g(10, f(gm.coord[0])); g(20, f(gm.coord[1])); g(30, '0.0'); }
    else if (gm.type === 'text') {
      g(0, 'TEXT'); g(8, L); g(10, f(gm.coord[0])); g(20, f(gm.coord[1])); g(30, '0.0'); g(40, f(gm.hoogte));
      g(1, gm.text.replace(/[\r\n]+/g, ' ').normalize('NFC').replace(/[^\x20-\x7e -ÿ]/g, '?'));
      if (gm.rotatie) g(50, f(gm.rotatie));
      g(72, 1); g(11, f(gm.coord[0])); g(21, f(gm.coord[1])); g(31, '0.0'); g(73, 2);
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}
