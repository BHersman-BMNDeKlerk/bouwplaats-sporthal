/**
 * Voertuigbibliotheek en geometrie voor de draaicirkelberekening (fase 4).
 *
 * Model: fietsmodel (bicycle model). De trekker/het voertuig rijdt rond het
 * midden van de (effectieve) achteras; de stuurhoek δ is de equivalente
 * stuurhoek van de vooras (Ackermann-midden). Een oplegger hangt aan het
 * koppelpunt (kingpin) en volgt met zijn (effectieve) achteras.
 *
 * Alle maten in meters, hoeken in graden (opslag) / radialen (rekenen).
 * De standaardwaarden zijn indicatief en bewerkbaar; gebruik bij voorkeur
 * fabrikantgegevens.
 */

export interface VehicleSpec {
  id: string;
  naam: string;
  /** 'star' = één voertuig; 'oplegger' = trekker met oplegger. */
  soort: 'star' | 'oplegger';
  /** Afstand vooras – (effectieve) achteras. */
  wielbasis: number;
  overhangVoor: number;
  overhangAchter: number;
  breedte: number;
  hoogte: number;
  /** Hart-op-hart afstand van de voorwielen (spoorbreedte). */
  spoorbreedte: number;
  /** Bandbreedte (voor stoep-stoep: buitenkant van de band). */
  bandbreedte: number;
  /** Maximale (equivalente) stuurhoek van de vooras. */
  maxStuurhoek: number;
  /** Maximale stuurhoeksnelheid (°/s) bij de manoeuvresnelheid. */
  maxStuursnelheid: number;
  /** Manoeuvresnelheid (km/h) waarmee de stuursnelheid wordt omgerekend naar °/m. */
  snelheid: number;
  /** Opgegeven minimale draaicirkel stoep-stoep (diameter, m) volgens fabrikant; overschrijft de max. stuurhoek. */
  draaicirkelStoep?: number;
  /** Opgegeven draaicirkel muur-muur (diameter, m) – ter controle. */
  draaicirkelMuur?: number;
  /** Oplegger: koppelpunt t.o.v. de achteras van de trekker (+ = vóór de achteras). */
  koppelpunt?: number;
  /** Oplegger: kingpin – (effectieve) achteras oplegger. */
  opleggerWielbasis?: number;
  /** Oplegger: kingpin – voorkant oplegger. */
  opleggerOverhangVoor?: number;
  /** Oplegger: achteras – achterkant oplegger. */
  opleggerOverhangAchter?: number;
  opleggerBreedte?: number;
  /** Maximale knikhoek trekker–oplegger (°). */
  maxKnikhoek?: number;
  opmerking?: string;
}

const base = { bandbreedte: 0.35, maxStuursnelheid: 20, snelheid: 5 };

export const VEHICLES: VehicleSpec[] = [
  {
    id: 'trekker-oplegger', naam: 'Trekker-oplegger 16,5 m', soort: 'oplegger', ...base,
    wielbasis: 3.6, overhangVoor: 1.4, overhangAchter: 0.9, breedte: 2.55, hoogte: 4.0, spoorbreedte: 2.05, maxStuurhoek: 45,
    koppelpunt: 0.5, opleggerWielbasis: 7.5, opleggerOverhangVoor: 1.6, opleggerOverhangAchter: 4.5, opleggerBreedte: 2.55, maxKnikhoek: 90,
    opmerking: 'Standaard EU-combinatie 16,5 m (kingpin–voorkant 4,5 m, kingpin–achterkant 12,0 m); tridem met effectieve as in het midden.',
  },
  {
    id: 'bakwagen-10', naam: 'Bakwagen 10 m (2-assig)', soort: 'star', ...base,
    wielbasis: 5.5, overhangVoor: 1.35, overhangAchter: 3.15, breedte: 2.55, hoogte: 3.8, spoorbreedte: 2.05, maxStuurhoek: 42,
  },
  {
    id: 'bakwagen-12', naam: 'Bakwagen 12 m (3-assig)', soort: 'star', ...base,
    wielbasis: 6.5, overhangVoor: 1.4, overhangAchter: 4.1, breedte: 2.55, hoogte: 3.9, spoorbreedte: 2.05, maxStuurhoek: 40,
    opmerking: 'Effectieve wielbasis tot het midden van de achterste tandem.',
  },
  {
    id: 'kipper-4as', naam: '4-assige kipper / betonmixer', soort: 'star', ...base,
    wielbasis: 4.9, overhangVoor: 1.45, overhangAchter: 2.15, breedte: 2.55, hoogte: 4.0, spoorbreedte: 2.05, maxStuurhoek: 37,
    opmerking: 'Twee gestuurde vooras­sen en tandem achter; effectieve wielbasis (midden voorassen – midden achterassen).',
  },
  {
    id: 'kraanwagen', naam: 'Vrachtwagen met kraan', soort: 'star', ...base,
    wielbasis: 5.8, overhangVoor: 1.5, overhangAchter: 2.7, breedte: 2.55, hoogte: 4.0, spoorbreedte: 2.05, maxStuurhoek: 40,
  },
  {
    id: 'mobiele-kraan-2', naam: 'Mobiele kraan 2-assig', soort: 'star', ...base,
    wielbasis: 3.6, overhangVoor: 2.4, overhangAchter: 2.6, breedte: 2.55, hoogte: 3.6, spoorbreedte: 2.1, maxStuurhoek: 45,
    opmerking: 'Vereenvoudigd: allwheel-besturing benaderd met een effectieve wielbasis.',
  },
  {
    id: 'mobiele-kraan-3', naam: 'Mobiele kraan 3-assig', soort: 'star', ...base,
    wielbasis: 4.4, overhangVoor: 2.7, overhangAchter: 3.4, breedte: 2.55, hoogte: 3.9, spoorbreedte: 2.1, maxStuurhoek: 42,
    opmerking: 'Vereenvoudigd: allwheel-besturing benaderd met een effectieve wielbasis.',
  },
  {
    id: 'mobiele-kraan-5', naam: 'Mobiele kraan 5-assig', soort: 'star', ...base,
    wielbasis: 6.0, overhangVoor: 3.0, overhangAchter: 4.5, breedte: 3.0, hoogte: 4.0, spoorbreedte: 2.5, maxStuurhoek: 40,
    opmerking: 'Vereenvoudigd: allwheel-besturing benaderd met een effectieve wielbasis.',
  },
  {
    id: 'bestelbus', naam: 'Bestelbus', soort: 'star', ...base,
    wielbasis: 3.66, overhangVoor: 0.95, overhangAchter: 1.39, breedte: 2.0, hoogte: 2.5, spoorbreedte: 1.7, bandbreedte: 0.22, maxStuurhoek: 40,
  },
];

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Straal van de buitenkant van de buitenste voorband bij stuurhoek δ (rad). */
export function curbRadius(v: VehicleSpec, delta: number): number {
  const Rr = v.wielbasis / Math.tan(delta);
  return Math.hypot(Rr + v.spoorbreedte / 2 + v.bandbreedte / 2, v.wielbasis);
}

/** Straal van de buitenste voorhoek van de carrosserie (muur-muur) bij stuurhoek δ (rad). */
export function wallRadius(v: VehicleSpec, delta: number): number {
  const Rr = v.wielbasis / Math.tan(delta);
  return Math.hypot(Rr + v.breedte / 2, v.wielbasis + v.overhangVoor);
}

/** Stuurhoek (rad) waarbij de stoep-stoep-diameter gelijk is aan `diameter`. */
export function deltaForCurbDiameter(v: VehicleSpec, diameter: number): number {
  let lo = rad(5), hi = rad(75);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (2 * curbRadius(v, mid) > diameter) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Effectieve maximale stuurhoek (rad): uit de opgegeven draaicirkel of uit maxStuurhoek. */
export function effectiveMaxSteer(v: VehicleSpec): number {
  return v.draaicirkelStoep ? deltaForCurbDiameter(v, v.draaicirkelStoep) : rad(v.maxStuurhoek);
}

/** Minimale draaicirkels (diameters) van het (trek)voertuig bij volle uitslag. */
export function turningCircles(v: VehicleSpec): { stoep: number; muur: number; stuurhoek: number } {
  const d = effectiveMaxSteer(v);
  return { stoep: 2 * curbRadius(v, d), muur: 2 * wallRadius(v, d), stuurhoek: deg(d) };
}

export function totalLength(v: VehicleSpec): number {
  if (v.soort === 'star') return v.overhangVoor + v.wielbasis + v.overhangAchter;
  // trekker voorkant tot oplegger achterkant (gestrekt)
  const front = v.wielbasis + v.overhangVoor;
  const k = v.koppelpunt ?? 0;
  return front - k + (v.opleggerWielbasis ?? 0) + (v.opleggerOverhangAchter ?? 0);
}

export { rad, deg };
