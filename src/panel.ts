import { esc } from './editor';
import { AGE_GROUPS, type Plan } from './model/types';
import { comfortMaxRiders, crowdMetresPerRider, formatClock as hm, stopCrowd } from './model/model';

export interface RouteSummary { routed: number; straight: number; pending: number; signals: boolean }
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const mins = (s: number) => `${Math.round(s / 60)} min`;
const r = Math.round;

export function renderPanel(
  el: HTMLElement,
  plan: Plan,
  colorOf: (id: string) => string,
  data: RouteSummary,
) {
  const p = plan.params;
  const t = plan.terminal;
  const mix = stopCrowd({ id: '', name: '', lngLat: [0, 0], riders: 1 }, p);

  const spokeCards = plan.spokes.map((s) => `
    <article class="card">
      <header><span class="sw" style="background:${colorOf(s.id)}"></span>${esc(s.name)}
        <span class="area">${esc(s.area ?? '')}</span></header>
      <dl>
        <div><dt>Leaves</dt><dd>${hm(s.startS)}</dd></div>
        <div><dt>Distance</dt><dd>${km(s.distanceM)}</dd></div>
        <div><dt>Riding time</dt><dd>${mins(s.durationS)}</dd></div>
        <div><dt>Riders at end</dt><dd>${r(s.peakRiders)}</dd></div>
        <div><dt>Longest column</dt><dd>${r(s.peakLengthM)} m</dd></div>
        <div><dt>Longest hold</dt><dd>${r(s.maxBlockageS)} s</dd></div>
        <div><dt>Signals crossed</dt><dd>${s.signals}</dd></div>
        <div><dt>Marshals</dt><dd>${s.marshals.low}–${s.marshals.high}</dd></div>
        <div><dt>At merge</dt><dd>${hm(s.headArriveMergeS)}</dd></div>
      </dl>
      <p class="stops">${s.stops.slice(0, -1).map((st) =>
        `${esc(st.stop.name)} ${st.kind === 'start' ? hm(st.departS) : hm(st.arriveS)} (+${r(st.stop.riders)})`).join(' → ')}</p>
    </article>`).join('');

  const finalCard = `
    <article class="card">
      <header><span class="sw" style="background:${colorOf('terminal')}"></span>Final ride
        <span class="area">${esc(plan.scenario.merge.name)} → ${esc(plan.scenario.destination.name)}</span></header>
      <dl>
        <div><dt>Leaves</dt><dd>${hm(t.departS)}</dd></div>
        <div><dt>Distance</dt><dd>${km(t.distanceM)}</dd></div>
        <div><dt>Riders</dt><dd>${r(t.riders)}</dd></div>
        <div><dt>Column</dt><dd>${r(t.lengthM)} m</dd></div>
        <div><dt>Each signal held</dt><dd>${(t.blockageS / 60).toFixed(1)} min</dd></div>
        <div><dt>Signals</dt><dd>${t.signals}</dd></div>
        <div><dt>Head arrives</dt><dd>${hm(t.headArriveS)}</dd></div>
        <div><dt>Tail arrives</dt><dd>${hm(t.tailArriveS)}</dd></div>
        <div><dt>Marshals</dt><dd>${t.marshals.low}–${t.marshals.high}</dd></div>
      </dl>
    </article>`;

  const label = { warn: 'Warning', tradeoff: 'Trade-off', info: 'Note' } as const;
  const flags = plan.flags.length
    ? `<ul class="flags">${plan.flags.map((f) => `<li class="${f.level}"><b>${label[f.level]}:</b>${esc(f.message)}</li>`).join('')}</ul>`
    : '<p class="note">No warnings.</p>';

  const rows: [string, string][] = [
    ['Lead pace', `${p.cruiseKmh} km/h`],
    ['Riders per row', `${p.ridersPerRow}`],
    ['Row spacing', `${p.rowSpacingM} m`],
    ['Space per rider (default age mix)', `${crowdMetresPerRider(mix, p).toFixed(2)} m`],
    ['Regroup at each pickup', `${p.regroupMin} min`],
    ['Hold at merge after last arrival', `${p.mergeHoldMin} min`],
    ['Marshals', `1 per ${p.ridersPerMarshal.low}–${p.ridersPerMarshal.high} riders`],
    ...AGE_GROUPS.map((g): [string, string] => {
      const a = p.ages[g];
      return [`Age ${a.label}: share · pace · space · marshal weight`,
        `${r(p.defaultAgeMix[g] * 100)}% · ${a.paceKmh} km/h · ${a.spaceFactor}× · ${a.marshalWeight}×`];
    }),
    ['An age group sets the pace at', `≥ ${r(p.paceSetShare * 100)}% of a column`],
    ['Comfort limits', `${p.thresholds.maxColumnM} m column / ${p.thresholds.maxBlockageS} s hold`],
    ['→ comfort max per group', `~${comfortMaxRiders(p, crowdMetresPerRider(mix, p))} riders`],
    ['Smallest safe start', `${p.thresholds.minStartRiders} riders`],
    ['Target arrival at merge', `${p.targetMergeArrival}`],
    ['Signals', data.signals ? 'Toronto Open Data, within 15 m of route' : `estimated ${p.signalsPerKmEstimate}/km`],
    ['Routes', routeText(data)],
  ];

  el.innerHTML = `
    <div>
      <h2>${r(plan.totalRiders)} riders, ${plan.spokes.length} spokes, one final ride</h2>
      <p class="note">Every figure here is a planning estimate from the assumptions below.
      Column length = riders × space per rider. Hold time = column length ÷ speed.</p>
      ${data.pending || data.straight ? `<p class="note">Routes: ${esc(routeText(data))}.</p>` : ''}
    </div>
    <section><h2>Flags</h2>${flags}</section>
    <section class="cards" aria-label="Spokes">${spokeCards}${finalCard}</section>
    <details><summary>Assumptions</summary><table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></details>
  `;
}

function routeText(d: RouteSummary): string {
  const parts = [`${d.routed} snapped to streets (OSRM)`];
  if (d.pending) parts.push(`${d.pending} routing…`);
  if (d.straight) parts.push(`${d.straight} straight lines (dashed)`);
  return parts.join(', ');
}
