/**
 * The "Edit plan" panel. Rendered from state only on structural changes
 * (spokes or pickups added/removed, reset, plan loaded), so typing into a
 * field never loses focus; field edits call back without re-rendering.
 */
import { MAX_PICKUPS, MAX_SPOKES } from './model/edit';
import { AGE_GROUPS, type AgeGroup, type Params, type Scenario, type Spoke, type Stop } from './model/types';

export type PlaceMode =
  | { kind: 'move'; stopId: string; label: string }
  | { kind: 'add-pickup'; spokeId: string; label: string }
  | { kind: 'add-spoke'; label: string };

export interface EditorHandlers {
  updateSpoke(id: string, patch: Partial<Pick<Spoke, 'name' | 'area' | 'arrivalOffsetMin'>>): void;
  setJoin(spokeId: string, stopId: string | null): void;
  updateStop(id: string, patch: { name?: string; riders?: number; ages?: Partial<Record<AgeGroup, number>> | null }): void;
  removePickup(id: string): void;
  startAt(id: string): void;
  removeSpoke(id: string): void;
  place(mode: PlaceMode): void;
  updateParams(mutate: (p: Params) => void): void;
  reset(): void;
  copyLink(): void;
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Numeric settings: [path, label, unit, min, max, step, scale shown]. */
const SETTINGS: [string, string, string, number, number, number, number?][] = [
  ['cruiseKmh', 'Lead pace', 'km/h', 5, 30, 0.5],
  ['ridersPerRow', 'Riders per row', '', 1, 6, 0.1],
  ['rowSpacingM', 'Row spacing', 'm', 1, 6, 0.1],
  ['regroupMin', 'Regroup at each pickup', 'min', 0, 30, 1],
  ['mergeHoldMin', 'Hold at merge after last arrival', 'min', 0, 60, 1],
  ['slackPct', 'Schedule cushion on riding time', '%', 0, 100, 5],
  ['meetBeforeStartMin', 'Meet before roll-out at starts', 'min', 0, 60, 5],
  ['marshals.leadSweep', 'Marshals: lead + sweep per group', '', 0, 20, 1],
  ['marshals.corkersPerIntersection', 'Marshals: corkers per held intersection', '', 1, 6, 1],
  ['marshals.setupS', 'Corkers in place before the head arrives', 's', 0, 300, 5],
  ['marshals.catchUpKmh', "Corkers' catch-up speed", 'km/h', 8, 40, 1],
  ['paceSetShare', 'An age group sets the pace at', '% of a column', 0, 100, 1, 100],
  ['joinLeadMin', 'A joining spoke arrives early by', 'min', 0, 30, 1],
  ['thresholds.maxColumnM', 'Comfort limit: column length', 'm', 20, 5000, 10],
  ['thresholds.maxBlockageS', 'Comfort limit: hold per intersection', 's', 5, 1200, 5],
  ['thresholds.minStartRiders', 'Smallest safe start', 'riders', 0, 1000, 5],
  ['thresholds.maxArrivalSpreadMin', 'Arrival window at merge', 'min', 0, 120, 1],
];

const get = (o: unknown, path: string) => path.split('.').reduce<unknown>((a, k) => (a as Record<string, unknown>)?.[k], o) as number;
const set = (o: unknown, path: string, v: number) => {
  const keys = path.split('.');
  const last = keys.pop()!;
  (keys.reduce<unknown>((a, k) => (a as Record<string, unknown>)[k], o) as Record<string, number>)[last] = v;
};
const pct = (x: number) => Math.round(x * 1000) / 10;

function agesRow(stop: Stop, p: Params): string {
  const mix = stop.ages;
  return `
    <div class="ages" data-ages="${esc(stop.id)}" hidden>
      <p class="hint">Age mix of riders joining here, in %. Leave “Use city-wide mix” on to follow the settings below.</p>
      <label class="check"><input type="checkbox" data-act="ages-default" ${mix ? '' : 'checked'}> Use city-wide mix</label>
      <div class="agegrid">
        ${AGE_GROUPS.map((g) => `
          <label>${esc(p.ages[g].label)}
            <input type="number" inputmode="decimal" min="0" max="100" step="1" data-age="${g}"
              value="${pct(mix ? mix[g] ?? 0 : p.defaultAgeMix[g])}" ${mix ? '' : 'disabled'}>
          </label>`).join('')}
      </div>
    </div>`;
}

function stopRow(stop: Stop, kind: 'start' | 'pickup' | 'merge' | 'dest', p: Params): string {
  const ridersLabel = kind === 'merge' ? 'Join here' : kind === 'start' ? 'Set off' : 'Join';
  return `
    <li class="stoprow" data-stop="${esc(stop.id)}">
      <div class="stopmain">
        <span class="kind">${kind === 'start' ? 'Start' : kind === 'pickup' ? 'Pickup' : kind === 'merge' ? 'Merge' : 'Finish'}</span>
        <label class="grow"><span class="sr-only">Name</span>
          <input type="text" maxlength="60" data-act="stop-name" value="${esc(stop.name)}"></label>
        ${kind === 'dest' ? '' : `<label class="num"><span>${ridersLabel}</span>
          <input type="number" inputmode="numeric" min="0" max="20000" step="5" data-act="stop-riders" value="${stop.riders}"></label>`}
      </div>
      <div class="stopacts">
        <button type="button" class="mini" data-act="place-move" data-label="${esc(stop.name)}">Move on map</button>
        ${kind === 'dest' ? '' : `<button type="button" class="mini" data-act="toggle-ages" aria-expanded="false">Ages${stop.ages ? ' •' : ''}</button>`}
        ${kind === 'pickup' ? `<button type="button" class="mini" data-act="start-here" title="Drop the stops before this one and start here">Start here</button>
          <button type="button" class="mini danger" data-act="remove-pickup">Remove</button>` : ''}
      </div>
      ${kind === 'dest' ? '' : agesRow(stop, p)}
    </li>`;
}

export function renderEditor(el: HTMLElement, sc: Scenario, p: Params, colorOf: (id: string) => string): void {
  const spokes = sc.spokes.map((s) => `
    <details class="edspoke" data-spoke="${esc(s.id)}">
      <summary><span class="sw" style="background:${colorOf(s.id)}"></span>
        <span data-spoke-title>${esc(s.name)}</span></summary>
      <div class="row3">
        <label>Name <input type="text" maxlength="40" data-act="spoke-name" value="${esc(s.name)}"></label>
        <label>Area <input type="text" maxlength="40" data-act="spoke-area" value="${esc(s.area ?? '')}"></label>
        <label>Arrive vs target <span class="unit">min</span>
          <input type="number" min="-120" max="120" step="1" data-act="spoke-offset" value="${s.arrivalOffsetMin}"></label>
      </div>
      <label class="setting">Rides to
        <select data-act="spoke-join">
          <option value="">${esc(sc.merge.name)} (the merge)</option>
          ${sc.spokes.filter((o) => o.id !== s.id && !o.joinsAt).flatMap((o) => o.pickups.map((pk) =>
            `<option value="${esc(pk.id)}" ${s.joinsAt === pk.id ? 'selected' : ''}>joins ${esc(o.name)} at ${esc(pk.name)}</option>`)).join('')}
        </select>
      </label>
      <ol class="stops">
        ${stopRow(s.start, 'start', p)}
        ${s.pickups.map((pk) => stopRow(pk, 'pickup', p)).join('')}
      </ol>
      <div class="actions">
        <button type="button" class="btn" data-act="add-pickup" ${s.pickups.length >= MAX_PICKUPS ? 'disabled' : ''}>+ Add pickup on map</button>
        <button type="button" class="btn danger" data-act="remove-spoke">Remove spoke</button>
      </div>
    </details>`).join('');

  const settings = SETTINGS.map(([path, label, unit, min, max, step, scale]) => `
    <label class="setting">${esc(label)} ${unit ? `<span class="unit">${esc(unit)}</span>` : ''}
      <input type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}"
        data-param="${path}" data-scale="${scale ?? 1}" value="${Math.round(get(p, path) * (scale ?? 1) * 100) / 100}">
    </label>`).join('');

  const ageTable = `
    <table class="agetable">
      <thead><tr><th>Age</th><th>City-wide %</th><th>Pace km/h</th><th>Space ×</th></tr></thead>
      <tbody>${AGE_GROUPS.map((g) => `
        <tr><th scope="row">${esc(p.ages[g].label)}</th>
          <td><input type="number" min="0" max="100" step="1" data-param="defaultAgeMix.${g}" data-scale="100" value="${pct(p.defaultAgeMix[g])}" aria-label="${esc(p.ages[g].label)} share of riders"></td>
          <td><input type="number" min="3" max="30" step="0.5" data-param="ages.${g}.paceKmh" data-scale="1" value="${p.ages[g].paceKmh}" aria-label="${esc(p.ages[g].label)} pace"></td>
          <td><input type="number" min="0.5" max="4" step="0.1" data-param="ages.${g}.spaceFactor" data-scale="1" value="${p.ages[g].spaceFactor}" aria-label="${esc(p.ages[g].label)} road space"></td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  el.innerHTML = `
    <p class="note">Drag any point on the map, or use “Move on map”. Moved routes are re-snapped to streets
      (straight lines until the router answers). The link in your address bar always holds the current plan.</p>
    <div class="actions">
      <button type="button" class="btn primary" data-act="copy-link">Copy link to this plan</button>
      <button type="button" class="btn" data-act="add-spoke" ${sc.spokes.length >= MAX_SPOKES ? 'disabled' : ''}>+ Add spoke on map</button>
      <button type="button" class="btn" data-act="reset">Reset to default plan</button>
      <span class="status" id="edit-status" role="status"></span>
    </div>
    <section aria-label="Spokes">${spokes}</section>
    <details class="edspoke" open>
      <summary><span class="sw" style="background:#2b2b2b"></span>Merge and finish</summary>
      <ol class="stops">${stopRow(sc.merge, 'merge', p)}${stopRow(sc.destination, 'dest', p)}</ol>
    </details>
    <details class="edspoke">
      <summary>Settings</summary>
      <label class="setting">Target arrival at merge <input type="time" data-act="target" value="${esc(p.targetMergeArrival)}"></label>
      ${settings}
      <h3>Age groups</h3>
      ${ageTable}
    </details>`;
}

/** Wire events once; the element's content can be re-rendered freely. */
export function bindEditor(el: HTMLElement, h: EditorHandlers, getState: () => { sc: Scenario; p: Params }): void {
  const stopOf = (t: HTMLElement) => t.closest<HTMLElement>('[data-stop]')?.dataset.stop;
  const spokeOf = (t: HTMLElement) => t.closest<HTMLElement>('[data-spoke]')?.dataset.spoke;

  const readAges = (box: HTMLElement): Partial<Record<AgeGroup, number>> => {
    const out: Partial<Record<AgeGroup, number>> = {};
    box.querySelectorAll<HTMLInputElement>('[data-age]').forEach((i) => {
      const v = Number(i.value);
      if (Number.isFinite(v)) out[i.dataset.age as AgeGroup] = Math.min(100, Math.max(0, v)) / 100;
    });
    return out;
  };

  el.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    const act = t.dataset.act;
    const stop = stopOf(t);
    const spoke = spokeOf(t);
    const n = Number(t.value);
    if (act === 'stop-name' && stop) h.updateStop(stop, { name: t.value.slice(0, 60) || 'Stop' });
    else if (act === 'stop-riders' && stop && t.value !== '' && Number.isFinite(n)) h.updateStop(stop, { riders: Math.min(20000, Math.max(0, n)) });
    else if (act === 'spoke-name' && spoke) {
      h.updateSpoke(spoke, { name: t.value.slice(0, 40) || 'Spoke' });
      const title = el.querySelector(`[data-spoke="${CSS.escape(spoke)}"] [data-spoke-title]`);
      if (title) title.textContent = t.value || 'Spoke';
    } else if (act === 'spoke-area' && spoke) h.updateSpoke(spoke, { area: t.value.slice(0, 40) });
    else if (act === 'spoke-offset' && spoke && t.value !== '' && Number.isFinite(n)) h.updateSpoke(spoke, { arrivalOffsetMin: Math.round(Math.min(120, Math.max(-120, n))) });
    else if (t.dataset.age && stop) {
      const box = t.closest<HTMLElement>('[data-ages]')!;
      h.updateStop(stop, { ages: readAges(box) });
    } else if (act === 'target' && /^\d{1,2}:\d{2}$/.test(t.value)) h.updateParams((p) => { p.targetMergeArrival = t.value; });
    else if (t.dataset.param && t.value !== '' && Number.isFinite(n)) {
      const min = Number(t.min), max = Number(t.max), scale = Number(t.dataset.scale || 1);
      const v = Math.min(max, Math.max(min, n)) / scale;
      h.updateParams((p) => {
        set(p, t.dataset.param!, v);
      });
    }
  });

  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.act === 'spoke-join') {
      const spoke = spokeOf(t);
      if (spoke) h.setJoin(spoke, t.value || null);
      return;
    }
    if (t.dataset.act !== 'ages-default') return;
    const stop = stopOf(t);
    const box = t.closest<HTMLElement>('[data-ages]')!;
    box.querySelectorAll<HTMLInputElement>('[data-age]').forEach((i) => { i.disabled = t.checked; });
    if (!stop) return;
    if (t.checked) {
      const { p } = getState();
      box.querySelectorAll<HTMLInputElement>('[data-age]').forEach((i) => { i.value = String(pct(p.defaultAgeMix[i.dataset.age as AgeGroup])); });
      h.updateStop(stop, { ages: null });
    } else h.updateStop(stop, { ages: readAges(box) });
  });

  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!b) return;
    const stop = stopOf(b);
    const spoke = spokeOf(b);
    const { sc } = getState();
    switch (b.dataset.act) {
      case 'toggle-ages': {
        const box = b.closest('.stoprow')!.querySelector<HTMLElement>('[data-ages]')!;
        box.hidden = !box.hidden;
        b.setAttribute('aria-expanded', String(!box.hidden));
        break;
      }
      case 'place-move': if (stop) h.place({ kind: 'move', stopId: stop, label: `Click the map to move “${b.dataset.label ?? 'stop'}”` }); break;
      case 'remove-pickup': if (stop) h.removePickup(stop); break;
      case 'start-here': if (stop) h.startAt(stop); break;
      case 'add-pickup': if (spoke) h.place({ kind: 'add-pickup', spokeId: spoke, label: `Click the map to add a pickup to ${sc.spokes.find((s) => s.id === spoke)?.name ?? 'this spoke'}` }); break;
      case 'remove-spoke': if (spoke) h.removeSpoke(spoke); break;
      case 'add-spoke': h.place({ kind: 'add-spoke', label: 'Click the map where the new spoke starts' }); break;
      case 'reset': h.reset(); break;
      case 'copy-link': h.copyLink(); break;
    }
  });
}

export function setEditStatus(text: string): void {
  const s = document.getElementById('edit-status');
  if (s) s.textContent = text;
}
