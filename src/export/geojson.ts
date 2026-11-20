/** GeoJSON-export in RD New (EPSG:28992), met de klassieke crs-aanduiding voor QGIS e.d. */
import { circleRing, type DrawFeature } from './features';

const r3 = (p: number[]) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000];

export function toGeoJSON(features: DrawFeature[], meta: Record<string, unknown> = {}) {
  const feats = features.map((ft) => {
    const gm = ft.geom;
    let geometry: any;
    const props: Record<string, unknown> = { ...(ft.props ?? {}), laag: ft.laag, groep: ft.groep, kleur: ft.kleur };
    if (gm.type === 'polygon') geometry = { type: 'Polygon', coordinates: gm.rings.map((r) => { const q = r.map(r3); const a = q[0], b = q[q.length - 1]; return a[0] === b[0] && a[1] === b[1] ? q : [...q, a]; }) };
    else if (gm.type === 'line') geometry = { type: 'LineString', coordinates: gm.coords.map(r3) };
    else if (gm.type === 'point') geometry = { type: 'Point', coordinates: r3(gm.coord) };
    else if (gm.type === 'circle') { geometry = { type: 'Polygon', coordinates: [circleRing(gm.center, gm.radius).map(r3)] }; props.straal = gm.radius; props.middelpunt = r3(gm.center); }
    else { geometry = { type: 'Point', coordinates: r3(gm.coord) }; props.tekst = gm.text; }
    return { type: 'Feature', geometry, properties: props };
  });
  return { type: 'FeatureCollection', name: 'bouwplaatsinrichting', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::28992' } }, metadata: meta, features: feats };
}
