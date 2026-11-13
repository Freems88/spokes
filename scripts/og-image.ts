/**
 * Link-preview image (Open Graph / Twitter card) and home-screen icon,
 * drawn from the same data and copy as the site:
 *   public/og.png               1200×630
 *   public/apple-touch-icon.png  180×180
 *
 *   npm run og
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { CAMPAIGN, DEFAULT_PARAMS, DEFAULT_SCENARIO } from '../src/config';
import { applyData, signalPoints, type RoutesFile, type SignalsFile } from '../src/model/data';
import { computePlan } from '../src/model/model';
import type { LngLat } from '../src/model/types';

const pub = (f: string) => new URL(`../public/${f}`, import.meta.url);
const json = <T>(f: string) => JSON.parse(readFileSync(pub(`data/${f}`), 'utf8')) as T;

const routes = json<RoutesFile>('routes.geojson');
const signals = json<SignalsFile>('signals.geojson');
const areas = json<{ features: { properties: { name: string }; geometry: { coordinates: LngLat[][][] } }[] }>('municipalities.geojson');
const plan = computePlan(applyData(DEFAULT_SCENARIO, routes, signalPoints(signals)), DEFAULT_PARAMS);

const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const INK = '#16161a';
const BG = '#fcfcfb';
const FONT = `'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The spoke mark (same drawing as public/favicon.svg), as a group at x,y with size s. */
function mark(x: number, y: number, s: number): string {
  return `<g transform="translate(${x} ${y}) scale(${s / 32}) translate(0 2.4)">
    <g stroke-linecap="round" stroke-width="3.4" fill="none">
      <path d="M4.5 23 L16 18.5" stroke="#2a78d6"/><path d="M13.5 4.5 L16 18.5" stroke="#1baf7a"/><path d="M27.5 10 L16 18.5" stroke="#eb6834"/>
    </g>
    <circle cx="4.5" cy="23" r="3.2" fill="#2a78d6"/><circle cx="13.5" cy="4.5" r="3.2" fill="#1baf7a"/><circle cx="27.5" cy="10" r="3.2" fill="#eb6834"/>
    <circle cx="16" cy="18.5" r="7" fill="${BG}"/><circle cx="16" cy="18.5" r="5.4" fill="${INK}"/>
  </g>`;
}

// ── Map panel: Toronto outline + the real routes ─────────────────────────

function mapPanel(px: number, py: number, pw: number, ph: number): string {
  // Frame the routes (not the whole city), with some room around them.
  const all = [...plan.spokes.flatMap((s) => s.path), ...plan.terminal.path];
  let minX = Math.min(...all.map((p) => p[0])), maxX = Math.max(...all.map((p) => p[0]));
  let minY = Math.min(...all.map((p) => p[1])), maxY = Math.max(...all.map((p) => p[1]));
  const padX = (maxX - minX) * 0.1, padY = (maxY - minY) * 0.14;
  minX -= padX; maxX += padX; minY -= padY; maxY += padY;
  const k = Math.cos(((minY + maxY) / 2) * Math.PI / 180);
  const scale = Math.min(pw / ((maxX - minX) * k), ph / (maxY - minY));
  const ox = px + (pw - (maxX - minX) * k * scale) / 2;
  const oy = py + (ph - (maxY - minY) * scale) / 2;
  const P = ([x, y]: LngLat) => `${(ox + (x - minX) * k * scale).toFixed(1)},${(oy + (maxY - y) * scale).toFixed(1)}`;
  const line = (pts: LngLat[]) => `M${pts.map(P).join('L')}`;
  const XY = (p: LngLat) => P(p).split(',').map(Number) as [number, number];

  const city = areas.features.map((f) => f.geometry.coordinates.map((poly) =>
    `<path d="${poly.map((ring) => `${line(ring)}Z`).join('')}" fill="#e2e1d9" stroke="#f6f5f1" stroke-width="2.5" stroke-linejoin="round"/>`).join('')).join('');

  const spokes = plan.spokes.map((s, i) => {
    const c = SERIES[i % SERIES.length]!;
    const stops = s.stops.slice(0, -1);
    const [sx, sy] = XY(stops[0]!.stop.lngLat);
    return `<path d="${line(s.path)}" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${line(s.path)}" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
      ${stops.slice(1).map((st) => { const [x, y] = XY(st.stop.lngLat); return `<circle cx="${x}" cy="${y}" r="5.5" fill="#ffffff" stroke="${c}" stroke-width="3"/>`; }).join('')}
      <circle cx="${sx}" cy="${sy}" r="11" fill="${c}" stroke="#ffffff" stroke-width="3"/>`;
  }).join('');
  const [mx, my] = XY(plan.scenario.merge.lngLat);
  const [dx, dy] = XY(plan.scenario.destination.lngLat);
  const final = `<path d="${line(plan.terminal.path)}" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
    <rect x="${dx - 9}" y="${dy - 9}" width="18" height="18" rx="3" fill="${INK}" stroke="#ffffff" stroke-width="3"/>
    <circle cx="${mx}" cy="${my}" r="15" fill="#ffffff"/><circle cx="${mx}" cy="${my}" r="11" fill="${INK}"/>`;
  return `<defs><clipPath id="panel"><rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="28"/></clipPath></defs>
    <g clip-path="url(#panel)"><rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#f6f5f1"/>${city}${spokes}${final}</g>
    <rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="28" fill="none" stroke="#e2e1db" stroke-width="2"/>`;
}

// ── Card ─────────────────────────────────────────────────────────────────

function card(): string {
  const W = 1200, H = 630;
  const n = plan.spokes.length;
  const tagline = wrap(CAMPAIGN.tagline, 22);
  const facts = `${Math.round(plan.totalRiders)} riders · ${n} neighbourhood ${n === 1 ? 'ride' : 'rides'} · 1 ride to City Hall`;
  const when = CAMPAIGN.date || CAMPAIGN.season;
  const kicker = (when ? `${when} · ` : '') + 'Toronto';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${BG}"/>
    ${mapPanel(690, 40, 470, 550)}
    <text x="72" y="118" font-family="${FONT}" font-size="22" font-weight="700" letter-spacing="3.5" fill="#6b6a66">${esc(kicker.toUpperCase())}</text>
    ${mark(66, 150, 112)}
    <text x="190" y="246" font-family="${FONT}" font-size="104" font-weight="800" letter-spacing="-3" fill="${INK}">${esc(CAMPAIGN.name)}</text>
    ${tagline.map((l, i) => `<text x="72" y="${352 + i * 52}" font-family="${FONT}" font-size="44" font-weight="700" letter-spacing="-0.5" fill="${INK}">${esc(l)}</text>`).join('')}
    <rect x="72" y="${352 + tagline.length * 52 - 8}" width="72" height="5" rx="2.5" fill="${INK}"/>
    <text x="72" y="${352 + tagline.length * 52 + 46}" font-family="${FONT}" font-size="23" fill="#4a4946">${esc(facts)}</text>
  </svg>`;
}

/** Break at sentence ends first, then wrap each sentence to ~maxChars per line. */
function wrap(text: string, maxChars: number): string[] {
  return text.split(/(?<=[.!?])\s+/).flatMap((sentence) => {
    const lines: string[] = [];
    for (const word of sentence.split(/\s+/)) {
      const last = lines.at(-1);
      if (last !== undefined && (last + ' ' + word).length <= maxChars) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    }
    return lines;
  });
}

function touchIcon(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
    <rect width="180" height="180" fill="${BG}"/>${mark(22, 18, 136)}</svg>`;
}

const render = (svg: string, width: number) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: true, defaultFontFamily: 'Arial' } }).render().asPng();

writeFileSync(pub('og.png'), render(card(), 1200));
writeFileSync(pub('apple-touch-icon.png'), render(touchIcon(), 180));
console.log('wrote public/og.png and public/apple-touch-icon.png');
