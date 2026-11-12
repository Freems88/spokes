/**
 * Page copy, written from the current plan so every time and count is the
 * model's own (and follows a shared link's edits). The voice is the ride's:
 * it invites people to join. The planning detail lives in the organisers'
 * section. Pure: returns HTML strings plus, for map steps, what to show.
 */
import { CAMPAIGN } from './config';
import { esc } from './editor';
import type { Area } from './model/geo';
import { comfortMaxRiders, crowdLengthM, crowdMetresPerRider, formatClock as hm, stopCrowd } from './model/model';
import type { LngLat, Params, Plan } from './model/types';

export type View = { bounds: [LngLat, LngLat] } | { center: LngLat; zoom: number };

export interface MapStep {
  id: string;
  heading?: string;
  html: string;
  view: View;
  at?: number;
  loop?: { from: number; to: number; speed: number };
  showAreas?: boolean;
}

const r = Math.round;
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const minsWords = (s: number) => (s < 75 ? 'about a minute' : s < 105 ? 'about a minute and a half' : `${(s / 60).toFixed(1)} minutes`);

export function boundsOf(pts: LngLat[]): [LngLat, LngLat] {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}

export function keyNumbers(plan: Plan) {
  const p = plan.params;
  const mix = stopCrowd({ id: '', name: '', lngLat: [0, 0], riders: 1 }, p);
  const mPerRider = crowdMetresPerRider(mix, p);
  const v = p.cruiseKmh / 3.6;
  return {
    mPerRider, v, all: plan.totalRiders,
    comfortMax: comfortMaxRiders(p, mPerRider),
    holdFor: (riders: number) => (riders * mPerRider) / v,
    spokeMaxHoldS: Math.max(0, ...plan.spokes.map((s) => s.maxBlockageS)),
  };
}


// ── Hero ────────────────────────────────────────────────────────────────

export function heroHtml(plan: Plan): string {
  const t = plan.terminal;
  const n = plan.spokes.length;
  const when = CAMPAIGN.date ? `${esc(CAMPAIGN.date)} · Toronto` : 'Toronto';
  const link = /^https:\/\//.test(CAMPAIGN.linkUrl)
    ? `<a class="btn ghost" href="${esc(CAMPAIGN.linkUrl)}" rel="noopener">${esc(CAMPAIGN.linkText)}</a>` : '';
  return `
    <p class="kicker">${when}</p>
    <h1><img class="mark" src="favicon.svg" alt="" width="64" height="64" />${esc(CAMPAIGN.name)}</h1>
    <p class="lede">${esc(CAMPAIGN.tagline)}</p>
    ${CAMPAIGN.cause ? `<p class="cause">${esc(CAMPAIGN.cause)}</p>` : ''}
    <div class="stats">
      <div class="stat"><span class="n">${r(plan.totalRiders)}</span><span class="l">riders</span></div>
      <div class="stat"><span class="n">${n}</span><span class="l">neighbourhood ${n === 1 ? 'ride' : 'rides'}</span></div>
      <div class="stat"><span class="n">1</span><span class="l">ride to City Hall</span></div>
      <div class="stat"><span class="n">${hm(t.headArriveS)}</span><span class="l">at ${esc(plan.scenario.destination.name)}</span></div>
    </div>
    <div class="cta">
      <a class="btn primary" href="#find">Find your spoke</a>
      <a class="btn" href="#story">See the ride</a>
      ${link}
    </div>`;
}

// ── The ride, told on the map ───────────────────────────────────────────

export function mapSteps(plan: Plan, areas: Area[] | null): MapStep[] {
  const sc = plan.scenario;
  const t = plan.terminal;
  const all = boundsOf([...plan.spokes.flatMap((s) => s.path), ...t.path]);
  const startNames = plan.spokes.map((s) => s.stops[0]!.stop.name);
  const firstStart = Math.min(...plan.spokes.map((s) => s.startS));
  const steps: MapStep[] = [];

  steps.push({
    id: 'city', heading: 'It starts small',
    html: `<p>Just after ${hm(firstStart)}, ${plan.spokes.length === 1 ? 'a small group rolls' : `${plan.spokes.length} small groups roll`} out
      from ${esc(list(startNames))}. Each one starts close to where its riders live.</p>`,
    view: { bounds: all }, at: firstStart + 60, showAreas: true,
  });

  const sp = [...plan.spokes].sort((a, b) => b.stops.length - a.stops.length)[0];
  if (sp && sp.stops.length > 2) {
    const first = sp.stops[0]!;
    const last = sp.stops.at(-2)!;
    steps.push({
      id: 'grow', heading: 'It grows as it rolls',
      html: `<p>${esc(sp.name)} leaves ${esc(first.stop.name)} at ${hm(sp.startS)} with ${r(first.ridersAfter)} riders.
        At ${esc(list(sp.stops.slice(1, -1).map((s) => s.stop.name)))}, more join.
        By ${esc(last.stop.name)} it is <strong>${r(sp.peakRiders)} strong</strong>.</p>`,
      view: { bounds: boundsOf(sp.path) },
      loop: { from: sp.startS, to: last.departS + 120, speed: 60 },
    });
  }

  const midS = (Math.min(...plan.spokes.map((s) => s.headArriveMergeS)) + Math.max(...plan.spokes.map((s) => s.startS))) / 2;
  steps.push({
    id: 'short', heading: 'Light on the streets',
    html: `<p>Every group is short enough to clear an intersection in ${minsWords(keyNumbers(plan).spokeMaxHoldS)}.
      Then the light goes back to normal. The city keeps moving while we do.</p>`,
    view: { bounds: all }, at: midS,
  });

  const heads = plan.spokes.map((s) => s.headArriveMergeS);
  const lastTail = Math.max(...plan.spokes.map((s) => s.tailArriveMergeS));
  steps.push({
    id: 'merge', heading: `We meet at ${sc.merge.name}`,
    html: `<p>From ${hm(Math.min(...heads))} the rides pour in${t.joinAtMerge ? `, and ${r(t.joinAtMerge)} more riders from downtown are waiting` : ''}.
      By ${hm(lastTail)} there are <strong>${r(t.riders)} of us</strong>.</p>`,
    view: { center: sc.merge.lngLat, zoom: 15 },
    loop: { from: Math.min(...heads) - 120, to: lastTail + 60, speed: 30 },
  });

  steps.push({
    id: 'final', heading: 'One ride to City Hall',
    html: `<p>At ${hm(t.departS)} we leave together: ${km(t.distanceM)} down to ${esc(sc.destination.name)}.
      Nearly ${t.lengthM >= 900 ? 'a kilometre' : `${r(t.lengthM / 100) * 100} metres`} of bikes, side by side.</p>`,
    view: { bounds: boundsOf(t.path) },
    loop: { from: t.departS - 30, to: t.tailArriveS + 30, speed: 30 },
  });

  steps.push({
    id: 'arrive', heading: 'Arrive together',
    html: `<p>${hm(t.headArriveS)}, ${esc(sc.destination.name)}. ${r(t.riders)} riders from across the city, in one place.</p>
      ${CAMPAIGN.cause ? `<p>${esc(CAMPAIGN.cause)}</p>` : ''}`,
    view: { center: sc.destination.lngLat, zoom: 15.3 },
    at: t.tailArriveS + 90,
  });
  return steps;
}

// ── Find your spoke ─────────────────────────────────────────────────────

/** Where and when to join. `colorOf` keys the swatch to the map. */
export function findHtml(plan: Plan, areas: Area[] | null, colorOf: (id: string) => string): string {
  const sc = plan.scenario;
  const t = plan.terminal;
  const p = plan.params;
  void areas;
  const cards = plan.spokes.map((s, i) => `
    <article class="spoke" data-spoke="${esc(s.id)}">
      <header><span class="sw" style="background:${colorOf(s.id)}"></span>
        <h3>${esc(s.name)}</h3>${sc.spokes[i]?.area ? `<span class="area">${esc(sc.spokes[i]!.area!)}</span>` : ''}
        <button type="button" class="mini" data-show-spoke="${esc(s.id)}">Show on map</button></header>
      <ol class="times">
        ${s.stops.slice(0, -1).map((st) => st.kind === 'start' ? `
          <li><span class="tm">${hm(st.departS - p.meetBeforeStartMin * 60)}</span>
            <span class="pl">${esc(st.stop.name)}</span>
            <span class="what">meet here · rolls out ${hm(st.departS)}</span></li>` : `
          <li><span class="tm">${hm(st.arriveS)}</span>
            <span class="pl">${esc(st.stop.name)}</span>
            <span class="what">ride arrives · leaves ${hm(st.departS)}</span></li>`).join('')}
        <li><span class="tm">${hm(s.headArriveMergeS)}</span><span class="pl">${esc(sc.merge.name)}</span><span class="what">arrives</span></li>
      </ol>
    </article>`).join('');
  const downtown = t.joinAtMerge > 0 ? `
    <article class="spoke">
      <header><span class="sw" style="background:${colorOf('terminal')}"></span><h3>Downtown</h3></header>
      <ol class="times">
        <li><span class="tm">${hm(t.departS - (p.mergeHoldMin + 5) * 60)}</span>
          <span class="pl">${esc(sc.merge.name)}</span><span class="what">meet here</span></li>
        <li><span class="tm">${hm(t.departS)}</span><span class="pl">${esc(sc.merge.name)}</span><span class="what">everyone leaves together</span></li>
        <li><span class="tm">${hm(t.headArriveS)}</span><span class="pl">${esc(sc.destination.name)}</span><span class="what">arrive</span></li>
      </ol>
    </article>` : '';
  return `
    <h2>Find your spoke</h2>
    <p>Join at the start or at any stop along the way. The ride waits ${p.regroupMin} minutes at each stop, then rolls on.
      Times are estimates with some slack built in, so come a few minutes early.</p>
    <div class="spokes">${cards}${downtown}</div>`;
}

// ── Why spokes ──────────────────────────────────────────────────────────

export function whyHtml(plan: Plan): string {
  const k = keyNumbers(plan);
  return `
    <h2>Why spokes?</h2>
    <p>One giant ride is a slow-moving wall: all ${r(k.all)} of us in one line would hold every intersection for
      ${minsWords(k.holdFor(k.all))}, all the way across the city.</p>
    <p>Riding in from many directions keeps every group short until the last ${km(plan.terminal.distanceM)}.
      More neighbourhoods take part, and nobody has to ride across town just to start.</p>`;
}

export function organiserIntroHtml(plan: Plan): string {
  const k = keyNumbers(plan);
  return `
    <h2>For organisers</h2>
    <p class="intro">Every time on this page comes from a simple, open model: group length is riders × road space,
      and the time a corner is held is length ÷ speed. Groups of about 150–${k.comfortMax} riders keep holds under
      ${plan.params.thresholds.maxBlockageS} s. Move starts, add pickups and spokes, change numbers, ages and assumptions;
      the map and timetable update, and the address bar becomes a link to your plan.</p>`;
}

// ── Chart data ──────────────────────────────────────────────────────────

export function groupBars(plan: Plan): { id: string; name: string; riders: number; lengthM: number; holdS: number }[] {
  return [
    ...plan.spokes.map((s) => ({ id: s.id, name: s.name, riders: s.peakRiders, lengthM: s.peakLengthM, holdS: s.maxBlockageS })),
    { id: 'terminal', name: 'Final ride', riders: plan.terminal.riders, lengthM: plan.terminal.lengthM, holdS: plan.terminal.blockageS },
  ];
}

export function holdCurve(p: Params, maxRiders: number, step = 10): { riders: number; holdS: number; lengthM: number }[] {
  const out = [];
  const mix = stopCrowd({ id: '', name: '', lngLat: [0, 0], riders: 1 }, p);
  for (let n = 0; n <= maxRiders; n += step) {
    const c = { kids: mix.kids * n, teens: mix.teens * n, adults: mix.adults * n, seniors: mix.seniors * n };
    const len = crowdLengthM(c, p);
    out.push({ riders: n, holdS: len / (p.cruiseKmh / 3.6), lengthM: len });
  }
  return out;
}
