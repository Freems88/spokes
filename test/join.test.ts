import { describe, expect, it } from 'vitest';
import { INTERSECTIONS as I } from '../src/config';
import { moveStop, removePickup, removeSpoke, setJoin } from '../src/model/edit';
import { computePlan } from '../src/model/model';
import { decodePlan, encodePlan } from '../src/model/share';
import { buildSim } from '../src/model/sim';
import type { Scenario } from '../src/model/types';
import { findHtml } from '../src/story';
import { P, S } from './fixture';

/** Fixture where North rides down to Bloor & Sherbourne and joins East there. */
const sc: Scenario = structuredClone(S);
const east = sc.spokes.find((s) => s.id === 'east')!;
const north = sc.spokes.find((s) => s.id === 'north')!;
east.pickups.push({ id: 'e9', name: 'Bloor & Sherbourne', lngLat: I.bloorSherbourne, riders: 0 });
north.joinsAt = 'e9';
north.path = [I.yongeSheppard, I.yongeEglinton, I.yongeStClair, I.bloorSherbourne];
const plan = computePlan(sc, P);
const pe = plan.spokes.find((s) => s.id === 'east')!;
const pn = plan.spokes.find((s) => s.id === 'north')!;

describe('one spoke joining another', () => {
  it("adds the joiner's riders to the host at the join point, without double counting", () => {
    expect(pn.joins).toMatchObject({ spokeId: 'east', stopId: 'e9' });
    expect(pe.peakRiders).toBeCloseTo(250 + 175, 6);
    expect(plan.totalRiders).toBeCloseTo(computePlan(S, P).totalRiders, 6);
  });

  it('times the joiner to arrive first, and its tail before the host leaves', () => {
    const hs = pe.stops.find((s) => s.stop.id === 'e9')!;
    expect(pn.headArriveMergeS).toBeCloseTo(hs.arriveS - P.joinLeadMin * 60, 6);
    expect(pn.tailArriveMergeS).toBeLessThan(hs.departS);
    expect(plan.flags.some((f) => f.code === 'join')).toBe(false);
  });

  it('only spokes that ride to the merge count toward the arrival window', () => {
    expect(plan.arrivalSpreadS).toBeCloseTo(Math.abs(pe.headArriveMergeS - plan.spokes.find((s) => s.id === 'west')!.headArriveMergeS), 6);
  });

  it('the animation conserves riders through the join', () => {
    const sim = buildSim(plan);
    for (let t = sim.t0; t <= sim.t1; t += 41) {
      const s = sim.at(t);
      const sum = s.blobs.reduce((a, b) => a + b.riders, 0) + s.columns.reduce((a, c) => a + c.riders, 0);
      expect(Math.abs(sum - plan.totalRiders)).toBeLessThan(3);
    }
  });

  it('the timetable says where North meets East', () => {
    const html = findHtml(plan, null, () => '#000');
    expect(html).toContain('meets East and rides on with it');
    expect(html).toContain('North joins here');
  });

  it('a missing join point falls back to the merge, with a note', () => {
    const lost = removePickup(sc, 'e9');
    expect(lost.spokes.find((s) => s.id === 'north')!.joinsAt).toBeUndefined();
    expect(lost.spokes.find((s) => s.id === 'north')!.path!.at(-1)).toEqual(S.merge.lngLat);
    const gone = removeSpoke(sc, 'east');
    expect(computePlan(gone, P).spokes.find((s) => s.id === 'north')!.joins).toBeUndefined();
  });

  it('moving the join point drags the joiner along', () => {
    const to: [number, number] = [I.bloorSherbourne[0] + 0.0005, I.bloorSherbourne[1]];
    expect(moveStop(sc, 'e9', to).spokes.find((s) => s.id === 'north')!.path!.at(-1)).toEqual(to);
  });

  it('setJoin switches a spoke between the merge and a join', () => {
    const back = setJoin(sc, 'north', null);
    expect(back.spokes.find((s) => s.id === 'north')!.path!.at(-1)).toEqual(S.merge.lngLat);
    const again = setJoin(back, 'north', 'e9');
    expect(again.spokes.find((s) => s.id === 'north')!.path!.at(-1)).toEqual(I.bloorSherbourne);
    expect(setJoin(sc, 'east', 'w1')).toBe(sc); // East is joined by North, so it can't join anyone
  });

  it('survives a share link', async () => {
    const back = await decodePlan(await encodePlan(sc, P, P), S, P);
    expect(back.scenario.spokes.find((s) => s.id === 'north')!.joinsAt).toBe('e9');
  });
});
