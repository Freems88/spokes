import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, LngLatBoundsLike } from 'maplibre-gl';
// MapLibre looks for its worker next to its own module file, which bundling moves.
// Ship the (self-contained) worker as an asset and point MapLibre at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
maplibregl.setWorkerUrl(workerUrl);
import { RouteService } from './app/routes';
import { DEFAULT_PARAMS, DEFAULT_SCENARIO } from './config';
import { bindEditor, esc, renderEditor, setEditStatus, type PlaceMode } from './editor';
import {
  resolveScenario, routesByKey, signalPoints, spokeWaypoints, TERMINAL_ID, type RoutesFile, type SignalsFile,
} from './model/data';
import * as edit from './model/edit';
import { pointAlong } from './model/geo';
import { computePlan, formatClock } from './model/model';
import { decodePlan, encodePlan, planFromHash } from './model/share';
import { snapSignals } from './model/signals';
import { buildSim, type Sim, type SimState } from './model/sim';
import type { LngLat, Params, Plan, Scenario } from './model/types';
import { renderPanel, type RouteSummary } from './panel';
import { renderGroupsChart, renderHoldChart } from './charts';
import { boundsOf as boundsOfPts, findHtml, heroHtml, mapSteps, organiserIntroHtml, whyHtml, type MapStep } from './story';
import type { Area } from './model/geo';

/** Categorical slots in fixed order (the first three validate all-pairs for colour-blind readers). */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const FINAL = '#2b2b2b';
const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type FC = GeoJSON.FeatureCollection;
const fc = (features: GeoJSON.Feature[]): FC => ({ type: 'FeatureCollection', features });
const pt = (c: LngLat, properties: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: 'Feature', properties, geometry: { type: 'Point', coordinates: c },
});
const ln = (c: LngLat[], properties: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: 'Feature', properties, geometry: { type: 'LineString', coordinates: c },
});

async function loadJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

// ── State ────────────────────────────────────────────────────────────────

interface State { scenario: Scenario; params: Params }
let state: State = { scenario: structuredClone(DEFAULT_SCENARIO), params: structuredClone(DEFAULT_PARAMS) };
let plan: Plan;
let sim: Sim;
let t = 0;
let placing: PlaceMode | null = null;

/** Colour follows the spoke, not its position: a spoke keeps its slot when others are removed. */
const slots = new Map<string, number>();
function colorOf(id: string): string {
  if (id === TERMINAL_ID || id === 'merge' || id === 'dest') return FINAL;
  if (!slots.has(id)) {
    const used = new Set(state.scenario.spokes.map((s) => slots.get(s.id)).filter((x) => x !== undefined));
    let i = 0;
    while (used.has(i)) i++;
    slots.set(id, i);
  }
  return SERIES[slots.get(id)! % SERIES.length]!;
}

async function main() {
  const [routesFile, signalsFile, areasFile] = await Promise.all([
    loadJson<RoutesFile>('data/routes.geojson'),
    loadJson<SignalsFile>('data/signals.geojson'),
    loadJson<AreasFile>('data/municipalities.geojson'),
  ]);
  const areas: Area[] | null = areasFile?.features.map((f) => ({ name: f.properties.name, polygons: f.geometry.coordinates })) ?? null;
  const signals = signalsFile ? signalPoints(signalsFile) : null;
  const snapMemo = new WeakMap<LngLat[], number[]>();
  const snap = signals
    ? (line: LngLat[]) => {
      let hit = snapMemo.get(line);
      if (!hit) snapMemo.set(line, (hit = snapSignals(line, signals)));
      return hit;
    }
    : null;

  // A plan in the link wins over the default.
  const code = planFromHash(location.hash);
  if (code) {
    try {
      state = await decodePlan(code, DEFAULT_SCENARIO, DEFAULT_PARAMS);
    } catch (e) {
      console.warn('Bad plan link', e);
      $('notice').textContent = 'That plan link could not be read, so the default plan is shown.';
      $('notice').hidden = false;
    }
  }

  const map = new maplibregl.Map({
    container: 'map',
    style: STYLE,
    bounds: boundsOf(state.scenario),
    fitBoundsOptions: { padding: { top: 40, bottom: 30, left: 30, right: 30 } },
    attributionControl: { compact: true, customAttribution: 'Signals: City of Toronto Open Data (OGL–Toronto) · Routes: OSRM / FOSSGIS' },
    fadeDuration: reducedMotion ? 0 : 300,
    // The page scrolls past the map: one finger / plain wheel scrolls the page, two fingers / Ctrl+wheel move the map.
    cooperativeGestures: true,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  await new Promise<void>((ok) => map.on('load', () => ok()));
  document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  addLayers(map);
  if (areasFile) (map.getSource('areas') as GeoJSONSource).setData(areasFile as unknown as FC);

  const routes = new RouteService(routesByKey(routesFile), () => recompute());
  const allWaypoints = () => [
    ...state.scenario.spokes.map((s) => spokeWaypoints(state.scenario, s.id)),
    spokeWaypoints(state.scenario, TERMINAL_ID),
  ];
  const routeSummary = (): RouteSummary => {
    const st = allWaypoints().map((w) => routes.status(w));
    return {
      routed: st.filter((s) => s === 'routed').length,
      straight: st.filter((s) => s === 'straight').length,
      pending: st.filter((s) => s === 'pending').length,
      signals: !!signals,
    };
  };

  const markers = new Markers(map, (id, to) => commit(edit.moveStop(state.scenario, id, to)));
  const playback = setupPlayback(map);
  const story = setupStory(map, playback, areas);

  function recompute() {
    const resolved = resolveScenario(state.scenario, routes.lookup, snap);
    plan = computePlan(resolved, state.params);
    sim = buildSim(plan);
    if (import.meta.env.DEV) Object.assign(window, { __map: map, __plan: plan, __state: state });
    updateStatic(map, plan);
    renderLegend(plan);
    renderPanel($('summary'), plan, colorOf, routeSummary());
    markers.sync(state.scenario);
    playback.refresh();
    renderEssay(plan, areas);
    story.update(plan);
  }

  let urlTimer: ReturnType<typeof setTimeout> | undefined;
  const isDefault = () =>
    JSON.stringify(state.scenario) === JSON.stringify(DEFAULT_SCENARIO) && JSON.stringify(state.params) === JSON.stringify(DEFAULT_PARAMS);
  async function writeUrl() {
    const hash = isDefault() ? '' : `#plan=${await encodePlan(state.scenario, state.params, DEFAULT_PARAMS)}`;
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  }

  /** Apply an edit. `structural` re-renders the editor form (adds/removes/loads). */
  function commit(scenario: Scenario, opts: { params?: Params; structural?: boolean } = {}) {
    state = { scenario, params: opts.params ?? state.params };
    recompute();
    routes.request(allWaypoints());
    if (opts.structural) renderEditor($('editor'), state.scenario, state.params, colorOf);
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => void writeUrl(), 300);
  }

  bindEditor($('editor'), {
    updateSpoke: (id, patch) => commit(edit.updateSpoke(state.scenario, id, patch)),
    updateStop: (id, patch) => commit(edit.updateStop(state.scenario, id, patch)),
    removePickup: (id) => commit(edit.removePickup(state.scenario, id), { structural: true }),
    startAt: (id) => commit(edit.startAtPickup(state.scenario, id), { structural: true }),
    removeSpoke: (id) => commit(edit.removeSpoke(state.scenario, id), { structural: true }),
    place: (mode) => setPlacing(mode),
    updateParams: (mutate) => {
      const p = structuredClone(state.params);
      mutate(p);
      commit(state.scenario, { params: p });
    },
    reset: () => {
      history.replaceState(null, '', location.pathname + location.search);
      commit(structuredClone(DEFAULT_SCENARIO), { params: structuredClone(DEFAULT_PARAMS), structural: true });
      setEditStatus('Back to the default plan.');
    },
    copyLink: async () => {
      clearTimeout(urlTimer);
      await writeUrl();
      try {
        await navigator.clipboard.writeText(location.href);
        setEditStatus('Link copied.');
      } catch {
        setEditStatus('Copy the address bar to share this plan.');
      }
    },
  }, () => ({ sc: state.scenario, p: state.params }));

  // Placing points by clicking the map.
  const placebar = $('placebar');
  function setPlacing(mode: PlaceMode | null) {
    placing = mode;
    placebar.hidden = !mode;
    $('placetext').textContent = mode?.label ?? '';
    map.getCanvas().style.cursor = mode ? 'crosshair' : '';
    if (mode) $('map').scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  }
  $('placecancel').addEventListener('click', () => setPlacing(null));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && placing) setPlacing(null); });
  map.on('click', (e) => {
    if (!placing) return;
    const at: LngLat = [e.lngLat.lng, e.lngLat.lat];
    const mode = placing;
    setPlacing(null);
    if (mode.kind === 'move') commit(edit.moveStop(state.scenario, mode.stopId, at));
    else if (mode.kind === 'add-pickup') commit(edit.addPickup(state.scenario, mode.spokeId, at), { structural: true });
    else commit(edit.addSpoke(state.scenario, at), { structural: true });
  });

  // Tabs.
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      for (const other of tabs) {
        const on = other === tab;
        other.setAttribute('aria-selected', String(on));
        $(other.getAttribute('aria-controls')!).hidden = !on;
      }
    });
  }

  renderEditor($('editor'), state.scenario, state.params, colorOf);
  recompute();
  routes.request(allWaypoints());
  playback.start();
}

function boundsOf(sc: Scenario): LngLatBoundsLike {
  const all = [
    ...sc.spokes.flatMap((s) => [s.start.lngLat, ...s.pickups.map((p) => p.lngLat)]),
    sc.merge.lngLat, sc.destination.lngLat,
  ];
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}

function renderLegend(plan: Plan) {
  const rows = [
    ...plan.spokes.map((s) => [colorOf(s.id), `${s.name} spoke`]),
    [FINAL, 'Final ride (everyone)'],
  ];
  $('legend').innerHTML = rows
    .map(([c, label]) => `<div class="row"><span class="sw" style="background:${c}"></span>${esc(label!)}</div>`)
    .join('') + '<div class="row"><span class="sw ring"></span>Intersection held now</div>';
}

// ── Map layers ───────────────────────────────────────────────────────────

function addLayers(map: maplibregl.Map) {
  for (const id of ['areas', 'routes', 'signals', 'stops', 'blobs', 'columns', 'heads', 'held']) {
    map.addSource(id, { type: 'geojson', data: fc([]) });
  }
  // Former municipalities: faint outlines + names, shown in the "whole city" step.
  map.addLayer({
    id: 'areas-line', type: 'line', source: 'areas', layout: { visibility: 'none' },
    paint: { 'line-color': '#52514e', 'line-width': 1.2, 'line-dasharray': [3, 2], 'line-opacity': 0.7 },
  });
  map.addLayer({
    id: 'areas-label', type: 'symbol', source: 'areas', layout: {
      visibility: 'none', 'text-field': ['upcase', ['get', 'name']], 'text-font': FONT_BOLD, 'text-size': 12,
      'text-letter-spacing': 0.12, 'symbol-placement': 'point',
    },
    paint: { 'text-color': '#52514e', 'text-halo-color': '#ffffff', 'text-halo-width': 2, 'text-opacity': 0.85 },
  });
  map.addLayer({
    id: 'routes-casing', type: 'line', source: 'routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 15, 10] },
  });
  map.addLayer({
    id: 'routes', type: 'line', source: 'routes', filter: ['!', ['get', 'straight']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'], 'line-opacity': 0.4,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 6],
    },
  });
  // Not yet street-snapped (or the router failed): dashed straight segments.
  map.addLayer({
    id: 'routes-straight', type: 'line', source: 'routes', filter: ['get', 'straight'],
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'], 'line-opacity': 0.6,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 5],
      'line-dasharray': [2, 1.5],
    },
  });
  map.addLayer({
    id: 'signals', type: 'circle', source: 'signals',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 15, 4],
      'circle-color': '#ffffff', 'circle-stroke-color': '#7a7974', 'circle-stroke-width': 1,
    },
  });
  map.addLayer({
    id: 'stop-labels', type: 'symbol', source: 'stops',
    minzoom: 11,
    layout: {
      'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 11.5,
      'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true,
    },
    paint: { 'text-color': '#52514e', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
  });
  // Waiting / gathered riders: circle area ∝ riders.
  map.addLayer({
    id: 'blobs', type: 'circle', source: 'blobs',
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        10, ['*', 0.55, ['sqrt', ['get', 'riders']]],
        15, ['*', 1.4, ['sqrt', ['get', 'riders']]],
      ],
      'circle-color': ['get', 'color'], 'circle-opacity': 0.28,
      'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1.5,
    },
  });
  map.addLayer({
    id: 'blob-labels', type: 'symbol', source: 'blobs',
    layout: {
      'text-field': ['to-string', ['round', ['get', 'riders']]], 'text-font': FONT_BOLD, 'text-size': 11,
      'text-offset': [0, -1.3], 'text-anchor': 'bottom',
    },
    paint: { 'text-color': '#0b0b0b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
  });
  // Held intersections: a ring under the columns so it shows around them.
  map.addLayer({
    id: 'held', type: 'circle', source: 'held',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 8, 15, 14],
      'circle-color': 'rgba(255,255,255,0.85)', 'circle-stroke-color': '#2b2b2b', 'circle-stroke-width': 2,
    },
  });
  // Moving columns: true length on the road, width grows with riders.
  const width: maplibregl.ExpressionSpecification = ['interpolate', ['linear'], ['get', 'riders'], 0, 4, 300, 10, 1000, 18];
  map.addLayer({
    id: 'columns-casing', type: 'line', source: 'columns',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': ['+', 4, width] },
  });
  map.addLayer({
    id: 'columns', type: 'line', source: 'columns',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': width },
  });
  map.addLayer({
    id: 'heads', type: 'symbol', source: 'heads',
    layout: {
      'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': 12,
      'text-offset': [0, -1.4], 'text-anchor': 'bottom', 'text-allow-overlap': true,
    },
    paint: { 'text-color': '#0b0b0b', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
  });
}

function updateStatic(map: maplibregl.Map, plan: Plan) {
  const sc = plan.scenario;
  const isStraight = (line: LngLat[], wps: LngLat[]) => line === wps || line.length === wps.length;
  (map.getSource('routes') as GeoJSONSource).setData(fc([
    ...plan.spokes.map((s) => ln(s.path, { color: colorOf(s.id), straight: isStraight(s.path, spokeWaypoints(state.scenario, s.id)) })),
    ln(plan.terminal.path, { color: FINAL, straight: isStraight(plan.terminal.path, spokeWaypoints(state.scenario, TERMINAL_ID)) }),
  ]));
  const sigs: GeoJSON.Feature[] = [];
  for (const s of sc.spokes) for (const a of s.signalsAlongM ?? []) sigs.push(pt(pointAlong(s.path!, a)));
  for (const a of sc.terminalSignalsAlongM ?? []) sigs.push(pt(pointAlong(plan.terminal.path, a)));
  (map.getSource('signals') as GeoJSONSource).setData(fc(sigs));
  const stops: GeoJSON.Feature[] = [];
  for (const s of sc.spokes) for (const st of [s.start, ...s.pickups]) stops.push(pt(st.lngLat, { name: st.name }));
  stops.push(pt(sc.merge.lngLat, { name: sc.merge.name }), pt(sc.destination.lngLat, { name: sc.destination.name }));
  (map.getSource('stops') as GeoJSONSource).setData(fc(stops));
}

function draw(map: maplibregl.Map, s: SimState) {
  const nameOf = (id: string) => (id === TERMINAL_ID ? 'Final ride' : plan.spokes.find((x) => x.id === id)?.name ?? id);
  const blobColor = (id: string) => {
    if (id === 'merge' || id === 'dest') return FINAL;
    const sp = plan.scenario.spokes.find((x) => id === `${x.id}:start` || x.pickups.some((p) => p.id === id));
    return colorOf(sp?.id ?? TERMINAL_ID);
  };
  (map.getSource('blobs') as GeoJSONSource).setData(
    fc(s.blobs.map((b) => pt(b.lngLat, { riders: b.riders, color: blobColor(b.id) }))));
  (map.getSource('columns') as GeoJSONSource).setData(
    fc(s.columns.map((c) => ln(c.line, { riders: c.riders, color: colorOf(c.id) }))));
  (map.getSource('heads') as GeoJSONSource).setData(
    fc(s.columns.map((c) => pt(c.head, { label: `${nameOf(c.id)} · ${Math.round(c.riders)}` }))));
  (map.getSource('held') as GeoJSONSource).setData(fc(s.heldSignals.map((p) => pt(p))));

  $('clock').textContent = formatClock(s.t);
  const moving = s.columns.reduce((a, c) => a + c.riders, 0);
  $('nowstat').textContent = s.columns.length
    ? `${Math.round(moving)} riders on the road · ${s.heldSignals.length} intersection${s.heldSignals.length === 1 ? '' : 's'} held`
    : 'No groups moving';
}

interface AreasFile {
  features: { properties: { name: string }; geometry: { coordinates: LngLat[][][] } }[];
}

function renderEssay(plan: Plan, areas: Area[] | null) {
  $('hero').innerHTML = heroHtml(plan);
  $('find').innerHTML = findHtml(plan, areas, colorOf);
  $('why-text').innerHTML = whyHtml(plan);
  $('plan-intro').innerHTML = organiserIntroHtml(plan);
  renderHoldChart($('chart-hold'), plan);
  renderGroupsChart($('chart-groups'), plan, colorOf);
}

// ── Story: scroll drives the map ─────────────────────────────────────────

function setupStory(map: maplibregl.Map, playback: ReturnType<typeof setupPlayback>, areas: Area[] | null) {
  const el = $('story');
  let steps: MapStep[] = [];
  let active: string | null = null;
  const desktop = window.matchMedia('(min-width: 900px)');
  const duration = reducedMotion ? 0 : 1400;

  const setAreas = (on: boolean) => {
    for (const id of ['areas-line', 'areas-label']) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  };
  const padding = () => (desktop.matches ? { top: 60, bottom: 40, left: 40, right: 40 } : { top: 30, bottom: 20, left: 20, right: 20 });

  function activate(id: string) {
    if (id === active) return;
    active = id;
    // In the organisers' section the map is a tool: plain drags and wheel zoom.
    if (id === 'plan') map.cooperativeGestures.disable();
    else map.cooperativeGestures.enable();
    el.querySelectorAll('.step').forEach((s) => s.classList.toggle('active', (s as HTMLElement).dataset.step === id));
    const all = () => boundsOfPts([...plan.spokes.flatMap((s) => s.path), ...plan.terminal.path]);
    if (id === 'plan' || id === 'find' || id === 'why') {
      setAreas(false);
      map.fitBounds(all(), { padding: padding(), duration });
      if (id === 'plan') playback.free();
      else if (id === 'find') playback.loop({ from: sim.t0, to: sim.t1, speed: 60 });
      else playback.goto((Math.min(...plan.spokes.map((s) => s.headArriveMergeS)) + Math.max(...plan.spokes.map((s) => s.startS))) / 2);
      return;
    }
    const step = steps.find((s) => s.id === id);
    if (!step) return;
    setAreas(!!step.showAreas);
    if ('bounds' in step.view) map.fitBounds(step.view.bounds, { padding: padding(), duration, maxZoom: 15.5 });
    else if (reducedMotion) map.jumpTo({ center: step.view.center, zoom: step.view.zoom });
    else map.flyTo({ center: step.view.center, zoom: step.view.zoom, duration });
    if (step.loop) playback.loop(step.loop);
    else if (step.at !== undefined) playback.goto(step.at);
  }

  /** Activate the section nearest the trigger line (middle of the part of the screen the map doesn't cover). */
  function pick() {
    const line = desktop.matches ? innerHeight * 0.5 : innerHeight * 0.78;
    let best: { id: string; d: number } | null = null;
    for (const node of document.querySelectorAll<HTMLElement>('.col [data-step]')) {
      const r = node.getBoundingClientRect();
      const d = r.top > line ? r.top - line : r.bottom < line ? line - r.bottom : 0;
      if (!best || d < best.d) best = { id: node.dataset.step!, d };
    }
    // Above the story (still in the hero): leave the map be.
    const first = el.querySelector<HTMLElement>('.step');
    if (first && first.getBoundingClientRect().top > line + innerHeight * 0.25) return;
    if (best) activate(best.id);
  }
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; pick(); });
  };
  function observe() { pick(); }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  for (const id of ['find', 'why', 'plan']) $(id).dataset.step = id;
  // "Show on map" on a spoke's timetable.
  $('find').addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-show-spoke]')?.dataset.showSpoke;
    const sp = plan.spokes.find((s) => s.id === id);
    if (!sp) return;
    map.fitBounds(boundsOfPts(sp.path), { padding: padding(), duration });
    playback.loop({ from: sp.startS, to: sp.tailArriveMergeS, speed: 60 });
    if (!desktop.matches) $('map').scrollIntoView({ block: 'nearest' });
  });

  return {
    update(p: Plan) {
      const next = mapSteps(p, areas);
      const same = next.map((s) => s.id).join() === steps.map((s) => s.id).join();
      steps = next;
      if (same && el.childElementCount) {
        for (const s of steps) {
          const body = el.querySelector<HTMLElement>(`[data-step="${s.id}"] .body`);
          if (body) body.innerHTML = s.html;
        }
        return;
      }
      el.innerHTML = steps.map((s) => `
        <article class="step" data-step="${s.id}">
          ${s.heading ? `<h2>${esc(s.heading)}</h2>` : ''}
          <div class="body">${s.html}</div>
        </article>`).join('');
      active = null;
      observe();
    },
  };
}

// ── Draggable points ─────────────────────────────────────────────────────

/** One DOM marker per stop: drag with a pointer, or focus and nudge with arrow keys. */
class Markers {
  private markers = new Map<string, maplibregl.Marker>();
  private key = '';
  constructor(private map: maplibregl.Map, private onMove: (id: string, to: LngLat) => void) {}

  sync(sc: Scenario) {
    const items: { id: string; at: LngLat; color: string; label: string; kind: string }[] = [];
    for (const s of sc.spokes) {
      items.push({ id: s.start.id, at: s.start.lngLat, color: colorOf(s.id), label: `${s.name} start: ${s.start.name}`, kind: 'start' });
      for (const p of s.pickups) items.push({ id: p.id, at: p.lngLat, color: colorOf(s.id), label: `${s.name} pickup: ${p.name}`, kind: 'pickup' });
    }
    items.push({ id: sc.merge.id, at: sc.merge.lngLat, color: FINAL, label: `Merge: ${sc.merge.name}`, kind: 'merge' });
    items.push({ id: sc.destination.id, at: sc.destination.lngLat, color: FINAL, label: `Finish: ${sc.destination.name}`, kind: 'merge' });
    const key = JSON.stringify(items);
    if (key === this.key) return;
    this.key = key;
    for (const m of this.markers.values()) m.remove();
    this.markers.clear();
    for (const it of items) {
      const el = document.createElement('div');
      el.className = `pin pin-${it.kind}`;
      el.style.borderColor = it.color;
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${it.label}. Drag, or use arrow keys to move (Shift for bigger steps).`);
      el.title = it.label;
      el.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 0.002 : 0.0003; // ~160 m / ~25 m north–south
        const d: Record<string, LngLat> = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [-step * 1.38, 0], ArrowRight: [step * 1.38, 0] };
        const v = d[e.key];
        if (!v) return;
        e.preventDefault();
        this.onMove(it.id, [it.at[0] + v[0], it.at[1] + v[1]]);
        requestAnimationFrame(() => (this.map.getContainer().querySelector<HTMLElement>(`[data-pin="${CSS.escape(it.id)}"]`))?.focus());
      });
      el.dataset.pin = it.id;
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(it.at).addTo(this.map);
      m.on('dragend', () => {
        const ll = m.getLngLat();
        this.onMove(it.id, [ll.lng, ll.lat]);
      });
      this.markers.set(it.id, m);
    }
  }
}

// ── Playback ─────────────────────────────────────────────────────────────

function setupPlayback(map: maplibregl.Map) {
  const play = $<HTMLButtonElement>('play');
  const speed = $<HTMLSelectElement>('speed');
  const scrub = $<HTMLInputElement>('scrub');
  const marks = $('marks');
  let playing = false;
  let last = 0;
  let raf = 0;
  let started = false;
  /** A window the story is looping; cleared as soon as the viewer takes over. */
  let loop: { from: number; to: number; speed: number } | null = null;

  const render = () => {
    scrub.value = String(Math.round(t));
    scrub.setAttribute('aria-valuetext', formatClock(t));
    draw(map, sim.at(t));
  };
  const setPlaying = (p: boolean) => {
    playing = p;
    play.textContent = p ? 'Pause' : 'Play';
    play.setAttribute('aria-pressed', String(p));
    cancelAnimationFrame(raf);
    if (p) {
      if (t >= sim.t1) t = sim.t0;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };
  const tick = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    t = Math.min(sim.t1, t + dt * (loop ? loop.speed : Number(speed.value)));
    if (loop && t >= loop.to) t = loop.from;
    render();
    if (t >= sim.t1) return setPlaying(false);
    raf = requestAnimationFrame(tick);
  };
  play.addEventListener('click', () => { loop = null; setPlaying(!playing); });
  scrub.addEventListener('input', () => { loop = null; t = Number(scrub.value); render(); });

  return {
    /** Story: show one moment, paused. */
    goto(at: number) {
      loop = null;
      setPlaying(false);
      t = Math.min(sim.t1, Math.max(sim.t0, at));
      render();
    },
    /** Story: loop a window (reduced motion shows its end, paused). */
    loop(w: { from: number; to: number; speed: number }) {
      if (reducedMotion) return this.goto(w.to);
      loop = { from: Math.max(sim.t0, w.from), to: Math.min(sim.t1, w.to), speed: w.speed };
      t = loop.from;
      render();
      setPlaying(true);
    },
    /** Viewer is in charge: stop any story loop. */
    free() {
      if (loop) { loop = null; setPlaying(false); }
    },
    /** Called after every recompute: new time range, marks and frame. */
    refresh() {
      scrub.min = String(Math.floor(sim.t0));
      scrub.max = String(Math.ceil(sim.t1));
      if (!started) t = reducedMotion ? plan.terminal.departS + 240 : sim.t0;
      t = Math.min(sim.t1, Math.max(sim.t0, t));
      marks.replaceChildren(...sim.marks.map((m) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = `${formatClock(m.t)} ${m.label}`;
        b.addEventListener('click', () => { t = m.t + 1; render(); });
        return b;
      }));
      render();
    },
    start() {
      started = true;
    },
  };
}

main().catch((e) => {
  console.error(e);
  $('notice').textContent = `Something went wrong loading the map: ${String(e)}`;
  $('notice').hidden = false;
});
