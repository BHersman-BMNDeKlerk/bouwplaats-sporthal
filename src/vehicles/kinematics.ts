/**
 * Kinematische simulatie van een voertuig (fietsmodel) met optionele oplegger
 * langs een getekende route (fase 4).
 *
 * Toestand (RD-vlak, x = oost, y = noord, hoeken tegen de klok in vanaf oost):
 *  - (x, y): midden achteras (trekker / star voertuig)
 *  - θ: rijrichting voertuig, φ: richting oplegger (as kingpin → achteras omgekeerd)
 *  - δ: stuurhoek vooras
 * Per stap ds (booglengte achteras; negatief bij achteruit):
 *  dx = cos θ ds, dy = sin θ ds, dθ = tan δ / L · ds
 *  dφ = (sin(θ−φ) + k·tan δ/L·cos(θ−φ)) / Lt · ds     (k = koppelpunt vóór achteras)
 *
 * Besturing:
 *  - vooruit: Stanley-regelaar op de vooras (de bestuurder stuurt de neus over de lijn);
 *  - achteruit, star: pure pursuit op de achteras;
 *  - achteruit, oplegger: pure pursuit op de achteras van de oplegger → gewenste
 *    knikhoek → stuurhoek trekker (cascaderegeling).
 * De stuurhoek is begrensd (max. uitslag) en de verandering per meter ook
 * (stuursnelheid °/s gedeeld door de manoeuvresnelheid).
 */
import { VehicleSpec, effectiveMaxSteer, rad } from './vehicles';

export type Richting = 'vooruit' | 'achteruit';
export interface Leg { richting: Richting; punten: [number, number][] }

export interface Pose { x: number; y: number; theta: number; phi: number; delta: number }
export interface Sample extends Pose {
  /** Afgelegde weg (m, absoluut, cumulatief over alle delen). */
  s: number;
  leg: number;
  /** Afwijking van het referentiepunt t.o.v. de getekende lijn (m). */
  afwijking: number;
  /** Stuurhoek aan de grens? */
  stuurGrens: boolean;
  /** Stuursnelheid aan de grens? */
  snelheidGrens: boolean;
}

export type FlagSoort = 'stuurhoek' | 'stuursnelheid' | 'afwijking' | 'knikhoek' | 'onvoltooid';
export interface Flag { soort: FlagSoort; leg: number; s: number; x: number; y: number; tekst: string }

export interface SimResult {
  samples: Sample[];
  flags: Flag[];
  uitvoerbaar: boolean;
  maxAfwijking: number;
  maxKnik: number;
  lengte: number;
}

export const DS = 0.05;
/** Afwijking (m) waarboven een route als niet uitvoerbaar wordt aangemerkt. */
export const MAX_AFWIJKING = 0.5;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/* ---------------- polyline-hulpfuncties ---------------- */
interface PathInfo { pts: [number, number][]; cum: number[]; total: number }
function makePath(pts: [number, number][]): PathInfo {
  const clean: [number, number][] = [];
  for (const p of pts) if (!clean.length || Math.hypot(p[0] - clean[clean.length - 1][0], p[1] - clean[clean.length - 1][1]) > 1e-6) clean.push(p);
  const cum = [0];
  for (let i = 1; i < clean.length; i++) cum.push(cum[i - 1] + Math.hypot(clean[i][0] - clean[i - 1][0], clean[i][1] - clean[i - 1][1]));
  return { pts: clean, cum, total: cum[cum.length - 1] };
}
function at(P: PathInfo, s: number): { x: number; y: number; psi: number } {
  const n = P.pts.length;
  if (s <= 0) { const a = P.pts[0], b = P.pts[1]; return { x: a[0] + (b[0] - a[0]) * (s / (P.cum[1] || 1)), y: a[1] + (b[1] - a[1]) * (s / (P.cum[1] || 1)), psi: Math.atan2(b[1] - a[1], b[0] - a[0]) }; }
  if (s >= P.total) {
    const a = P.pts[n - 2], b = P.pts[n - 1], L = P.cum[n - 1] - P.cum[n - 2] || 1, t = (s - P.cum[n - 2]) / L;
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, psi: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }
  let i = 1;
  while (P.cum[i] < s) i++;
  const a = P.pts[i - 1], b = P.pts[i], t = (s - P.cum[i - 1]) / (P.cum[i] - P.cum[i - 1]);
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, psi: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}
/** Projectie op het pad, gezocht rond de vorige voortgang (monotoon, geen sprongen naar andere takken). */
function project(P: PathInfo, x: number, y: number, sPrev: number, window = 8): { s: number; e: number; psi: number } {
  let best = { s: sPrev, d: Infinity, e: 0, psi: 0 };
  const lo = sPrev - 1, hi = sPrev + window;
  for (let i = 1; i < P.pts.length; i++) {
    if (P.cum[i] < lo || P.cum[i - 1] > hi) continue;
    const a = P.pts[i - 1], b = P.pts[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    let t = ((x - a[0]) * dx + (y - a[1]) * dy) / l2;
    const last = i === P.pts.length - 1, first = i === 1;
    if (!last) t = Math.min(1, t);
    if (!first) t = Math.max(0, t);
    const px = a[0] + dx * t, py = a[1] + dy * t, d = Math.hypot(x - px, y - py);
    if (d < best.d) {
      const L = Math.sqrt(l2);
      best = { s: P.cum[i - 1] + t * L, d, e: (dx * (y - a[1]) - dy * (x - a[0])) / L, psi: Math.atan2(dy, dx) };
    }
  }
  return { s: best.s, e: best.e, psi: best.psi };
}

/* ---------------- geometrie van het voertuig ---------------- */
export const frontAxle = (v: VehicleSpec, p: Pose) => [p.x + v.wielbasis * Math.cos(p.theta), p.y + v.wielbasis * Math.sin(p.theta)] as [number, number];
export const kingpin = (v: VehicleSpec, p: Pose) => [p.x + (v.koppelpunt ?? 0) * Math.cos(p.theta), p.y + (v.koppelpunt ?? 0) * Math.sin(p.theta)] as [number, number];
export function trailerAxle(v: VehicleSpec, p: Pose): [number, number] {
  const k = kingpin(v, p), Lt = v.opleggerWielbasis ?? 0;
  return [k[0] - Lt * Math.cos(p.phi), k[1] - Lt * Math.sin(p.phi)];
}

/** Startpositie: vooras (vooruit) of achterste referentie (achteruit) op het eerste punt, gestrekt langs het eerste lijnstuk. */
export function startPose(v: VehicleSpec, leg: Leg): Pose {
  const [a, b] = leg.punten;
  const psi = Math.atan2(b[1] - a[1], b[0] - a[0]);
  if (leg.richting === 'vooruit') return { x: a[0] - v.wielbasis * Math.cos(psi), y: a[1] - v.wielbasis * Math.sin(psi), theta: psi, phi: psi, delta: 0 };
  // achteruit: voertuig kijkt tegen de rijrichting in
  const th = psi + Math.PI;
  if (v.soort === 'oplegger') {
    const Lt = v.opleggerWielbasis ?? 0, k = v.koppelpunt ?? 0;
    // oplegger-as op a; kingpin Lt verder in kijkrichting; achteras trekker k daarachter
    const kx = a[0] + Lt * Math.cos(th), ky = a[1] + Lt * Math.sin(th);
    return { x: kx - k * Math.cos(th), y: ky - k * Math.sin(th), theta: th, phi: th, delta: 0 };
  }
  return { x: a[0], y: a[1], theta: th, phi: th, delta: 0 };
}

/** Referentiepunt dat de getekende lijn volgt. */
export function referencePoint(v: VehicleSpec, p: Pose, richting: Richting): [number, number] {
  if (richting === 'vooruit') return frontAxle(v, p);
  return v.soort === 'oplegger' ? trailerAxle(v, p) : [p.x, p.y];
}

/** Eén integratiestap (booglengte ds van de achteras, negatief = achteruit). */
export function step(v: VehicleSpec, p: Pose, ds: number): Pose {
  const L = v.wielbasis, u = Math.tan(p.delta) / L;
  // midpoint-integratie voor nauwkeurige cirkelbanen
  const thm = p.theta + 0.5 * u * ds;
  const x = p.x + Math.cos(thm) * ds, y = p.y + Math.sin(thm) * ds, theta = p.theta + u * ds;
  let phi = p.phi;
  if (v.soort === 'oplegger') {
    const Lt = v.opleggerWielbasis ?? 1, k = v.koppelpunt ?? 0;
    const f = (th: number, ph: number) => (Math.sin(th - ph) + k * u * Math.cos(th - ph)) / Lt;
    // RK2
    const k1 = f(p.theta, p.phi);
    const k2 = f(thm, p.phi + 0.5 * k1 * ds);
    phi = p.phi + k2 * ds;
  }
  return { x, y, theta, phi, delta: p.delta };
}

export interface SimOptions {
  /** Stanley-versterking (1/m). */
  kStanley?: number;
  /** Knikhoekversterking achteruit (1/m). */
  kKnik?: number;
  /** Vooruitkijkafstand pure pursuit achteruit (m); standaard afhankelijk van het voertuig. */
  lookahead?: number;
  ds?: number;
  /** Startpositie (anders afgeleid van het eerste routedeel). */
  start?: Pose;
}

/** Simuleer alle routedelen achter elkaar. */
export function simulate(v: VehicleSpec, legs: Leg[], opt: SimOptions = {}): SimResult {
  const ds = opt.ds ?? DS;
  const dmax = effectiveMaxSteer(v);
  const vms = Math.max(0.3, v.snelheid / 3.6);
  const rateMax = rad(v.maxStuursnelheid) / vms; // rad per meter
  const kSt = opt.kStanley ?? 1.2;
  const kKn = opt.kKnik ?? 1.0;
  const knikMax = rad(v.maxKnikhoek ?? 90);
  const samples: Sample[] = [];
  const flags: Flag[] = [];
  let maxAfw = 0, maxKnik = 0, sTot = 0;
  const valid = legs.filter((l) => l.punten.length >= 2);
  if (!valid.length) return { samples, flags, uitvoerbaar: false, maxAfwijking: 0, maxKnik: 0, lengte: 0 };
  let pose = opt.start ?? startPose(v, valid[0]);
  let gestopt = false;
  samples.push({ ...pose, s: 0, leg: 0, afwijking: 0, stuurGrens: false, snelheidGrens: false });

  valid.forEach((leg, li) => {
    if (gestopt) return;
    const back = leg.richting === 'achteruit';
    // begin van dit deel = huidige positie van het referentiepunt
    const ref0 = referencePoint(v, pose, leg.richting);
    const pts = leg.punten.slice();
    if (Math.hypot(pts[0][0] - ref0[0], pts[0][1] - ref0[1]) > 0.05) pts.unshift(ref0);
    const P = makePath(pts);
    if (P.pts.length < 2 || P.total < 0.1) return;
    const Ld = opt.lookahead ?? (v.soort === 'oplegger' && back ? Math.max(4, 0.8 * (v.opleggerWielbasis ?? 6)) : Math.max(3, 0.9 * v.wielbasis));
    let sProg = 0;
    let satRun = 0, rateRun = 0, devFlagged = false, satFlagged = false, rateFlagged = false;
    const maxSteps = Math.ceil((P.total * 3 + 30) / ds);
    for (let n = 0; n < maxSteps; n++) {
      const ref = referencePoint(v, pose, leg.richting);
      const pr = project(P, ref[0], ref[1], sProg);
      sProg = Math.max(sProg, pr.s);
      const afw = Math.abs(pr.e);
      // einde bereikt?
      if (sProg >= P.total - 0.02) break;
      // gewenste stuurhoek
      let want: number;
      if (!back) {
        // Stanley: koersfout + dwarsafwijking (links van de lijn → naar rechts sturen)
        const ahead = at(P, pr.s + 0.5 * ds);
        want = wrap(ahead.psi - (pose.theta)) - Math.atan(kSt * pr.e);
      } else if (v.soort !== 'oplegger') {
        const tgt = at(P, pr.s + Ld);
        const h = pose.theta + Math.PI; // rijrichting achteruit
        const alpha = wrap(Math.atan2(tgt.y - ref[1], tgt.x - ref[0]) - h);
        const dist = Math.max(0.5, Math.hypot(tgt.x - ref[0], tgt.y - ref[1]));
        const kappa = (2 * Math.sin(alpha)) / dist;
        want = -Math.atan(kappa * v.wielbasis);
      } else {
        const Lt = v.opleggerWielbasis ?? 6, k = v.koppelpunt ?? 0;
        const tgt = at(P, pr.s + Ld);
        const h = pose.phi + Math.PI;
        const alpha = wrap(Math.atan2(tgt.y - ref[1], tgt.x - ref[0]) - h);
        const dist = Math.max(0.5, Math.hypot(tgt.x - ref[0], tgt.y - ref[1]));
        const kappaT = (2 * Math.sin(alpha)) / dist;
        let gd = -Math.atan(kappaT * Lt);
        gd = Math.max(-0.9 * knikMax, Math.min(0.9 * knikMax, gd));
        const g = wrap(pose.theta - pose.phi);
        const den = Math.max(0.2, 1 - (k * Math.cos(g)) / Lt);
        want = Math.atan((v.wielbasis * (Math.sin(g) / Lt + kKn * (g - gd))) / den);
      }
      // begrenzingen
      let sat = false, rate = false;
      if (Math.abs(want) > dmax) { want = Math.sign(want) * dmax; sat = true; }
      const dd = want - pose.delta, lim = rateMax * ds;
      let delta = want;
      if (Math.abs(dd) > lim) { delta = pose.delta + Math.sign(dd) * lim; rate = true; }
      pose = { ...pose, delta };
      pose = step(v, pose, back ? -ds : ds);
      sTot += ds;
      satRun = sat ? satRun + ds : 0;
      rateRun = rate ? rateRun + ds : 0;
      maxAfw = Math.max(maxAfw, afw);
      const knik = v.soort === 'oplegger' ? Math.abs(wrap(pose.theta - pose.phi)) : 0;
      maxKnik = Math.max(maxKnik, knik);
      samples.push({ ...pose, s: sTot, leg: li, afwijking: afw, stuurGrens: sat, snelheidGrens: rate });
      const flagAt = (soort: FlagSoort, tekst: string) => flags.push({ soort, leg: li, s: sTot, x: ref[0], y: ref[1], tekst });
      if (satRun > 1.0 && !satFlagged) { satFlagged = true; flagAt('stuurhoek', 'Maximale stuurhoek bereikt'); }
      if (rateRun > 1.0 && !rateFlagged) { rateFlagged = true; flagAt('stuursnelheid', 'Stuurt sneller dan mogelijk (stuursnelheid begrensd)'); }
      if (afw > MAX_AFWIJKING && !devFlagged) { devFlagged = true; flagAt('afwijking', `Wijkt meer dan ${MAX_AFWIJKING.toFixed(2).replace('.', ',')} m af van de getekende lijn`); }
      if (knik > knikMax) { flagAt('knikhoek', 'Maximale knikhoek overschreden (scharen)'); gestopt = true; break; }
      if (afw > 6) { flagAt('afwijking', 'Route niet te volgen – simulatie gestopt'); gestopt = true; break; }
      if (n === maxSteps - 1) { flagAt('onvoltooid', 'Einde van het routedeel niet bereikt'); gestopt = true; }
    }
  });
  const uitvoerbaar = !flags.some((f) => f.soort === 'afwijking' || f.soort === 'knikhoek' || f.soort === 'onvoltooid');
  return { samples, flags, uitvoerbaar, maxAfwijking: maxAfw, maxKnik, lengte: sTot };
}
