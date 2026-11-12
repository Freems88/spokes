import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, DEFAULT_SCENARIO } from '../src/config';
import { computePlan, parseClock } from '../src/model/model';

/** Loose checks on the shipped plan; exact numbers live in the fixture-based tests. */
describe('shipped default plan', () => {
  const plan = computePlan(DEFAULT_SCENARIO, DEFAULT_PARAMS);
  it('West starts at Tom Riley Park', () => {
    expect(DEFAULT_SCENARIO.spokes.find((s) => s.id === 'west')!.start.name).toBe('Tom Riley Park');
  });
  it('has breathing room: cushion, regroups and merge hold', () => {
    expect(DEFAULT_PARAMS.slackPct).toBeGreaterThan(0);
    expect(DEFAULT_PARAMS.regroupMin).toBeGreaterThanOrEqual(5);
    expect(plan.terminal.departS - Math.max(...plan.spokes.map((s) => s.tailArriveMergeS))).toBeGreaterThanOrEqual(10 * 60);
  });
  it('keeps everything in late morning to early afternoon', () => {
    expect(Math.min(...plan.spokes.map((s) => s.startS))).toBeGreaterThan(parseClock('10:30'));
    expect(plan.terminal.tailArriveS).toBeLessThan(parseClock('13:30'));
  });
  it('totals 925 riders', () => expect(plan.totalRiders).toBeCloseTo(925, 6));
});
