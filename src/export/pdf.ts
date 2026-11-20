/**
 * Fase 6: PDF-bouwplaatstekening (A3/A1 liggend) met kaart op schaal, titelblok,
 * legenda, noordpijl, schaalbalk en disclaimer.
 */
import { jsPDF } from 'jspdf';
import type { LegendItem } from './features';

export type Papier = 'A3' | 'A1';
export const PAPIER: Record<Papier, [number, number]> = { A3: [420, 297], A1: [841, 594] };
export const SCHALEN = [100, 200, 250, 500] as const;

export interface Rect { x: number; y: number; w: number; h: number }
export interface Layout { blad: [number, number]; kader: Rect; kaart: Rect; kolom: Rect; titel: Rect }

/** Indeling van het blad (mm): kaart links, kolom met legenda en titelblok rechts. */
export function layout(p: Papier): Layout {
  const [W, H] = PAPIER[p];
  const mL = p === 'A3' ? 20 : 25, m = 10; // linkermarge voor inbinden
  const kader = { x: mL, y: m, w: W - mL - m, h: H - 2 * m };
  const kolW = p === 'A3' ? 85 : 120;
  const kolom = { x: kader.x + kader.w - kolW, y: kader.y, w: kolW, h: kader.h };
  const kaart = { x: kader.x, y: kader.y, w: kader.w - kolW, h: kader.h };
  const titelH = p === 'A3' ? 92 : 120;
  const titel = { x: kolom.x, y: kolom.y + kolom.h - titelH, w: kolW, h: titelH };
  return { blad: [W, H], kader, kaart, kolom, titel };
}

/** Afmeting van het kaartvlak in de werkelijkheid (m). */
export function kaartMeters(p: Papier, schaal: number): { w: number; h: number } {
  const k = layout(p).kaart;
  return { w: (k.w * schaal) / 1000, h: (k.h * schaal) / 1000 };
}

/** Mooie schaalbalklengte (m) die ongeveer in `maxMm` past. */
export function schaalbalk(schaal: number, maxMm: number): { meters: number; mm: number; delen: number } {
  const maxM = (maxMm * schaal) / 1000;
  const p = 10 ** Math.floor(Math.log10(maxM));
  const meters = [5, 2, 1].map((f) => f * p).find((v) => v <= maxM) ?? p;
  const delen = String(meters / p).startsWith('5') ? 5 : String(meters / p).startsWith('2') ? 4 : 5;
  return { meters, mm: (meters * 1000) / schaal, delen };
}

export interface TitelBlok {
  project: string; nummer: string; onderdeel: string; fase: string; datum: string; getekendDoor: string; status: string;
}
export interface PdfInput {
  papier: Papier;
  schaal: number;
  kaart: { dataUrl: string; formaat: 'JPEG' | 'PNG' };
  titel: TitelBlok;
  legenda: LegendItem[];
  ondergrond: string;
  bronnen: string[];
  disclaimer: string;
  middenRD: [number, number];
}

/** Alleen tekens die de standaard PDF-lettertypen (WinAnsi) kennen. */
export const pdfTekst = (s: string) => s
  .replace(/≈/g, '~').replace(/[⚠✖]/g, '!').replace(/✔/g, 'v').replace(/[→⇒]/g, '->').replace(/·/g, '-')
  .normalize('NFC').replace(/[^\x20-\x7e -ÿ–—‘’“”€×]/g, '');

export function makePdf(o: PdfInput): jsPDF {
  const L = layout(o.papier);
  const [W, H] = L.blad;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [W, H], compress: true });
  const T = (s: string) => pdfTekst(s);
  const big = o.papier === 'A1' ? 1.35 : 1;
  doc.setProperties({ title: T(`${o.titel.project} – ${o.titel.onderdeel}`), subject: 'Bouwplaatsinrichting', creator: 'Bouwplaatsinrichting (indicatief)' });

  // kaart
  doc.addImage(o.kaart.dataUrl, o.kaart.formaat, L.kaart.x, L.kaart.y, L.kaart.w, L.kaart.h, undefined, 'FAST');
  // kaders
  doc.setDrawColor(0); doc.setLineWidth(0.5);
  doc.rect(L.kader.x, L.kader.y, L.kader.w, L.kader.h);
  doc.setLineWidth(0.35);
  doc.line(L.kolom.x, L.kolom.y, L.kolom.x, L.kolom.y + L.kolom.h);
  doc.setFillColor(255, 255, 255);
  doc.rect(L.kolom.x, L.kolom.y, L.kolom.w, L.kolom.h, 'F');
  doc.line(L.kolom.x, L.kolom.y, L.kolom.x, L.kolom.y + L.kolom.h);

  const x0 = L.kolom.x + 4, w0 = L.kolom.w - 8;
  let y = L.kolom.y + 7 * big;
  // legenda
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11 * big); doc.text('LEGENDA', x0, y);
  y += 5 * big;
  const ruimteLegenda = L.titel.y - 46 * big;
  let groep = '';
  doc.setFontSize(7.5 * big);
  const hex = (c: string) => { const n = parseInt(c.replace('#', '').slice(0, 6), 16); return [n >> 16, (n >> 8) & 255, n & 255] as [number, number, number]; };
  let afgekapt = 0;
  for (const it of o.legenda) {
    if (y > ruimteLegenda) { afgekapt++; continue; }
    if (it.groep !== groep) {
      groep = it.groep;
      y += 1.2 * big;
      doc.setFont('helvetica', 'bold'); doc.setTextColor(60); doc.text(T(groep), x0, y);
      y += 3.6 * big;
    }
    const [r, g, b] = hex(it.kleur);
    doc.setDrawColor(r, g, b); doc.setFillColor(r, g, b); doc.setLineWidth(0.5);
    const sx = x0, sy = y - 2.4 * big, sw = 7 * big, sh = 3 * big;
    if (it.stijl === 'vlak') { doc.setFillColor(Math.round(r * 0.5 + 127), Math.round(g * 0.5 + 127), Math.round(b * 0.5 + 127)); doc.rect(sx, sy, sw, sh, 'FD'); }
    else if (it.stijl === 'cirkel') { doc.circle(sx + sw / 2, sy + sh / 2, sh / 2, 'S'); }
    else if (it.stijl === 'punt') { doc.circle(sx + sw / 2, sy + sh / 2, 0.8 * big, 'F'); }
    else { if (it.stijl === 'stippel') doc.setLineDashPattern([1, 0.8], 0); doc.line(sx, sy + sh / 2, sx + sw, sy + sh / 2); doc.setLineDashPattern([], 0); }
    doc.setFont('helvetica', 'normal'); doc.setTextColor(0);
    doc.text(T(it.tekst), sx + sw + 2.5, y, { maxWidth: w0 - sw - 3 });
    y += 4 * big;
  }
  if (afgekapt) { doc.setFont('helvetica', 'italic'); doc.text(`… en ${afgekapt} meer`, x0, Math.min(y, ruimteLegenda + 4)); }
  doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5 * big); doc.setTextColor(80);
  doc.text(T(`Ondergrond: ${o.ondergrond}`), x0, Math.min(y + 2 * big, ruimteLegenda + 4 * big), { maxWidth: w0 });

  // noordpijl en schaalbalk
  const ny = L.titel.y - 16 * big;
  const nx = x0 + 8 * big;
  doc.setDrawColor(0); doc.setFillColor(0, 0, 0); doc.setLineWidth(0.3);
  doc.triangle(nx, ny - 9 * big, nx - 3.2 * big, ny + 3 * big, nx, ny, 'F');
  doc.setFillColor(255, 255, 255);
  doc.triangle(nx, ny - 9 * big, nx + 3.2 * big, ny + 3 * big, nx, ny, 'FD');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10 * big); doc.setTextColor(0);
  doc.text('N', nx, ny - 10.5 * big, { align: 'center' });
  const sb = schaalbalk(o.schaal, w0 - 26 * big);
  const bx = x0 + 20 * big, by = ny - 2 * big, bh = 2.2 * big;
  for (let i = 0; i < sb.delen; i++) {
    const seg = sb.mm / sb.delen;
    doc.setFillColor(i % 2 ? 255 : 0, i % 2 ? 255 : 0, i % 2 ? 255 : 0);
    doc.rect(bx + i * seg, by, seg, bh, 'FD');
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7 * big);
  doc.text('0', bx, by + bh + 3.5 * big, { align: 'center' });
  doc.text(`${sb.meters.toLocaleString('nl-NL')} m`, bx + sb.mm, by + bh + 3.5 * big, { align: 'center' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10 * big);
  doc.text(`Schaal 1:${o.schaal}  (${o.papier})`, bx, by - 3 * big);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6 * big); doc.setTextColor(90);
  doc.text(T(`Midden kaart RD ${o.middenRD[0].toFixed(1)} ; ${o.middenRD[1].toFixed(1)} (EPSG:28992)`), bx, by + bh + 7.5 * big);

  // titelblok
  const t = L.titel;
  doc.setTextColor(0); doc.setDrawColor(0); doc.setLineWidth(0.35);
  doc.line(t.x, t.y, t.x + t.w, t.y);
  const rijen: [string, string][] = [
    ['Project', o.titel.project], ['Projectnummer', o.titel.nummer], ['Onderdeel', o.titel.onderdeel], ['Bouwfase', o.titel.fase],
    ['Schaal', `1:${o.schaal} (${o.papier})`], ['Datum', o.titel.datum], ['Getekend door', o.titel.getekendDoor], ['Status', o.titel.status],
  ];
  const rh = 6.2 * big;
  let ty = t.y;
  for (const [k, v] of rijen) {
    doc.line(t.x, ty + rh, t.x + t.w, ty + rh);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5 * big); doc.setTextColor(90);
    doc.text(k, t.x + 2, ty + 2.6 * big);
    doc.setFont('helvetica', k === 'Project' ? 'bold' : 'normal'); doc.setFontSize((k === 'Project' ? 9.5 : 8.5) * big); doc.setTextColor(0);
    doc.text(T(v || '–'), t.x + 2, ty + 5.6 * big, { maxWidth: t.w - 4 });
    ty += rh;
  }
  doc.setFontSize(5.6 * big); doc.setTextColor(70); doc.setFont('helvetica', 'normal');
  const disc = doc.splitTextToSize(T(`${o.disclaimer} Bronnen: ${o.bronnen.join('; ')}.`), t.w - 4);
  doc.text(disc, t.x + 2, ty + 3.2 * big);
  return doc;
}
