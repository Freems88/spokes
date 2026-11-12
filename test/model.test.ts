import { describe, expect, it } from 'vitest';
import { P, S } from './fixture';
import { haversineM, lengthM, project, slice } from '../src/model/geo';
import {
  blockageS, columnLengthM, comfortMaxRiders, computePlan, crowdLengthM, crowdMarshals, crowdMetresPerRider,
  crowdPace, formatClock, marshalsFor, parseClock, stopCrowd,
} from '../src/model/model';
import type { Crowd, Scenario, Stop } from '../src/model/types';

const clone = <T>(x: T): T => structuredClone(x);

describe('column basics (spec sanity tests)', () => {
  it('defaults give ~1 m per rider', () => {
    expect(columnLengthM(1, P)).toBeCloseTo(1, 6);
  });
  it('200 riders → ~200 m and ~55 s at 13 km/h', () => {
    expect(columnLengthM(200, P)).toBeCloseTo(200, 6);
    expect(blockageS(200, P)).toBeCloseTo(55.4, 1);
  });
  it('950 riders → ~950 m and ~4.4 min', () => {
    expect(columnLengthM(950, P)).toBeCloseTo(950, 6);
    expect(blockageS(950, P) / 60).toBeCloseTo(4.38, 2);
  });
  it('marshals: 1 per 20–25, rounded up', () => {
    expect(marshalsFor(300, P)).toEqual({ low: 12, high: 15 });
    expect(marshalsFor(1, P)).toEqual({ low: 1, high: 1 });
  });
  it('comfort max is set by the tighter threshold (75 s ≈ 271 m at 13 km/h)', () => {
    expect(comfortMaxRiders(P)).toBe(270);
  });
});

describe('age mix', () => {
  const stop = (riders: number, ages?: Partial<Crowd>): Stop => ({ id: 's', name: 's', lngLat: [0, 0], riders, ages });
  const allAdults = { kids: 0, teens: 0, adults: 1, seniors: 0 };

  it('an all-adult crowd reproduces the base sanity numbers', () => {
    const c = stopCrowd(stop(200, allAdults), P);
    expect(crowdLengthM(c, P)).toBeCloseTo(200, 6);
    expect(crowdPace(c, P)).toEqual({ kmh: 13, setBy: null });
  });
  it('shares are normalised and missing groups are zero', () => {
    const c = stopCrowd(stop(100, { kids: 1, adults: 3 }), P);
    expect(c).toEqual({ kids: 25, teens: 0, adults: 75, seniors: 0 });
  });
  it('default mix: ~1.04 m per rider (kids take 1.6×, seniors 1.1×)', () => {
    const c = stopCrowd(stop(1000), P);
    expect(crowdMetresPerRider(c, P)).toBeCloseTo(0.05 * 1.6 + 0.05 + 0.78 + 0.12 * 1.1, 6);
  });
  it('pace: slowest group at ≥10% sets it; under 10% it does not', () => {
    expect(crowdPace(stopCrowd(stop(100, { kids: 0.09, adults: 0.91 }), P), P).kmh).toBe(13);
    expect(crowdPace(stopCrowd(stop(100, { kids: 0.1, adults: 0.9 }), P), P)).toEqual({ kmh: 10, setBy: 'kids' });
  });
  it('pace never exceeds cruise even if every group could go faster', () => {
    expect(crowdPace(stopCrowd(stop(100, { teens: 1 }), P), P).kmh).toBe(P.cruiseKmh);
  });
  it('marshals: each child counts as two riders', () => {
    expect(crowdMarshals(stopCrowd(stop(100, { kids: 0.5, adults: 0.5 }), P), P)).toEqual(marshalsFor(150, P));
  });
  it('zero riders → zero length, cruise pace', () => {
    const c = stopCrowd(stop(0), P);
    expect(crowdLengthM(c, P)).toBe(0);
    expect(crowdPace(c, P).kmh).toBe(13);
  });
});

describe('clock', () => {
  it('round-trips', () => {
    expect(parseClock('12:30')).toBe(45000);
    expect(formatClock(45000)).toBe('12:30');
    expect(formatClock(45029)).toBe('12:30');
    expect(formatClock(45031)).toBe('12:31');
  });
  it('rejects junk', () => expect(() => parseClock('noon')).toThrow());
});

describe('geo', () => {
  it('haversine: 1° of latitude ≈ 111.2 km', () => {
    expect(haversineM([0, 0], [0, 1])).toBeCloseTo(111_195, -1);
  });
  it('project onto a line', () => {
    const line: [number, number][] = [[-79.4, 43.65], [-79.38, 43.65]];
    const pr = project(line, [-79.39, 43.6501]);
    expect(pr.alongM).toBeCloseTo(lengthM(line) / 2, -1);
    expect(pr.offsetM).toBeCloseTo(11.1, 0);
  });
  it('project respects minAlong', () => {
    const line: [number, number][] = [[0, 0], [0, 0.01], [0, 0.02]];
    expect(project(line, [0, 0], 1000).alongM).toBeCloseTo(1000, 0);
  });
  it('slice length equals the requested span', () => {
    const line = S.spokes[0]!.path!;
    expect(lengthM(slice(line, 1000, 1300))).toBeCloseTo(300, 0);
  });
});

describe('plan', () => {
  const plan = computePlan(S, P);

  it('heads reach the merge at target + offset', () => {
    for (const sp of plan.spokes) {
      const offset = S.spokes.find((s) => s.id === sp.id)!.arrivalOffsetMin;
      expect(sp.headArriveMergeS).toBeCloseTo(parseClock(P.targetMergeArrival) + offset * 60, 6);
      expect(sp.stops.at(-1)!.arriveS).toBeCloseTo(sp.headArriveMergeS, 6);
    }
  });

  it('duration = distance ÷ speed + one regroup per pickup', () => {
    for (const sp of plan.spokes) {
      const pickups = S.spokes.find((s) => s.id === sp.id)!.pickups.length;
      expect(sp.legs.every((l) => l.paceKmh === P.cruiseKmh)).toBe(true); // default mix doesn't slow anyone
      expect(sp.durationS).toBeCloseTo(sp.distanceM / (P.cruiseKmh / 3.6) + pickups * P.regroupMin * 60, 3);
    }
  });

  it('pickups lengthen the column monotonically to the stated totals', () => {
    const totals = { west: 300, east: 250, north: 175 } as Record<string, number>;
    for (const sp of plan.spokes) {
      const r = sp.legs.map((l) => l.riders);
      expect(r).toEqual([...r].sort((a, b) => a - b));
      expect(sp.peakRiders).toBeCloseTo(totals[sp.id]!, 6);
    }
  });

  it('terminal = all spoke riders + downtown joiners', () => {
    expect(plan.terminal.riders).toBeCloseTo(300 + 250 + 175 + 200, 6);
    expect(plan.terminal.departS).toBeGreaterThan(Math.max(...plan.spokes.map((s) => s.tailArriveMergeS)));
  });

  it('spoke distances are plausible (10–16 km) and stops sit on the route', () => {
    for (const sp of plan.spokes) {
      expect(sp.distanceM).toBeGreaterThan(10_000);
      expect(sp.distanceM).toBeLessThan(16_000);
      for (const st of sp.stops) expect(st.offRouteM).toBeLessThan(30);
    }
  });

  it('flags: the defaults trip small-start (W, E), long-column (W) and the terminal trade-off', () => {
    const keys = plan.flags.map((f) => `${f.scope}:${f.code}:${f.level}`).sort();
    expect(keys).toEqual([
      'east:small-start:warn',
      'terminal:long-column:tradeoff',
      'west:long-column:warn',
      'west:small-start:warn',
    ]);
  });

  it('a family pickup (30% kids) slows the column from there on and is flagged', () => {
    const sc: Scenario = clone(S);
    sc.spokes[2]!.pickups[0]!.ages = { kids: 0.3, adults: 0.6, seniors: 0.1 };
    const pl = computePlan(sc, P);
    const north = pl.spokes.find((s) => s.id === 'north')!;
    expect(north.legs.map((l) => l.paceKmh)).toEqual([13, 10, 10]);
    expect(north.legs[1]!.paceSetBy).toBe('kids');
    expect(pl.flags.some((f) => f.scope === 'north' && f.code === 'slow-pace')).toBe(true);
    // Slower legs mean an earlier start for the same arrival.
    expect(north.startS).toBeLessThan(plan.spokes.find((s) => s.id === 'north')!.startS);
  });

  it('arrival spread flag fires past the window', () => {
    const sc: Scenario = clone(S);
    sc.spokes[2]!.arrivalOffsetMin = -15;
    expect(computePlan(sc, P).flags.some((f) => f.code === 'arrival-spread')).toBe(true);
  });

  it('falls back to straight segments when a spoke has no path', () => {
    const sc: Scenario = clone(S);
    delete sc.spokes[0]!.path;
    const sp = computePlan(sc, P).spokes[0]!;
    expect(sp.path.length).toBe(1 + 3 + 1);
    expect(sp.distanceM).toBeLessThan(computePlan(S, P).spokes[0]!.distanceM);
  });

  it('real signal positions override the estimate', () => {
    const sc: Scenario = clone(S);
    sc.terminalSignalsAlongM = [100, 500, 900];
    const t = computePlan(sc, P).terminal;
    expect(t.signals).toBe(3);
    expect(t.signalsEstimated).toBe(false);
  });

  it('flags a pickup placed behind the previous stop', () => {
    const sc: Scenario = clone(S);
    const w = sc.spokes[0]!;
    [w.pickups[0], w.pickups[2]] = [w.pickups[2]!, w.pickups[0]!];
    expect(computePlan(sc, P).flags.some((f) => f.code === 'stop-order' && f.scope === 'west')).toBe(true);
  });

  it('the schedule cushion stretches riding time, not stops', () => {
    const plain = computePlan(S, P).spokes[0]!;
    const padded = computePlan(S, { ...P, slackPct: 10 }).spokes[0]!;
    const ride = (sp: typeof plain) => sp.legs.reduce((a, l) => a + (l.arriveS - l.departS), 0);
    expect(ride(padded)).toBeCloseTo(ride(plain) * 1.1, 3);
    expect(padded.durationS - ride(padded)).toBeCloseTo(plain.durationS - ride(plain), 3); // same regroups
    expect(padded.maxBlockageS).toBeCloseTo(plain.maxBlockageS, 6); // corner holds use the real pace
  });

  it('is deterministic', () => {
    expect(JSON.stringify(computePlan(S, P))).toBe(JSON.stringify(plan));
  });
});
