/**
 * Where every rider is at time t. Pure: the map just draws what this returns.
 *
 * A column is a stretch of road [tail, head] along its route. It unspools
 * from its start point, stops at each pickup while the new riders join
 * (the column lengthens over the regroup), and spools into the merge point
 * (or the destination) as its tail arrives.
 */
import { cumulativeM, pointAlong, slice } from './geo';
import type { LngLat, Plan } from './types';

interface Motion { fromM: number; toM: number; departS: number; arriveS: number; v: number }
interface Dwell { alongM: number; arriveS: number; departS: number; ridersBefore: number; ridersAfter: number; lenBefore: number; lenAfter: number }

interface Run {
  id: string;
  path: LngLat[];
  cum: number[];
  startM: number;
  endM: number;
  startS: number;
  motions: Motion[];
  dwells: Dwell[];
  startRiders: number;
  startLen: number;
  peakRiders: number;
  peakLen: number;
  endHeadS: number;
  vLast: number;
}

export interface ColumnState {
  id: string;
  line: LngLat[];
  head: LngLat;
  headM: number;
  tailM: number;
  riders: number;
  lengthM: number;
  moving: boolean;
}

export interface Blob {
  id: string;
  lngLat: LngLat;
  riders: number;
  kind: 'start' | 'pickup' | 'merge' | 'destination';
}

export interface SimState {
  t: number;
  columns: ColumnState[];
  blobs: Blob[];
  /** Signals currently held by a column (between its tail and head). */
  heldSignals: LngLat[];
}

export interface Sim {
  t0: number;
  t1: number;
  /** Interesting moments for the scrubber: starts, merge, final departure, arrival. */
  marks: { t: number; label: string }[];
  at(t: number): SimState;
}

function spokeRuns(plan: Plan): Run[] {
  return plan.spokes.map((sp) => {
    const cum = cumulativeM(sp.path);
    const first = sp.stops[0]!;
    const lastLeg = sp.legs.at(-1);
    return {
      id: sp.id, path: sp.path, cum,
      startM: first.alongM, endM: cum.at(-1)!, startS: sp.startS,
      motions: sp.legs.map((l) => ({
        fromM: l.fromM, toM: l.toM, departS: l.departS, arriveS: l.arriveS, v: l.paceKmh / 3.6,
      })),
      dwells: sp.stops.slice(1, -1).map((st, i) => {
        const before = sp.stops[i]!;
        return {
          alongM: st.alongM, arriveS: st.arriveS, departS: st.departS,
          ridersBefore: before.ridersAfter, ridersAfter: st.ridersAfter,
          lenBefore: before.lengthAfterM, lenAfter: st.lengthAfterM,
        };
      }),
      startRiders: first.ridersAfter, startLen: first.lengthAfterM,
      peakRiders: sp.peakRiders, peakLen: sp.peakLengthM,
      endHeadS: sp.headArriveMergeS, vLast: lastLeg ? lastLeg.paceKmh / 3.6 : 1,
    };
  });
}

function terminalRun(plan: Plan): Run {
  const t = plan.terminal;
  const cum = cumulativeM(t.path);
  const v = t.paceKmh / 3.6;
  return {
    id: 'terminal', path: t.path, cum, startM: 0, endM: cum.at(-1)!, startS: t.departS,
    motions: [{ fromM: 0, toM: cum.at(-1)!, departS: t.departS, arriveS: t.headArriveS, v }],
    dwells: [], startRiders: t.riders, startLen: t.lengthM, peakRiders: t.riders, peakLen: t.lengthM,
    endHeadS: t.headArriveS, vLast: v,
  };
}

interface RunState {
  headM: number;
  tailM: number;
  riders: number;
  lengthM: number;
  moving: boolean;
  /** Share of the column not yet rolled out of its start point. */
  atStart: number;
  /** Share of the column already spooled into its end point. */
  atEnd: number;
  /** Per pickup: share of its riders who have joined. */
  joined: number[];
}

function runAt(r: Run, t: number): RunState | null {
  if (t < r.startS) return null;
  let riders = r.startRiders;
  let len = r.startLen;
  let head = r.startM;
  let moving = false;
  const joined = r.dwells.map((d) => {
    if (t <= d.arriveS) return 0;
    if (t >= d.departS) return 1;
    return (t - d.arriveS) / Math.max(1e-9, d.departS - d.arriveS);
  });
  r.dwells.forEach((d, i) => {
    const f = joined[i]!;
    if (f > 0) {
      riders = d.ridersBefore + f * (d.ridersAfter - d.ridersBefore);
      len = d.lenBefore + f * (d.lenAfter - d.lenBefore);
    }
  });
  for (const m of r.motions) {
    if (t >= m.departS) head = Math.min(m.toM, m.fromM + (t - m.departS) * m.v);
    if (t >= m.departS && t < m.arriveS) moving = true;
  }
  // Past the end, a virtual head keeps going so the tail can spool in.
  const virtualHead = t > r.endHeadS ? r.endM + (t - r.endHeadS) * r.vLast : head;
  const rawTail = virtualHead - len;
  if (rawTail >= r.endM) return null; // fully arrived
  const tail = Math.max(r.startM, rawTail);
  const atStart = len > 0 ? Math.max(0, Math.min(1, (r.startM - rawTail) / len)) : 0;
  const atEnd = len > 0 ? Math.max(0, Math.min(1, (virtualHead - r.endM) / len)) : 0;
  return { headM: Math.min(head, r.endM), tailM: Math.min(tail, r.endM), riders, lengthM: len, moving: moving || t > r.endHeadS, atStart, atEnd, joined };
}

export function buildSim(plan: Plan): Sim {
  const spokes = spokeRuns(plan);
  const term = terminalRun(plan);
  const sc = plan.scenario;
  const signalsAlong: Record<string, number[]> = { terminal: sc.terminalSignalsAlongM ?? [] };
  for (const s of sc.spokes) signalsAlong[s.id] = s.signalsAlongM ?? [];
  const t0 = Math.min(...spokes.map((r) => r.startS), term.startS) - 10 * 60;
  const t1 = plan.terminal.tailArriveS + 10 * 60;
  const signalPts = new Map<string, { along: number; pt: LngLat }[]>();
  for (const r of [...spokes, term]) {
    signalPts.set(r.id, (signalsAlong[r.id] ?? []).map((a) => ({ along: a, pt: pointAlong(r.path, a, r.cum) })));
  }

  const marks = [
    ...plan.spokes.map((s) => ({ t: s.startS, label: `${s.name} starts` })),
    { t: Math.max(...plan.spokes.map((s) => s.tailArriveMergeS)), label: 'All at merge' },
    { t: plan.terminal.departS, label: 'Final ride leaves' },
    { t: plan.terminal.headArriveS, label: 'Head at City Hall' },
  ].sort((a, b) => a.t - b.t);

  function at(t: number): SimState {
    const columns: ColumnState[] = [];
    const blobs: Blob[] = [];
    const held: LngLat[] = [];
    let mergeRiders = Math.max(0, plan.terminal.joinAtMerge);

    const pushColumn = (r: Run, s: RunState) => {
      if (s.headM - s.tailM > 0.5) {
        columns.push({
          id: r.id, line: slice(r.path, s.tailM, s.headM, r.cum), head: pointAlong(r.path, s.headM, r.cum),
          headM: s.headM, tailM: s.tailM, riders: s.riders * (1 - s.atStart - s.atEnd), lengthM: s.lengthM, moving: s.moving,
        });
        for (const sg of signalPts.get(r.id) ?? []) if (sg.along >= s.tailM && sg.along <= s.headM) held.push(sg.pt);
      }
    };

    spokes.forEach((r, i) => {
      const sp = sc.spokes[i]!;
      const s = runAt(r, t);
      const arrived = t >= r.endHeadS && !s;
      // Start point.
      const atStart = s ? s.atStart * s.riders : arrived ? 0 : r.startRiders;
      if (atStart > 0.5) blobs.push({ id: `${r.id}:start`, lngLat: sp.start.lngLat, riders: atStart, kind: 'start' });
      // Pickups.
      sp.pickups.forEach((pk, k) => {
        const joined = s ? s.joined[k]! : arrived ? 1 : 0;
        const waiting = Math.max(0, pk.riders) * (1 - joined);
        if (waiting > 0.5) blobs.push({ id: pk.id, lngLat: pk.lngLat, riders: waiting, kind: 'pickup' });
      });
      if (s) {
        pushColumn(r, s);
        mergeRiders += s.atEnd * r.peakRiders;
      } else if (arrived) mergeRiders += r.peakRiders;
    });

    const ts = runAt(term, t);
    const termDone = t >= term.endHeadS && !ts;
    if (ts) {
      pushColumn(term, ts);
      mergeRiders = ts.atStart * term.peakRiders;
      if (ts.atEnd > 0) blobs.push({ id: 'dest', lngLat: sc.destination.lngLat, riders: ts.atEnd * term.peakRiders, kind: 'destination' });
    } else if (termDone) {
      mergeRiders = 0;
      blobs.push({ id: 'dest', lngLat: sc.destination.lngLat, riders: term.peakRiders, kind: 'destination' });
    }
    if (mergeRiders > 0.5) blobs.push({ id: 'merge', lngLat: sc.merge.lngLat, riders: mergeRiders, kind: 'merge' });

    return { t, columns, blobs, heldSignals: held };
  }

  return { t0, t1, marks, at };
}
