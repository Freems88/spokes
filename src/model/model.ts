/**
 * Spokes planning model. Pure and deterministic, with no DOM or network.
 *
 * Each group is a column moving at constant speed. Every number it produces
 * should be explainable in one sentence; the comments on each function give
 * that sentence.
 */
import { haversineM, lengthM, project } from './geo';
import { AGE_GROUPS } from './types';
import type {
  AgeGroup, Crowd, Flag, Leg, LngLat, Marshals, Params, Plan, Scenario, Spoke, SpokePlan, Stop, StopTiming,
  TerminalPlan,
} from './types';

/** Cruise speed in metres per second. */
export const speedMs = (p: Params) => p.cruiseKmh / 3.6;

/** Metres of road per rider: row spacing ÷ riders per row. */
export const metresPerRider = (p: Params) => p.rowSpacingM / p.ridersPerRow;

/** Column length = riders ÷ riders per row × row spacing. */
export const columnLengthM = (riders: number, p: Params) => Math.max(0, riders) * metresPerRider(p);

/** Blockage = time for the whole column to pass a corked intersection = length ÷ speed. */
export const blockageS = (riders: number, p: Params) => columnLengthM(riders, p) / speedMs(p);

/**
 * Marshals for one moving group, by role: a lead and a sweep, plus pairs of
 * corkers. A pair is in place a little before the head reaches a corner,
 * holds it until the tail clears, then rides up past the column to the next
 * free corner. We need enough pairs to cover the corners the column reaches
 * while the others are still catching up: pairs = cycle time × corners per second.
 */
export function marshalsFor(lengthM: number, paceMs: number, distanceM: number, signals: number, p: Params): Marshals {
  const m = p.marshals;
  const gain = Math.max(0.5, m.catchUpKmh / 3.6 - paceMs); // how fast corkers gain on the column
  const cycleS = m.setupS + lengthM / paceMs + (lengthM + paceMs * m.setupS) / gain;
  const cornersPerS = signals > 0 && distanceM > 0 ? (signals / distanceM) * paceMs : 0;
  const pairs = signals > 0 ? Math.min(signals, Math.max(1, Math.ceil(cycleS * cornersPerS))) : 0;
  const corkers = pairs * m.corkersPerIntersection;
  return { total: corkers + m.leadSweep, corkers, leadSweep: m.leadSweep, cycleS };
}

/** The busiest leg sets a group's marshal count. */
const maxMarshals = (ms: Marshals[], p: Params): Marshals =>
  ms.reduce((a, b) => (b.total > a.total ? b : a), { total: p.marshals.leadSweep, corkers: 0, leadSweep: p.marshals.leadSweep, cycleS: 0 });

/** The largest group that stays within both comfort thresholds. */
export const comfortMaxRiders = (p: Params, mPerRider = metresPerRider(p), speed = speedMs(p)) =>
  Math.floor(Math.min(p.thresholds.maxColumnM, p.thresholds.maxBlockageS * speed) / mPerRider);

// ── Age mix ──────────────────────────────────────────────────────────────

export const emptyCrowd = (): Crowd => ({ kids: 0, teens: 0, adults: 0, seniors: 0 });
export const crowdSize = (c: Crowd) => AGE_GROUPS.reduce((a, g) => a + c[g], 0);
export const addCrowds = (a: Crowd, b: Crowd): Crowd => {
  const out = emptyCrowd();
  for (const g of AGE_GROUPS) out[g] = a[g] + b[g];
  return out;
};

/** A stop's riders split by its age mix (or the default mix), normalised so shares sum to 1. */
export function stopCrowd(stop: Stop, p: Params): Crowd {
  const mix = stop.ages ?? p.defaultAgeMix;
  const total = AGE_GROUPS.reduce((a, g) => a + Math.max(0, mix[g] ?? 0), 0);
  const out = emptyCrowd();
  const riders = Math.max(0, stop.riders);
  for (const g of AGE_GROUPS) out[g] = total > 0 ? (riders * Math.max(0, mix[g] ?? 0)) / total : g === 'adults' ? riders : 0;
  return out;
}

/** Average road space per rider: each group's space weighted by its head-count. */
export function crowdMetresPerRider(c: Crowd, p: Params): number {
  const n = crowdSize(c);
  if (n === 0) return metresPerRider(p);
  return (AGE_GROUPS.reduce((a, g) => a + c[g] * p.ages[g].spaceFactor, 0) / n) * metresPerRider(p);
}

/** Column length = Σ riders in each group × that group's space per rider. */
export const crowdLengthM = (c: Crowd, p: Params) => crowdSize(c) * crowdMetresPerRider(c, p);

/** The column rides at cruise speed, or at the pace of its slowest age group that is ≥ paceSetShare of it. */
export function crowdPace(c: Crowd, p: Params): { kmh: number; setBy: AgeGroup | null } {
  const n = crowdSize(c);
  let kmh = p.cruiseKmh;
  let setBy: AgeGroup | null = null;
  if (n === 0) return { kmh, setBy };
  for (const g of AGE_GROUPS) {
    if (c[g] / n >= p.paceSetShare - 1e-9 && p.ages[g].paceKmh < kmh) {
      kmh = p.ages[g].paceKmh;
      setBy = g;
    }
  }
  return { kmh, setBy };
}


/**
 * Seconds to ride from a gathering place to its pickup: straight-line distance
 * × 1.4 for the streets, at the lead pace. Feeders leave this long before the
 * column arrives, so nobody waits on the corner.
 */
export const feederRideS = (stop: Stop, p: Params) =>
  stop.gather ? (haversineM(stop.gather.lngLat, stop.lngLat) * 1.4) / speedMs(p) : 0;

export function parseClock(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`Bad time "${hhmm}", expected HH:MM`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}

export function formatClock(s: number): string {
  const t = Math.round(s / 60);
  const h = Math.floor(t / 60) % 24;
  const m = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** The pickup a spoke joins, when `joinsAt` names a pickup on another (non-joining) spoke. */
export function joinTarget(sc: Scenario, spoke: Spoke): { host: Spoke; stop: Stop } | null {
  if (!spoke.joinsAt) return null;
  for (const host of sc.spokes) {
    if (host.id === spoke.id || host.joinsAt) continue;
    const stop = host.pickups.find((p) => p.id === spoke.joinsAt);
    if (stop) return { host, stop };
  }
  return null;
}

/** Where a spoke's route ends: the pickup it joins, or the merge point. */
export const spokeEnd = (sc: Scenario, spoke: Spoke): Stop => joinTarget(sc, spoke)?.stop ?? sc.merge;

/** Everyone a spoke picks up along its own route. */
export const spokeCrowd = (spoke: Spoke, p: Params): Crowd =>
  [spoke.start, ...spoke.pickups].reduce((c, s) => addCrowds(c, stopCrowd(s, p)), emptyCrowd());

/** Route used for a spoke: the cached path, or straight segments through its stops. */
export function spokePath(spoke: Spoke, mergeAt: LngLat): LngLat[] {
  const line = spoke.path && spoke.path.length >= 2
    ? [...spoke.path]
    : [spoke.start.lngLat, ...spoke.pickups.map((s) => s.lngLat)];
  if (haversineM(line.at(-1)!, mergeAt) > 1) line.push(mergeAt);
  return line;
}

export function terminalPath(sc: Scenario): LngLat[] {
  const line = sc.terminalPath && sc.terminalPath.length >= 2 ? [...sc.terminalPath] : [sc.merge.lngLat];
  if (haversineM(line.at(-1)!, sc.destination.lngLat) > 1) line.push(sc.destination.lngLat);
  return line;
}

/** Signals on [fromM, toM): real positions when we have them, otherwise distance × density. */
function countSignals(fromM: number, toM: number, along: number[] | undefined, p: Params) {
  if (along) return { signals: along.filter((s) => s >= fromM && s < toM).length, estimated: false };
  return { signals: Math.round(((toM - fromM) / 1000) * p.signalsPerKmEstimate), estimated: true };
}

/**
 * Lay out one spoke going forward from t = 0, then shift every time so the
 * head reaches the merge point at `arriveS`.
 */
function planSpoke(
  spoke: Spoke, sc: Scenario, p: Params, arriveS: number, flags: Flag[],
  joining: Map<string, Crowd> = new Map(), end: Stop = sc.merge,
): SpokePlan {
  const path = spokePath(spoke, end.lngLat);
  const total = lengthM(path);
  const regroupS = p.regroupMin * 60;
  const slack = 1 + Math.max(0, p.slackPct) / 100;

  // Place stops along the route, in order.
  const placed: { stop: Stop; kind: StopTiming['kind']; alongM: number; offRouteM: number }[] = [];
  let minAlong = 0;
  const stopsInOrder = [
    { stop: spoke.start, kind: 'start' as const },
    ...spoke.pickups.map((stop) => ({ stop, kind: 'pickup' as const })),
  ];
  for (const { stop, kind } of stopsInOrder) {
    const pr = project(path, stop.lngLat, minAlong);
    const free = project(path, stop.lngLat);
    if (free.alongM < minAlong - 50 && free.offsetM + 50 < pr.offsetM) {
      flags.push({
        level: 'warn', scope: spoke.id, code: 'stop-order',
        message: `${spoke.name}: "${stop.name}" sits behind the previous stop on the route. Reorder the pickups.`,
      });
    }
    if (pr.offsetM > p.thresholds.maxStopOffsetM) {
      flags.push({
        level: 'info', scope: spoke.id, code: 'stop-off-route',
        message: `${spoke.name}: "${stop.name}" is ${Math.round(pr.offsetM)} m from the route. Re-route or move the stop.`,
      });
    }
    placed.push({ stop, kind, alongM: pr.alongM, offRouteM: pr.offsetM });
    minAlong = pr.alongM;
  }
  placed.push({ stop: end, kind: 'merge', alongM: total, offRouteM: 0 });

  // Walk forward.
  const stops: StopTiming[] = [];
  const legs: Leg[] = [];
  let t = 0;
  let crowd = emptyCrowd();
  let lastSpeed = speedMs(p);
  for (let i = 0; i < placed.length; i++) {
    const cur = placed[i]!;
    const arrive = t;
    if (cur.kind !== 'merge') {
      crowd = addCrowds(crowd, stopCrowd(cur.stop, p));
      const joiners = joining.get(cur.stop.id);
      if (joiners) crowd = addCrowds(crowd, joiners);
    }
    const depart = cur.kind === 'pickup' ? arrive + regroupS : arrive;
    const riders = crowdSize(crowd);
    const len = crowdLengthM(crowd, p);
    stops.push({
      stop: cur.stop, kind: cur.kind, alongM: cur.alongM, arriveS: arrive, departS: depart,
      ridersAfter: riders, crowdAfter: { ...crowd }, lengthAfterM: len, offRouteM: cur.offRouteM,
    });
    const next = placed[i + 1];
    if (!next) break;
    const dist = Math.max(0, next.alongM - cur.alongM);
    const sig = countSignals(cur.alongM, next.alongM, spoke.signalsAlongM, p);
    const pace = crowdPace(crowd, p);
    const v = pace.kmh / 3.6;
    lastSpeed = v;
    legs.push({
      fromId: cur.stop.id, toId: next.stop.id, fromM: cur.alongM, toM: next.alongM, distanceM: dist,
      riders, crowd: { ...crowd }, paceKmh: pace.kmh, paceSetBy: pace.setBy, lengthM: len, blockageS: len / v,
      signals: sig.signals, signalsEstimated: sig.estimated, departS: depart, arriveS: depart + (dist / v) * slack,
    });
    t = depart + (dist / v) * slack;
  }

  const durationS = t;
  const shift = arriveS - durationS;
  for (const s of stops) { s.arriveS += shift; s.departS += shift; }
  for (const l of legs) { l.departS += shift; l.arriveS += shift; }

  const peakRiders = crowdSize(crowd);
  const peakLengthM = crowdLengthM(crowd, p);
  return {
    id: spoke.id, name: spoke.name, area: spoke.area,
    startS: shift, headArriveMergeS: arriveS, tailArriveMergeS: arriveS + peakLengthM / lastSpeed,
    distanceM: total - (placed[0]?.alongM ?? 0), durationS,
    startRiders: Math.max(0, spoke.start.riders), peakRiders, peakLengthM,
    maxBlockageS: Math.max(0, ...legs.map((l) => l.blockageS)),
    signals: legs.reduce((a, l) => a + l.signals, 0),
    totalHoldS: legs.reduce((a, l) => a + l.signals * l.blockageS, 0),
    marshals: maxMarshals(legs.map((l) => marshalsFor(l.lengthM, l.paceKmh / 3.6, l.distanceM, l.signals, p)), p),
    stops, legs, path,
  };
}

const sharePct = (c: Crowd, g: AgeGroup) => Math.round((c[g] / Math.max(1e-9, crowdSize(c))) * 100);

function spokeFlags(sp: SpokePlan, p: Params, flags: Flag[]) {
  const th = p.thresholds;
  // Pace: report the first leg where an age group slows the column.
  const slow = sp.legs.find((l) => l.paceSetBy);
  if (slow?.paceSetBy) {
    const from = sp.stops.find((s) => s.stop.id === slow.fromId)?.stop.name ?? slow.fromId;
    const g = slow.paceSetBy;
    flags.push({
      level: 'info', scope: sp.id, code: 'slow-pace',
      message: `${sp.name}: from ${from}, riders aged ${p.ages[g].label} are ${sharePct(slow.crowd, g)}% of the column, ` +
        `so it rides at ${slow.paceKmh} km/h instead of ${p.cruiseKmh}.`,
    });
  }
  // Length / blockage: report the worst leg.
  const worst = sp.legs.reduce<Leg | undefined>((w, l) => (!w || l.blockageS > w.blockageS ? l : w), undefined);
  if (!worst) return;
  const overLen = worst.lengthM > th.maxColumnM;
  const overBlock = worst.blockageS > th.maxBlockageS;
  if (!overLen && !overBlock) return;
  const from = sp.stops.find((s) => s.stop.id === worst.fromId)?.stop.name ?? worst.fromId;
  const max = comfortMaxRiders(p, crowdMetresPerRider(worst.crowd, p), worst.paceKmh / 3.6);
  flags.push({
    level: 'warn', scope: sp.id, code: overLen ? 'long-column' : 'long-blockage',
    message: `${sp.name}: after ${from} the column is ${Math.round(worst.lengthM)} m and holds each intersection ` +
      `${Math.round(worst.blockageS)} s (limits ${th.maxColumnM} m / ${th.maxBlockageS} s). ` +
      `Comfort max for this age mix and pace is ~${max} riders. Consider splitting this spoke.`,
  });
}

export function computePlan(sc: Scenario, p: Params): Plan {
  const flags: Flag[] = [];
  const target = parseClock(p.targetMergeArrival);
  const th = p.thresholds;

  // Spokes that join another at one of its pickups: their riders board there.
  const joins = new Map<string, { host: Spoke; stop: Stop }>();
  for (const s of sc.spokes) {
    const jt = joinTarget(sc, s);
    if (jt) joins.set(s.id, jt);
    else if (s.joinsAt) {
      flags.push({ level: 'info', scope: s.id, code: 'join', message: `${s.name}'s join point no longer exists, so it rides to ${sc.merge.name} on its own.` });
    }
  }
  const joining = new Map<string, Crowd>();
  for (const [id, jt] of joins) {
    const s = sc.spokes.find((x) => x.id === id)!;
    joining.set(jt.stop.id, addCrowds(joining.get(jt.stop.id) ?? emptyCrowd(), spokeCrowd(s, p)));
  }
  const planned = new Map<string, SpokePlan>();
  for (const s of sc.spokes) {
    if (!joins.has(s.id)) planned.set(s.id, planSpoke(s, sc, p, target + s.arrivalOffsetMin * 60, flags, joining));
  }
  // Joiners are timed to be at the join point a little before the host arrives.
  for (const [id, jt] of joins) {
    const s = sc.spokes.find((x) => x.id === id)!;
    const host = planned.get(jt.host.id)!;
    const hs = host.stops.find((x) => x.stop.id === jt.stop.id)!;
    const sp = planSpoke(s, sc, p, hs.arriveS - p.joinLeadMin * 60, flags, new Map(), jt.stop);
    sp.joins = { spokeId: host.id, spokeName: host.name, stopId: jt.stop.id, stopName: jt.stop.name };
    if (sp.tailArriveMergeS > hs.departS) {
      flags.push({
        level: 'warn', scope: s.id, code: 'join',
        message: `${s.name}'s last riders reach ${jt.stop.name} after ${host.name} leaves. Lengthen the stop there or have ${s.name} arrive earlier.`,
      });
    }
    planned.set(id, sp);
  }
  const spokes = sc.spokes.map((s) => planned.get(s.id)!);
  const toMerge = spokes.filter((s) => !s.joins);

  for (const sp of spokes) {
    const spoke = sc.spokes.find((s) => s.id === sp.id)!;
    if (sp.peakRiders === 0) {
      flags.push({ level: 'warn', scope: sp.id, code: 'empty', message: `${sp.name} has no riders.` });
      continue;
    }
    if (sp.startRiders < th.minStartRiders) {
      const first = spoke.pickups[0];
      const alt = first
        ? ` Or start at ${first.name} instead, with ${sp.startRiders + first.riders} riders from the start.`
        : '';
      flags.push({
        level: 'warn', scope: sp.id, code: 'small-start',
        message: `${sp.name} starts with ${sp.startRiders} riders (under ${th.minStartRiders}). ` +
          `Consider merging it with a neighbouring spoke.${alt}`,
      });
    }
    spokeFlags(sp, p, flags);
  }

  const heads = toMerge.map((s) => s.headArriveMergeS);
  const arrivalSpreadS = heads.length ? Math.max(...heads) - Math.min(...heads) : 0;
  if (arrivalSpreadS > th.maxArrivalSpreadMin * 60) {
    flags.push({
      level: 'warn', scope: 'plan', code: 'arrival-spread',
      message: `Spokes reach the merge point ${Math.round(arrivalSpreadS / 60)} min apart (limit ${th.maxArrivalSpreadMin} min). Early groups wait.`,
    });
  }

  // Terminal ride.
  const tPath = terminalPath(sc);
  const tDist = lengthM(tPath);
  const joinCrowd = stopCrowd(sc.merge, p);
  const crowd = toMerge.reduce((c, s) => addCrowds(c, s.stops.at(-1)!.crowdAfter), joinCrowd);
  const riders = crowdSize(crowd);
  // The final ride's own pace; a slow age group can still pull it lower.
  const pace = crowdPace(crowd, { ...p, cruiseKmh: p.finalPaceKmh });
  const v = pace.kmh / 3.6;
  const lastTail = toMerge.length ? Math.max(...toMerge.map((s) => s.tailArriveMergeS)) : target;
  const departS = lastTail + p.mergeHoldMin * 60;
  const len = crowdLengthM(crowd, p);
  const tSig = countSignals(0, tDist, sc.terminalSignalsAlongM, p);
  const block = len / v;
  /** Riding time = distance ÷ speed, plus the schedule cushion. */
  const tTravel = (tDist / v) * (1 + Math.max(0, p.slackPct) / 100);
  const terminal: TerminalPlan = {
    riders, crowd, paceKmh: pace.kmh, paceSetBy: pace.setBy, joinAtMerge: crowdSize(joinCrowd), lengthM: len, blockageS: block, distanceM: tDist,
    departS, headArriveS: departS + tTravel, tailArriveS: departS + tTravel + len / v,
    durationS: tTravel, signals: tSig.signals, signalsEstimated: tSig.estimated,
    totalHoldS: tSig.signals * block, marshals: marshalsFor(len, v, tDist, tSig.signals, p), path: tPath,
  };
  if (len > th.maxColumnM || block > th.maxBlockageS) {
    flags.push({
      level: 'tradeoff', scope: 'terminal', code: len > th.maxColumnM ? 'long-column' : 'long-blockage',
      message: `Final ride: ${Math.round(riders)} riders, a ${Math.round(len)} m column holding each of ~${tSig.signals} ` +
        `intersections for ${(block / 60).toFixed(1)} min. Over the limits by design: a short distance ` +
        `(${(tDist / 1000).toFixed(1)} km) traded for the big image.`,
    });
  }

  return { scenario: sc, params: p, spokes, terminal, totalRiders: riders, arrivalSpreadS, flags };
}
