import { describe, expect, it } from 'vitest';
import { P, S } from './fixture';
import {
  addPickup, addSpoke, MAX_SPOKES, moveStop, removePickup, removeSpoke, startAtPickup, updateStop,
} from '../src/model/edit';
import { haversineM } from '../src/model/geo';
import { computePlan } from '../src/model/model';
import { decodePlan, encodePlan, planFromHash } from '../src/model/share';
import type { LngLat, Scenario } from '../src/model/types';

const west = (sc: Scenario) => sc.spokes.find((s) => s.id === 'west')!;
const has = (path: LngLat[], p: LngLat) => path.some((q) => q[0] === p[0] && q[1] === p[1]);

describe('edits keep the path invariant', () => {
  it('small move replaces the stop in place, keeping via points', () => {
    const p = west(S).pickups[1]!; // High Park
    const to: LngLat = [p.lngLat[0] + 0.0005, p.lngLat[1]];
    const sc = moveStop(S, p.id, to);
    expect(west(sc).path).toHaveLength(west(S).path!.length);
    expect(has(west(sc).path!, to)).toBe(true);
    expect(has(west(sc).path!, p.lngLat)).toBe(false);
    expect(west(S).pickups[1]!.lngLat).toEqual(p.lngLat); // original untouched
  });

  it('far move drops the via points between its neighbouring stops', () => {
    const p = west(S).pickups[1]!; // High Park: neighbours Runnymede and Dufferin
    const to: LngLat = [-79.466, 43.67]; // ~1.8 km north
    const path = west(moveStop(S, p.id, to)).path!;
    const iR = path.findIndex((q) => q === west(S).pickups[0]!.lngLat || (q[0] === west(S).pickups[0]!.lngLat[0] && q[1] === west(S).pickups[0]!.lngLat[1]));
    expect(path[iR + 1]).toEqual(to);
    expect(path[iR + 2]).toEqual(west(S).pickups[2]!.lngLat);
  });

  it('moving the start far keeps everything after the first pickup', () => {
    const sc = moveStop(S, west(S).start.id, [-79.56, 43.62]);
    expect(west(sc).path![0]).toEqual([-79.56, 43.62]);
    expect(west(sc).path![1]).toEqual(west(S).pickups[0]!.lngLat);
  });

  it('moving the merge updates every spoke end and the final ride start', () => {
    const to: LngLat = [-79.392, 43.6668];
    const sc = moveStop(S, S.merge.id, to);
    for (const sp of sc.spokes) expect(sp.path!.at(-1)).toEqual(to);
    expect(sc.terminalPath![0]).toEqual(to);
    expect(sc.merge.lngLat).toEqual(to);
  });

  it('moving the destination far resets the final ride path', () => {
    const sc = moveStop(S, S.destination.id, [-79.38, 43.645]);
    expect(sc.terminalPath).toEqual([S.merge.lngLat, [-79.38, 43.645]]);
  });

  it('addPickup lands in route order', () => {
    // Between Runnymede and High Park on Bloor.
    const sc = addPickup(S, 'west', [-79.4712, 43.6522], 'Clendenan', 30);
    expect(west(sc).pickups.map((p) => p.name)).toEqual(['Runnymede', 'Clendenan', 'High Park', 'Dufferin']);
    const plan = computePlan(sc, P);
    expect(plan.flags.some((f) => f.code === 'stop-order')).toBe(false);
    expect(plan.spokes[0]!.peakRiders).toBeCloseTo(330, 6);
  });

  it('removePickup drops it from pickups and path', () => {
    const p = west(S).pickups[0]!;
    const sc = removePickup(S, p.id);
    expect(west(sc).pickups).toHaveLength(2);
    expect(has(west(sc).path!, p.lngLat)).toBe(false);
  });

  it('startAtPickup carries earlier riders forward', () => {
    const east = S.spokes.find((s) => s.id === 'east')!;
    const sc = startAtPickup(S, east.pickups[0]!.id); // start at Main
    const e = sc.spokes.find((s) => s.id === 'east')!;
    expect(e.start.name).toBe('Main');
    expect(e.start.riders).toBe(95);
    expect(e.pickups.map((p) => p.name)).toEqual(['Woodbine', 'Pape']);
    expect(e.path![0]).toEqual(east.pickups[0]!.lngLat);
    expect(computePlan(sc, P).flags.some((f) => f.scope === 'east' && f.code === 'small-start')).toBe(false);
  });

  it('addSpoke / removeSpoke, capped at MAX_SPOKES', () => {
    let sc = addSpoke(S, [-79.45, 43.7]);
    expect(sc.spokes).toHaveLength(4);
    expect(sc.spokes[3]!.path).toEqual([[-79.45, 43.7], S.merge.lngLat]);
    for (let i = 0; i < 10; i++) sc = addSpoke(sc, [-79.45, 43.7 + i * 0.001]);
    expect(sc.spokes).toHaveLength(MAX_SPOKES);
    expect(removeSpoke(sc, sc.spokes[3]!.id).spokes).toHaveLength(MAX_SPOKES - 1);
    const ids = sc.spokes.flatMap((s) => [s.id, s.start.id]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('updateStop sets riders, name and ages; null clears ages', () => {
    const id = west(S).start.id;
    let sc = updateStop(S, id, { riders: 12.6, name: 'Kipling', ages: { kids: 0.5, adults: 0.5 } });
    expect(west(sc).start).toMatchObject({ riders: 13, name: 'Kipling', ages: { kids: 0.5, adults: 0.5 } });
    sc = updateStop(sc, id, { ages: null });
    expect(west(sc).start.ages).toBeUndefined();
  });

  it('a far drag on a straight-line spoke still plans', () => {
    const sc = moveStop(addSpoke(S, [-79.5, 43.75]), 'w0', [-79.55, 43.6]);
    expect(() => computePlan(sc, P)).not.toThrow();
    expect(haversineM(west(sc).start.lngLat, [-79.55, 43.6])).toBe(0);
  });
});

describe('share links', () => {
  it('round-trips scenario and changed params', async () => {
    const sc = updateStop(addPickup(S, 'west', [-79.4712, 43.6522], 'Clendenan', 30), 'n1', { ages: { kids: 0.3, adults: 0.7 } });
    const params = structuredClone(P);
    params.cruiseKmh = 11;
    params.thresholds.maxBlockageS = 85;
    params.targetMergeArrival = '13:15';
    const code = await encodePlan(sc, params, P);
    expect(code.length).toBeLessThan(2500);
    const back = await decodePlan(code, S, P);
    expect(back.params).toEqual(params);
    expect(computePlan(back.scenario, back.params).totalRiders).toBeCloseTo(computePlan(sc, params).totalRiders, 6);
    expect(back.scenario.spokes.map((s) => s.pickups.length)).toEqual([4, 3, 2]);
    expect(back.scenario.spokes[2]!.pickups[0]!.ages).toEqual({ kids: 0.3, adults: 0.7 });
  });

  it('default plan encodes small', async () => {
    expect((await encodePlan(S, P, P)).length).toBeLessThan(1500);
  });

  it('clamps hostile values and caps sizes', async () => {
    const evil = {
      v: 1,
      sc: {
        n: '<img src=x onerror=alert(1)>'.repeat(10),
        m: { id: 'merge', n: 'M', c: [-79.39, 43.66], r: 1e12 },
        d: { id: 'merge', n: 'D', c: [-79.38, 43.65], r: -5 }, // duplicate id
        s: Array.from({ length: 50 }, () => ({ st: { c: [-79.5, 43.7], r: 'lots' }, o: 9999, p: 'nope' })),
      },
      p: { cruiseKmh: 1e9, ridersPerRow: -3, thresholds: { maxBlockageS: NaN }, targetMergeArrival: '99:99', __proto__: { x: 1 } },
    };
    const bytes = new TextEncoder().encode(JSON.stringify(evil));
    const z = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
    const code = 'z' + Buffer.from(z).toString('base64url');
    const { scenario, params } = await decodePlan(code, S, P);
    expect(scenario.name.length).toBeLessThanOrEqual(80);
    expect(scenario.merge.riders).toBe(20000);
    expect(scenario.destination.riders).toBe(0);
    expect(scenario.destination.id).not.toBe(scenario.merge.id);
    expect(scenario.spokes).toHaveLength(MAX_SPOKES);
    expect(scenario.spokes[0]!.arrivalOffsetMin).toBe(120);
    expect(scenario.spokes[0]!.start.riders).toBe(0);
    expect(params.cruiseKmh).toBe(30);
    expect(params.ridersPerRow).toBe(1);
    expect(params.thresholds.maxBlockageS).toBe(P.thresholds.maxBlockageS);
    expect(params.targetMergeArrival).toBe(P.targetMergeArrival);
  });

  it('rejects junk', async () => {
    await expect(decodePlan('hello', S, P)).rejects.toThrow();
    await expect(decodePlan('zAAAA', S, P)).rejects.toThrow();
  });

  it('reads the plan from a hash', () => {
    expect(planFromHash('#plan=zabc&x=1')).toBe('zabc');
    expect(planFromHash('')).toBeNull();
  });
});
