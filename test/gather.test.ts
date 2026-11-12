import { describe, expect, it } from 'vitest';
import { computePlan, feederRideS, formatClock } from '../src/model/model';
import { decodePlan, encodePlan } from '../src/model/share';
import { buildSim } from '../src/model/sim';
import type { LngLat, Scenario } from '../src/model/types';
import { findHtml } from '../src/story';
import { P, S } from './fixture';

/** Fixture with West's Dufferin pickup fed from Dufferin Grove Park. */
const grove: LngLat = [-79.43245, 43.65621];
const sc: Scenario = structuredClone(S);
const duff = sc.spokes[0]!.pickups.find((p) => p.id === 'w3')!;
duff.gather = { name: 'Dufferin Grove Park', lngLat: grove };
const plan = computePlan(sc, P);

describe('gathering places off the route', () => {
  it('do not change the route or timetable', () => {
    expect(plan.spokes[0]!.durationS).toBeCloseTo(computePlan(S, P).spokes[0]!.durationS, 6);
  });

  it('feeders leave early enough to meet the column as it stops (~300 m at 12–13 km/h ≈ 2 min)', () => {
    const s = feederRideS(duff, P);
    expect(s).toBeGreaterThan(60);
    expect(s).toBeLessThan(P.regroupMin * 60 + 120);
    const st = plan.spokes[0]!.stops.find((x) => x.stop.id === 'w3')!;
    const html = findHtml(plan, null, () => '#000');
    expect(html).toContain('Dufferin Grove Park');
    expect(html).toContain(`leave at ${formatClock(st.arriveS - Math.ceil(s / 60) * 60)}`);
  });

  it('waiting riders are drawn at the park until they join', () => {
    const st = plan.spokes[0]!.stops.find((x) => x.stop.id === 'w3')!;
    const blob = buildSim(plan).at(st.arriveS - 600).blobs.find((b) => b.id === 'w3')!;
    expect(blob.lngLat).toEqual(grove);
  });

  it('survive a share link', async () => {
    const back = await decodePlan(await encodePlan(sc, P, P), S, P);
    expect(back.scenario.spokes[0]!.pickups.find((p) => p.id === 'w3')!.gather).toEqual({ name: 'Dufferin Grove Park', lngLat: grove });
  });
});
