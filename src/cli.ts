/**
 * Print the default plan's timetable and flags.
 *   npm run plan            # human-readable
 *   npm run plan -- --json  # full plan object
 */
import { DEFAULT_PARAMS, DEFAULT_SCENARIO } from './config';
import {
  comfortMaxRiders, computePlan, crowdMetresPerRider, formatClock as hm, stopCrowd,
} from './model/model';
import { AGE_GROUPS } from './model/types';
import { applyData, signalPoints, type RoutesFile, type SignalsFile } from './model/data';
import { existsSync, readFileSync } from 'node:fs';

// Use the cached routes and real signals when `npm run data` has been run; --raw skips them.
const load = <T>(f: string): T | null => {
  const u = new URL(`../public/data/${f}`, import.meta.url);
  return !process.argv.includes('--raw') && existsSync(u) ? (JSON.parse(readFileSync(u, 'utf8')) as T) : null;
};
const routes = load<RoutesFile>('routes.geojson');
const signals = load<SignalsFile>('signals.geojson');
const scenario = applyData(DEFAULT_SCENARIO, routes, signals ? signalPoints(signals) : null);
const plan = computePlan(scenario, DEFAULT_PARAMS);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

const p = plan.params;
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const mins = (s: number) => `${Math.round(s / 60)} min`;
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const rpad = (s: string | number, n: number) => String(s).padStart(n);
const est = (e: boolean) => (e ? '≈' : '');
const mixCrowd = stopCrowd({ id: '', name: '', lngLat: [0, 0], riders: 1 }, p);
const pct = (x: number) => `${Math.round(x * 100)}%`;

console.log(`SPOKES: ${plan.scenario.name}`);
console.log('All figures are planning estimates.\n');
console.log(
  `Assumptions: ${p.cruiseKmh} km/h · ${p.ridersPerRow} abreast · ${p.rowSpacingM} m rows ` +
  `(${crowdMetresPerRider(mixCrowd, p).toFixed(2)} m/rider at the default age mix) · regroup ${p.regroupMin} min/pickup · merge hold ${p.mergeHoldMin} min · cushion ${p.slackPct}% · ` +
  (signals ? 'signals: Toronto Open Data, snapped within 15 m' : `signals ≈${p.signalsPerKmEstimate}/km (estimated)`) +
  ` · routes: ${routes ? 'OSRM road network, cached' : 'straight lines between via points'}`,
);
console.log(
  'Ages: ' + AGE_GROUPS.map((g) => {
    const a = p.ages[g];
    return `${a.label} ${pct(p.defaultAgeMix[g])} (${a.paceKmh} km/h, ${a.spaceFactor}× space)`;
  }).join(' · ') + ` · a group sets the pace at ≥${pct(p.paceSetShare)} of a column`,
);
console.log(
  `Limits: column ≤ ${p.thresholds.maxColumnM} m, blockage ≤ ${p.thresholds.maxBlockageS} s ` +
  `→ comfort max ≈ ${comfortMaxRiders(p, crowdMetresPerRider(mixCrowd, p))} riders per group; start ≥ ${p.thresholds.minStartRiders}; ` +
  `arrivals within ${p.thresholds.maxArrivalSpreadMin} min of ${p.targetMergeArrival}\n`,
);

for (const sp of plan.spokes) {
  console.log(`── ${sp.name.toUpperCase()} (${sp.area}) ${'─'.repeat(Math.max(0, 60 - sp.name.length - (sp.area?.length ?? 0)))}`);
  console.log(`  ${pad('time', 13)}${pad('stop', 20)}${rpad('join', 5)}${rpad('riders', 8)}${rpad('column', 8)}` +
    `${rpad('next leg', 10)}${rpad('km/h', 6)}${rpad('signals', 9)}${rpad('hold/int', 10)}`);
  sp.stops.forEach((st, i) => {
    const leg = sp.legs[i];
    const time = st.kind === 'pickup' ? `${hm(st.arriveS)}–${hm(st.departS)}` : hm(st.arriveS);
    const join = st.kind === 'merge' ? '' : `+${Math.round(st.ridersAfter - (i > 0 ? sp.stops[i - 1]!.ridersAfter : 0))}`;
    console.log(
      `  ${pad(time, 13)}${pad(st.stop.name + (st.stop.gather ? ' *' : ''), 20)}${rpad(join, 5)}` +
      `${rpad(st.kind === 'merge' ? '' : Math.round(st.ridersAfter), 8)}` +
      `${rpad(st.kind === 'merge' ? '' : `${Math.round(st.lengthAfterM)} m`, 8)}` +
      `${rpad(leg ? km(leg.distanceM) : '', 10)}` +
      `${rpad(leg ? leg.paceKmh : '', 6)}` +
      `${rpad(leg ? `${est(leg.signalsEstimated)}${leg.signals}` : '', 9)}` +
      `${rpad(leg ? `${Math.round(leg.blockageS)} s` : '', 10)}`,
    );
  });
  for (const st of sp.stops) if (st.stop.gather) console.log(`  * riders gather at ${st.stop.gather.name} and ride over to join`);
  if (sp.joins) console.log(`  → joins ${sp.joins.spokeName} at ${sp.joins.stopName} and rides on with it`);
  for (const o of plan.spokes) if (o.joins?.spokeId === sp.id) console.log(`  ← ${o.name} joins at ${o.joins.stopName}`);
  console.log(
    `  → ${km(sp.distanceM)} in ${mins(sp.durationS)} · start ${hm(sp.startS)} · head at merge ${hm(sp.headArriveMergeS)}, ` +
    `tail ${hm(sp.tailArriveMergeS)} · peak ${Math.round(sp.peakRiders)} riders / ${Math.round(sp.peakLengthM)} m · ` +
    `max hold ${Math.round(sp.maxBlockageS)} s · cross-streets held ${mins(sp.totalHoldS)} in total · ` +
    `marshals ${sp.marshals.total} (${sp.marshals.corkers} corking + ${sp.marshals.leadSweep} lead/sweep)\n`,
  );
}

const t = plan.terminal;
console.log(`── FINAL RIDE: ${plan.scenario.merge.name} → ${plan.scenario.destination.name} ${'─'.repeat(14)}`);
console.log(
  `  ${Math.round(t.riders)} riders (${Math.round(t.riders - t.joinAtMerge)} from spokes + ${Math.round(t.joinAtMerge)} joining at the merge) · ` +
  `column ${Math.round(t.lengthM)} m · ${km(t.distanceM)} at ${t.paceKmh} km/h`,
);
console.log(
  `  depart ${hm(t.departS)} · head arrives ${hm(t.headArriveS)} (${mins(t.durationS)}) · ` +
  `tail arrives ${hm(t.tailArriveS)}`,
);
console.log(
  `  holds each of ${est(t.signalsEstimated)}${t.signals} intersections for ${(t.blockageS / 60).toFixed(1)} min ` +
  `(${Math.round(t.blockageS)} s) · marshals ${t.marshals.total} (${t.marshals.corkers} corking + ${t.marshals.leadSweep} lead/sweep)\n`,
);

console.log(`Total riders: ${Math.round(plan.totalRiders)} · head arrivals at merge span ${mins(plan.arrivalSpreadS)}\n`);

const icon = { warn: '⚠ WARN', tradeoff: '◆ TRADE-OFF', info: 'ℹ INFO' } as const;
console.log(`FLAGS (${plan.flags.length})`);
for (const f of plan.flags) console.log(`  ${pad(icon[f.level], 12)} ${f.message}`);
