/** Fase 6: alle tekenobjecten van het project verzamelen (RD) voor DXF, GeoJSON en legenda. */
import { ELEMENTS, footprint, totalHeight, type Element } from '../core/elements';
import type { ManualObject } from '../core/project';
import { gatePanels, panels } from '../core/polyline';
import { offsetSegment } from '../core/measure';
import type { Route } from '../vehicles/routes';
import type { Envelope } from '../vehicles/sweep';
import { carrierRect, hasOutriggers, loadRings, mobileRadius, outriggerPads, slewRadius, towerBase, type Crane } from '../cranes/cranes';
import type { DrawFeature } from './features';

export const STIJL = {
  doorrijhoogte: '#f57c00', paaltjes: '#c62828', hekwerk: '#263238', poort: '#ff9800', nietBerijdbaar: '#d32f2f', maatlijn: '#0d47a1',
  looproute: '#2e7d32', vluchtroute: '#00a152', vrijvlak: '#7e57c2', vrijelijn: '#5d4037', vergundeZone: '#6a1b9a',
  route: '#1e88e5', routeFout: '#e53935', rijlijn: '#1565c0', achteruit: '#7b1fa2', kraan: '#f57c00', contragiek: '#6d4c41', ring: '#e65100',
  grens: '#e65100', ontwerp: '#7b1fa2', gebouw: '#9e9e9e',
};
const LABEL: Record<ManualObject['soort'], string> = {
  doorrijhoogte: 'Vrije doorrijhoogte', paaltjes: 'Paaltjes', hekwerk: 'Bouwhekken', nietBerijdbaar: 'Niet berijdbaar', maatlijn: 'Maatlijnen',
  looproute: 'Looproute', vluchtroute: 'Vluchtroute', vrijvlak: 'Vrij vlak', vrijelijn: 'Vrije lijn', vergundeZone: 'Vergunde zone',
};
const nl = (v: number, d = 2) => v.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });

export interface CollectInput {
  elementen: Element[];
  handmatig: ManualObject[];
  routes: { r: Route; env: Envelope; uitvoerbaar: boolean; botsingen: number }[];
  kranen: Crane[];
  grens: { lijnen: number[][][]; bron: string } | null;
  ontwerp: number[][][] | null;
  /** Ondergrond (alleen DXF/GeoJSON): gebouwen en BGT. */
  ondergrond?: { gebouwen: { id: string; ring: number[][] }[]; bgt: { label: string; kleur: string; rings?: number[][][]; lines?: number[][][] }[] };
  /** Teksthoogte in m (1 mm op papier bij schaal 1:N → N/1000 m). */
  tekst?: number;
}

export function collectFeatures(inp: CollectInput): DrawFeature[] {
  const out: DrawFeature[] = [];
  const th = inp.tekst ?? 0.4;
  const text = (laag: string, groep: string, kleur: string, coord: number[], t: string, hoogte = th, rotatie = 0) =>
    out.push({ laag, groep, kleur, geom: { type: 'text', coord, text: t, hoogte, rotatie } });

  // ondergrond eerst (onderop)
  if (inp.ondergrond) {
    for (const b of inp.ondergrond.gebouwen) out.push({ laag: 'Ondergrond – gebouwen (BAG)', groep: 'Ondergrond', kleur: STIJL.gebouw, geom: { type: 'polygon', rings: [b.ring] }, props: { id: b.id } });
    for (const c of inp.ondergrond.bgt) {
      for (const r of c.rings ?? []) out.push({ laag: `Ondergrond – BGT ${c.label}`, groep: 'Ondergrond', kleur: c.kleur, geom: { type: 'polygon', rings: [r] } });
      for (const l of c.lines ?? []) out.push({ laag: `Ondergrond – BGT ${c.label}`, groep: 'Ondergrond', kleur: c.kleur, geom: { type: 'line', coords: l } });
    }
  }
  if (inp.grens) for (const l of inp.grens.lijnen) out.push({ laag: 'Perceelgrens', groep: 'Situatie', legenda: inp.grens.bron, kleur: STIJL.grens, stijl: 'stippel', geom: { type: 'line', coords: l } });
  if (inp.ontwerp) out.push({ laag: 'Nieuw pand (IFC)', groep: 'Situatie', legenda: 'Nieuw pand (buitencontour)', kleur: STIJL.ontwerp, geom: { type: 'polygon', rings: inp.ontwerp } });

  // bouwplaatselementen
  for (const e of inp.elementen) {
    const sp = ELEMENTS[e.type];
    const fp = footprint(e);
    out.push({ laag: `Bouwplaats – ${sp.label}`, groep: 'Bouwplaatselementen', kleur: e.kleur, geom: { type: 'polygon', rings: [[...fp, fp[0]]] },
      props: { naam: e.naam, type: e.type, lengte: e.lengte, breedte: e.breedte, hoogte: totalHeight(e), rotatie: e.rotatie, elementlaag: e.laag, soort: e.soort, label: e.label } });
    if (Math.min(e.lengte, e.breedte) >= 1.2) text('Teksten – elementen', 'Teksten', '#000000', [e.x, e.y], e.label || e.naam, Math.min(th, e.breedte * 0.35), e.lengte >= e.breedte ? e.rotatie : e.rotatie + 90);
  }

  // eigen objecten
  for (const m of inp.handmatig) {
    const kleur = STIJL[m.soort];
    const laag = `Eigen – ${LABEL[m.soort]}`, groep = 'Eigen objecten';
    const props = { naam: m.naam, soort: m.soort, vrijeHoogte: m.vrijeHoogte, hoogte: m.hoogte };
    if (m.soort === 'hekwerk') {
      const ps = panels(m.coords), gates = gatePanels(m.poorten ?? [], ps.length);
      for (const p of ps) {
        const poort = gates.has(p.index);
        out.push({ laag: poort ? 'Eigen – Poorten' : laag, groep, legenda: poort ? 'Poort in bouwhek' : 'Bouwhekken 3,50 × 2,00 m', kleur: poort ? STIJL.poort : kleur, geom: { type: 'line', coords: [p.a, p.b] }, props: { ...props, poort, lengte: p.lengte } });
      }
      continue;
    }
    if (m.soort === 'maatlijn') {
      for (let i = 1; i < m.coords.length; i++) {
        const a = m.coords[i - 1], b = m.coords[i];
        const [oa, ob] = offsetSegment(a, b, m.offset ?? 1);
        out.push({ laag, groep, legenda: 'Maatvoering', kleur, geom: { type: 'line', coords: [a, oa, ob, b] } });
        const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
        text('Teksten – maatvoering', 'Teksten', kleur, [(oa[0] + ob[0]) / 2, (oa[1] + ob[1]) / 2], `${nl(Math.hypot(b[0] - a[0], b[1] - a[1]))} m`, th, ((ang + 90) % 180) - 90);
      }
      continue;
    }
    if (m.geom === 'vlak' && m.coords.length >= 3) out.push({ laag, groep, kleur, geom: { type: 'polygon', rings: [[...m.coords, m.coords[0]]] }, props });
    else if (m.geom === 'lijn') out.push({ laag, groep, kleur, stijl: m.soort === 'looproute' || m.soort === 'vluchtroute' ? 'stippel' : 'lijn', geom: { type: 'line', coords: m.coords }, props });
    else for (const c of m.coords) out.push({ laag, groep, kleur, geom: { type: 'point', coord: c }, props });
    if (m.naam && m.coords.length) {
      const c = m.coords.reduce((s, q) => [s[0] + q[0] / m.coords.length, s[1] + q[1] / m.coords.length], [0, 0]);
      text('Teksten – eigen objecten', 'Teksten', kleur, c, m.soort === 'doorrijhoogte' ? `${m.naam} (vrij ${nl(m.vrijeHoogte ?? 4)} m)` : m.naam);
    }
  }

  // routes (swept path)
  for (const { r, env, uitvoerbaar, botsingen } of inp.routes) {
    const kleur = uitvoerbaar && !botsingen ? STIJL.route : STIJL.routeFout;
    const props = { route: r.naam, voertuig: r.voertuig.naam, uitvoerbaar, botsingen };
    for (const ring of env.rings) out.push({ laag: `Route – omhullende`, groep: 'Draai- en steekbewegingen', legenda: 'Omhullende (swept path)', kleur, geom: { type: 'polygon', rings: [ring] }, props });
    for (const l of r.legs) out.push({ laag: l.richting === 'vooruit' ? 'Route – rijlijn vooruit' : 'Route – rijlijn achteruit', groep: 'Draai- en steekbewegingen', legenda: l.richting === 'vooruit' ? 'Rijlijn vooruit (vooras)' : 'Rijlijn achteruit (steken)', kleur: l.richting === 'vooruit' ? STIJL.rijlijn : STIJL.achteruit, stijl: l.richting === 'vooruit' ? 'lijn' : 'stippel', geom: { type: 'line', coords: l.punten }, props });
    const p0 = r.legs[0]?.punten[0];
    if (p0) text('Teksten – routes', 'Teksten', STIJL.rijlijn, [p0[0], p0[1] - 2 * th], `${r.naam}${uitvoerbaar ? '' : ' – NIET UITVOERBAAR'}`);
  }

  // kranen
  for (const k of inp.kranen) {
    const R = slewRadius(k);
    const props = { kraan: k.naam, type: k.type, zwenkstraal: R, tabel: k.tabelBron };
    out.push({ laag: 'Kraan – zwenkcirkel giek', groep: 'Kranen', legenda: 'Zwenkcirkel giek', kleur: STIJL.kraan, stijl: 'cirkel', geom: { type: 'circle', center: [k.x, k.y], radius: R }, props });
    const tail = k.type === 'toren' ? k.contragiekLengte : k.staartStraal;
    out.push({ laag: 'Kraan – zwenkcirkel contragiek', groep: 'Kranen', legenda: k.type === 'toren' ? 'Zwenkcirkel contragiek / ballast' : 'Staartdraaicirkel', kleur: STIJL.contragiek, stijl: 'cirkel', geom: { type: 'circle', center: [k.x, k.y], radius: tail }, props });
    const la = (k.richting * Math.PI) / 180 + Math.PI / 4;
    for (const rr of loadRings(k)) {
      out.push({ laag: 'Kraan – draagvermogen', groep: 'Kranen', legenda: 'Draagvermogen-ring (radius · max. last)', kleur: STIJL.ring, stijl: 'cirkel', geom: { type: 'circle', center: [k.x, k.y], radius: rr.radius }, props: { ...props, radius: rr.radius, last: rr.last } });
      text('Teksten – kranen', 'Teksten', STIJL.ring, [k.x + rr.radius * Math.cos(la), k.y + rr.radius * Math.sin(la)], `${nl(rr.radius, 0)} m · ${nl(rr.last, rr.last < 10 ? 2 : 1)} t`);
    }
    if (hasOutriggers(k)) {
      out.push({ laag: 'Kraan – onderwagen', groep: 'Kranen', legenda: 'Onderwagen', kleur: '#ffb300', geom: { type: 'polygon', rings: [carrierRect(k)] }, props });
      for (const p of outriggerPads(k)) out.push({ laag: 'Kraan – stempelplaten', groep: 'Kranen', legenda: 'Stempelplaten', kleur: '#5d4037', geom: { type: 'polygon', rings: [p] }, props });
    } else if (k.type === 'toren') out.push({ laag: 'Kraan – voet', groep: 'Kranen', legenda: 'Kraanvoet / fundatie', kleur: '#757575', geom: { type: 'polygon', rings: [towerBase(k)] }, props });
    if (k.type === 'mobiel') out.push({ laag: 'Kraan – huidige radius', groep: 'Kranen', legenda: 'Radius bij ingestelde giekhoek', kleur: '#1565c0', stijl: 'cirkel', geom: { type: 'circle', center: [k.x, k.y], radius: mobileRadius(k) }, props });
    text('Teksten – kranen', 'Teksten', '#5d2a00', [k.x, k.y - 3 * th], k.naam, th * 1.3);
  }
  return out;
}
