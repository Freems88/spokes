import { describe, expect, it } from 'vitest';
import { CAMPAIGN, DEFAULT_PARAMS as P, DEFAULT_SCENARIO as S } from '../src/config';
import { removeSpoke, updateSpoke, updateStop } from '../src/model/edit';
import { computePlan, formatClock } from '../src/model/model';
import { findHtml, heroHtml, mapSteps, whyHtml } from '../src/story';
import type { Area } from '../src/model/geo';

const plan = computePlan(S, P);
const color = () => '#000';
// Two boxes standing in for municipalities: west half and east half of the city.
const areas: Area[] = [
  { name: 'Westside', polygons: [[[[-79.7, 43.5], [-79.4, 43.5], [-79.4, 43.9], [-79.7, 43.9], [-79.7, 43.5]]]] },
  { name: 'Eastside', polygons: [[[[-79.4, 43.5], [-79.1, 43.5], [-79.1, 43.9], [-79.4, 43.9], [-79.4, 43.5]]]] },
];

describe('page copy', () => {
  it('hero: counts and arrival time from the plan; empty campaign fields are left out', () => {
    const h = heroHtml(plan);
    expect(h).toContain('>925<');
    expect(h).toContain(formatClock(plan.terminal.headArriveS));
    expect(h).not.toContain('class="cause"');
    expect(CAMPAIGN.cause).toBe(''); // placeholders stay empty until filled in
  });

  it('find your spoke lists every stop with its time', () => {
    const f = findHtml(plan, areas, color);
    for (const sp of plan.spokes) {
      for (const st of sp.stops.slice(0, -1)) expect(f).toContain(st.stop.name.replace('&', '&amp;'));
      expect(f).toContain(formatClock(sp.startS));
    }
    expect(f).toContain('Downtown');
    expect(f).toContain(formatClock(plan.terminal.departS));
  });

  it('story steps name the areas the starts fall in, and follow the plan', () => {
    const steps = mapSteps(plan, areas);
    expect(steps.map((s) => s.id)).toEqual(['city', 'grow', 'short', 'merge', 'final', 'arrive']);
    expect(steps[0]!.html).toContain('Westside and Eastside');
    const smaller = computePlan(removeSpoke(removeSpoke(S, 'east'), 'north'), P);
    expect(mapSteps(smaller, areas)[0]!.html).toContain('a small group rolls');
  });

  it('why: the everyone-in-one-line hold is the model figure', () => {
    expect(whyHtml(plan)).toMatch(/4\.\d minutes/);
  });

  it('escapes names from shared plans', () => {
    const evil = updateStop(updateSpoke(S, 'west', { name: '<b>x</b>' }), 'w0', { name: '<img src=x onerror=1>' });
    const pl = computePlan(evil, P);
    const html = findHtml(pl, null, color) + mapSteps(pl, null).map((s) => s.html).join('');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>x');
  });
});
