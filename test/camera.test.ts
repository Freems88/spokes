import { describe, expect, it } from 'vitest';
import { atLeast, cameraTarget, MIN_SPAN_M } from '../src/model/camera';
import { haversineM } from '../src/model/geo';
import { computePlan } from '../src/model/model';
import { buildSim } from '../src/model/sim';
import type { LngLat } from '../src/model/types';
import { P, S } from './fixture';

const plan = computePlan(S, P);
const sim = buildSim(plan);
const at = (t: number) => cameraTarget(plan, sim.at(t));
const width = ([[x0, y0], [x1]]: [LngLat, LngLat]) => haversineM([x0, y0], [x1, y0]);
const contains = ([[x0, y0], [x1, y1]]: [LngLat, LngLat], [x, y]: LngLat) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

describe('follow camera', () => {
  const firstStart = Math.min(...plan.spokes.map((s) => s.startS));
  const allIn = Math.max(...plan.spokes.map((s) => s.tailArriveMergeS));

  it('runs overview → converge → merge → final', () => {
    expect(at(firstStart - 60).phase).toBe('overview');
    expect(at(firstStart + 60).phase).toBe('converge');
    expect(at(allIn + 30).phase).toBe('merge');
    expect(at(plan.terminal.departS + 30).phase).toBe('final');
  });

  it('tightens as the spokes come downtown', () => {
    const early = width(at(firstStart + 60).bounds);
    const mid = width(at((firstStart + allIn) / 2).bounds);
    const late = width(at(allIn - 120).bounds);
    expect(mid).toBeLessThan(early);
    expect(late).toBeLessThan(mid);
  });

  it('always keeps the merge point in frame while converging', () => {
    for (let t = firstStart; t < allIn; t += 300) expect(contains(at(t).bounds, S.merge.lngLat)).toBe(true);
  });

  it('final ride frames both the merge point and the destination', () => {
    const b = at(plan.terminal.departS + 60).bounds;
    expect(contains(b, S.merge.lngLat)).toBe(true);
    expect(contains(b, S.destination.lngLat)).toBe(true);
  });

  it('never frames less than the minimum span', () => {
    expect(width(at(allIn + 30).bounds)).toBeGreaterThanOrEqual(MIN_SPAN_M - 1);
    expect(width(atLeast([[-79.39, 43.66], [-79.39, 43.66]], 500))).toBeCloseTo(500, -1);
  });
});
