import { describe, expect, it } from 'vitest';
import { P, S } from './fixture';
import { applyData, waypointsKey, spokeWaypoints, type RoutesFile } from '../src/model/data';
import { lengthM } from '../src/model/geo';
import { computePlan } from '../src/model/model';
import { snapSignals } from '../src/model/signals';
import { buildSim } from '../src/model/sim';
import type { LngLat } from '../src/model/types';

const plan = computePlan(S, P);
const sim = buildSim(plan);
const total = plan.totalRiders;
const sumAt = (t: number) => {
  const s = sim.at(t);
  return s.blobs.reduce((a, b) => a + b.riders, 0) + s.columns.reduce((a, c) => a + c.riders, 0);
};

describe('sim', () => {
  it('conserves riders at every moment (within blob rounding)', () => {
    for (let t = sim.t0; t <= sim.t1; t += 37) expect(Math.abs(sumAt(t) - total)).toBeLessThan(3);
  });

  it('before anything starts: riders wait at their stops, no columns', () => {
    const s = sim.at(sim.t0);
    expect(s.columns).toHaveLength(0);
    expect(s.blobs.find((b) => b.id === 'merge')!.riders).toBeCloseTo(200, 6);
  });

  it('at the end everyone is at the destination', () => {
    const s = sim.at(sim.t1);
    expect(s.columns).toHaveLength(0);
    expect(s.blobs).toHaveLength(1);
    expect(s.blobs[0]!.kind).toBe('destination');
    expect(s.blobs[0]!.riders).toBeCloseTo(total, 6);
  });

  it('a column on the road is as long as the model says', () => {
    const west = plan.spokes.find((s) => s.id === 'west')!;
    const leg = west.legs.at(-1)!; // Dufferin → merge, 300 riders
    const t = (leg.departS + leg.arriveS) / 2;
    const col = sim.at(t).columns.find((c) => c.id === 'west')!;
    expect(col.headM - col.tailM).toBeCloseTo(leg.lengthM, 3);
    expect(lengthM(col.line)).toBeCloseTo(leg.lengthM, 0);
  });

  it('the column lengthens across a pickup', () => {
    const west = plan.spokes.find((s) => s.id === 'west')!;
    const dw = west.stops[3]!; // Dufferin
    const len = (t: number) => { const c = sim.at(t).columns.find((x) => x.id === 'west')!; return c.headM - c.tailM; };
    expect(len(dw.departS + 1)).toBeGreaterThan(len(dw.arriveS - 1) + 90);
  });

  it('final ride: head reaches City Hall at the planned time', () => {
    const t = plan.terminal.headArriveS - 1;
    const col = sim.at(t).columns.find((c) => c.id === 'terminal')!;
    expect(col.headM).toBeCloseTo(plan.terminal.distanceM - plan.terminal.paceKmh / 3.6, 1);
  });

  it('held signals are those under a column', () => {
    const sc = structuredClone(S);
    sc.terminalSignalsAlongM = [100, 500, 1500];
    const pl = computePlan(sc, P);
    const sm = buildSim(pl);
    // 2 min after departure the head is ~430 m out and the tail still at the merge.
    expect(sm.at(pl.terminal.departS + 120).heldSignals).toHaveLength(1);
  });
});

describe('signals + data', () => {
  const line: LngLat[] = [[-79.4, 43.65], [-79.38, 43.65]];
  it('snaps within 15 m, ignores farther, merges near-duplicates', () => {
    const sig: LngLat[] = [
      [-79.395, 43.65005], // 5.6 m off → in
      [-79.39498, 43.65], // ~2 m further along → same intersection
      [-79.39, 43.6503], // 33 m off → out
      [-79.385, 43.65],
    ];
    const along = snapSignals(line, sig);
    expect(along).toHaveLength(2);
    expect(along[0]!).toBeCloseTo(lengthM(line) / 4, -1);
  });

  it('applyData uses cached routes only when their waypoints still match', () => {
    const routed: LngLat[] = [S.spokes[0]!.start.lngLat, [-79.5, 43.66], S.merge.lngLat];
    const routes: RoutesFile = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { id: 'west', source: 'osrm-bike', detourRatio: 1, waypointsKey: waypointsKey(spokeWaypoints(S, 'west')) },
        geometry: { type: 'LineString', coordinates: routed },
      }],
    };
    expect(applyData(S, routes, null).spokes[0]!.path).toEqual(routed);
    const moved = structuredClone(S);
    moved.spokes[0]!.path![1] = [-79.6, 43.7];
    expect(applyData(moved, routes, null).spokes[0]!.path).toEqual(moved.spokes[0]!.path);
  });
});
