/**
 * Two small SVG charts for the essay sections. Text uses ink tokens; colour
 * only marks identity (each spoke) or the one highlighted series.
 */
import { esc } from './editor';
import type { Plan } from './model/types';
import { groupBars, holdCurve, keyNumbers } from './story';

const r = Math.round;
const fmtHold = (s: number) => (s < 90 ? `${r(s)} s` : `${(s / 60).toFixed(1)} min`);

/** Section 1: seconds each corner is held vs riders in one group. */
export function renderHoldChart(el: HTMLElement, plan: Plan): void {
  const p = plan.params;
  const k = keyNumbers(plan);
  const maxN = Math.max(1000, Math.ceil(k.all / 100) * 100);
  const data = holdCurve(p, maxN);
  const maxY = Math.max(300, Math.ceil(k.holdFor(maxN) / 60) * 60);
  const W = 640, H = 300, m = { l: 52, r: 16, t: 16, b: 40 };
  const x = (n: number) => m.l + (n / maxN) * (W - m.l - m.r);
  const y = (s: number) => H - m.b - (s / maxY) * (H - m.t - m.b);
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(d.riders).toFixed(1)},${y(d.holdS).toFixed(1)}`).join('');
  const yTicks = Array.from({ length: maxY / 60 + 1 }, (_, i) => i * 60);
  const xTicks = Array.from({ length: maxN / 200 + 1 }, (_, i) => i * 200);
  const lim = p.thresholds.maxBlockageS;
  const biggest = Math.max(...plan.spokes.map((s) => s.peakRiders), 0);
  const marks = [
    ...(biggest ? [{ n: biggest, label: `Our biggest spoke (${r(biggest)}): ${fmtHold(k.holdFor(biggest))}` }] : []),
    { n: k.all, label: `Everyone in one line (${Math.round(k.all).toLocaleString('en-CA')}): ${fmtHold(k.holdFor(k.all))}` },
  ];

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img"
      aria-label="Line chart: the time an intersection waits rises in a straight line with group size, from 0 to ${fmtHold(k.holdFor(maxN))} at ${maxN} riders. ${esc(marks.map((mk) => mk.label).join('. '))}.">
      <g class="grid">${yTicks.map((s) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(s)}" y2="${y(s)}"/>`).join('')}</g>
      <g class="axis">
        ${yTicks.map((s) => `<text x="${m.l - 8}" y="${y(s) + 4}" text-anchor="end">${s ? `${s / 60} min` : '0'}</text>`).join('')}
        ${xTicks.map((n) => `<text x="${x(n)}" y="${H - m.b + 18}" text-anchor="middle">${n}</text>`).join('')}
        <text x="${(m.l + W - m.r) / 2}" y="${H - 4}" text-anchor="middle" class="title">riders in one group</text>
      </g>
      <line class="limit" x1="${m.l}" x2="${W - m.r}" y1="${y(lim)}" y2="${y(lim)}"/>
      <text class="limit-label" x="${W - m.r}" y="${y(lim) + 16}" text-anchor="end">comfortable: under ${lim} s</text>
      <path d="${path}" class="series"/>
      ${marks.map((mk) => `
        <circle cx="${x(mk.n)}" cy="${y(k.holdFor(mk.n))}" r="5" class="dot"/>
        <text x="${x(mk.n) + (mk.n > maxN * 0.7 ? -10 : 12)}" y="${y(k.holdFor(mk.n)) + (mk.n > maxN * 0.7 ? -12 : 20)}" text-anchor="${mk.n > maxN * 0.7 ? 'end' : 'start'}" class="label">${esc(mk.label)}</text>`).join('')}
      <g class="hover" visibility="hidden">
        <line class="cross" y1="${m.t}" y2="${H - m.b}"/>
        <circle r="5" class="dot"/>
        <rect class="tip" rx="6" height="40" width="150"/>
        <text class="tiptext"><tspan class="a"></tspan><tspan class="b" dy="16"></tspan></text>
      </g>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/>
    </svg>
    <details class="table"><summary>Show as table</summary>
      <table><thead><tr><th>Riders</th><th>Column</th><th>Each corner held</th></tr></thead>
      <tbody>${data.filter((d) => d.riders % 100 === 0).map((d) => `<tr><td>${d.riders}</td><td>${r(d.lengthM)} m</td><td>${fmtHold(d.holdS)}</td></tr>`).join('')}</tbody></table>
    </details>`;

  const svg = el.querySelector('svg')!;
  const hover = svg.querySelector<SVGGElement>('.hover')!;
  const [cross, dot, tip] = [hover.querySelector('line')!, hover.querySelector('circle')!, hover.querySelector('rect')!];
  const [ta, tb] = [hover.querySelector<SVGTSpanElement>('.a')!, hover.querySelector<SVGTSpanElement>('.b')!];
  const move = (clientX: number) => {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    const sx = pt.matrixTransform(svg.getScreenCTM()!.inverse()).x;
    const n = Math.max(0, Math.min(maxN, Math.round(((sx - m.l) / (W - m.l - m.r)) * maxN / 10) * 10));
    const d = data.find((q) => q.riders === n) ?? data.at(-1)!;
    const px = x(d.riders), py = y(d.holdS);
    hover.setAttribute('visibility', 'visible');
    cross.setAttribute('x1', String(px)); cross.setAttribute('x2', String(px));
    dot.setAttribute('cx', String(px)); dot.setAttribute('cy', String(py));
    const tx = px + 160 > W ? px - 160 : px + 10;
    const ty = Math.max(m.t, py - 50);
    tip.setAttribute('x', String(tx)); tip.setAttribute('y', String(ty));
    ta.setAttribute('x', String(tx + 10)); tb.setAttribute('x', String(tx + 10));
    hover.querySelector('text')!.setAttribute('y', String(ty + 16));
    ta.textContent = `${d.riders} riders · ${r(d.lengthM)} m`;
    tb.textContent = `each corner held ${fmtHold(d.holdS)}`;
  };
  const hit = svg.querySelector('.hit')!;
  hit.addEventListener('pointermove', (e) => move((e as PointerEvent).clientX));
  hit.addEventListener('pointerleave', () => hover.setAttribute('visibility', 'hidden'));
}

/** Section 2: each group's largest size against the sweet-spot band. */
export function renderGroupsChart(el: HTMLElement, plan: Plan, colorOf: (id: string) => string): void {
  const k = keyNumbers(plan);
  const bars = groupBars(plan);
  const maxN = Math.max(1000, Math.ceil(Math.max(...bars.map((b) => b.riders)) / 100) * 100);
  const W = 640, rowH = 34, m = { l: 92, r: 16, t: 26, b: 30 };
  const H = m.t + m.b + bars.length * rowH;
  const x = (n: number) => m.l + (n / maxN) * (W - m.l - m.r);
  const lo = 150, hi = k.comfortMax;
  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img"
      aria-label="Bar chart of each group's largest size against a sweet spot of ${lo} to ${hi} riders. ${esc(bars.map((b) => `${b.name} ${r(b.riders)}`).join(', '))}.">
      <rect class="band" x="${x(lo)}" y="${m.t - 8}" width="${x(hi) - x(lo)}" height="${H - m.t - m.b + 8}"/>
      <text class="band-label" x="${(x(lo) + x(hi)) / 2}" y="${m.t - 12}" text-anchor="middle">sweet spot ${lo}–${hi}</text>
      <g class="axis">${Array.from({ length: maxN / 200 + 1 }, (_, i) => i * 200)
        .map((n) => `<text x="${x(n)}" y="${H - 8}" text-anchor="middle">${n}</text>`).join('')}</g>
      ${bars.map((b, i) => {
        const yy = m.t + i * rowH + 6;
        const over = b.riders > hi;
        const label = `${r(b.riders)} · ${r(b.lengthM)} m · ${fmtHold(b.holdS)}${over ? (b.id === 'terminal' ? ' (by design)' : ' ⚠') : ''}`;
        const inside = x(b.riders) - m.l > 230;
        return `
          <g><title>${esc(b.name)}: ${esc(label)}</title>
            <text x="${m.l - 10}" y="${yy + 14}" text-anchor="end" class="label">${esc(b.name)}</text>
            <rect x="${m.l}" y="${yy}" width="${Math.max(2, x(b.riders) - m.l)}" height="20" rx="4" fill="${colorOf(b.id)}"/>
            <text x="${inside ? x(b.riders) - 8 : x(b.riders) + 8}" y="${yy + 14}" text-anchor="${inside ? 'end' : 'start'}"
              class="${inside ? 'value inv' : 'value'}">${esc(label)}</text>
          </g>`;
      }).join('')}
    </svg>
    <details class="table"><summary>Show as table</summary>
      <table><thead><tr><th>Group</th><th>Riders</th><th>Column</th><th>Each corner held</th></tr></thead>
      <tbody>${bars.map((b) => `<tr><td>${esc(b.name)}</td><td>${r(b.riders)}</td><td>${r(b.lengthM)} m</td><td>${fmtHold(b.holdS)}</td></tr>`).join('')}</tbody></table>
    </details>`;
}
