/**
 * Scenario edits. Pure: every function returns a new Scenario.
 *
 * Path invariant for each spoke: `path` (the via points sent to the router)
 * starts at the spoke's start, ends at the merge point (or the pickup it
 * joins on another spoke), and contains every
 * pickup's exact coordinate in order. Hand-placed via points between stops
 * are kept when a stop moves a little and dropped when it moves far, so the
 * router can find a new way rather than zig-zag back to the old street.
 */
import { haversineM, project } from './geo';
import { joinTarget, spokeEnd } from './model';
import type { AgeGroup, LngLat, Scenario, Spoke, Stop } from './types';

/** A stop moved farther than this loses the via points on either side of it. */
export const FAR_MOVE_M = 250;
export const MAX_SPOKES = 8;
export const MAX_PICKUPS = 8;

const same = (a: LngLat, b: LngLat) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
const clone = <T>(x: T): T => structuredClone(x);

/** Via points for a spoke, rebuilt from its stops when missing. */
function pathOf(sp: Spoke, merge: LngLat): LngLat[] {
  if (sp.path && sp.path.length >= 2) return [...sp.path];
  return [sp.start.lngLat, ...sp.pickups.map((p) => p.lngLat), merge];
}

/** Path indices of the stops (start, pickups…, merge), or null if the invariant is broken. */
function stopIndices(sp: Spoke, path: LngLat[]): number[] | null {
  const pts = [sp.start.lngLat, ...sp.pickups.map((p) => p.lngLat)];
  const out: number[] = [];
  let from = 0;
  for (const p of pts) {
    let i = from;
    while (i < path.length && !same(path[i]!, p)) i++;
    if (i >= path.length) return null;
    out.push(i);
    from = i + 1;
  }
  out.push(path.length - 1);
  return out;
}

/** Where this spoke's route ends right now. */
const endOf = (sc: Scenario, sp: Spoke): LngLat => spokeEnd(sc, sp).lngLat;

/** Spokes that join at this stop. */
const joinersOf = (sc: Scenario, stopId: string) => sc.spokes.filter((x) => x.joinsAt === stopId);

/**
 * Point a spoke's route at a new end. A small move keeps the via points;
 * a far one drops those after its last stop so the router finds a new way.
 */
function retarget(sp: Spoke, from: LngLat, to: LngLat): void {
  healPath(sp, from);
  const path = sp.path!;
  const lastStop = stopIndices(sp, path)!.at(-2)!;
  sp.path = haversineM(from, to) > FAR_MOVE_M ? [...path.slice(0, lastStop + 1), to] : [...path.slice(0, -1), to];
}

/** Restore the invariant by rebuilding from stops if anything is off. */
function healPath(sp: Spoke, merge: LngLat): void {
  let path = pathOf(sp, merge);
  if (!same(path.at(-1)!, merge)) path.push(merge);
  if (!stopIndices(sp, path)) path = [sp.start.lngLat, ...sp.pickups.map((p) => p.lngLat), merge];
  sp.path = path;
}

export function findStop(sc: Scenario, stopId: string): { spoke?: Spoke; stop: Stop; index: number } | null {
  if (stopId === sc.merge.id) return { stop: sc.merge, index: -1 };
  if (stopId === sc.destination.id) return { stop: sc.destination, index: -1 };
  for (const spoke of sc.spokes) {
    if (spoke.start.id === stopId) return { spoke, stop: spoke.start, index: 0 };
    const i = spoke.pickups.findIndex((p) => p.id === stopId);
    if (i >= 0) return { spoke, stop: spoke.pickups[i]!, index: i + 1 };
  }
  return null;
}

/** Move any point: a start, a pickup, the merge point or the destination. */
export function moveStop(sc0: Scenario, stopId: string, to: LngLat): Scenario {
  const sc = clone(sc0);
  if (stopId === sc.merge.id) return moveMerge(sc, to);
  if (stopId === sc.destination.id) return moveDestination(sc, to);
  const hit = findStop(sc, stopId);
  if (!hit?.spoke) return sc0;
  const sp = hit.spoke;
  healPath(sp, endOf(sc, sp));
  const path = sp.path!;
  const idx = stopIndices(sp, path)!;
  const k = hit.index; // 0 = start
  const from = hit.stop.lngLat;
  for (const j of joinersOf(sc, stopId)) retarget(j, from, to);
  hit.stop.lngLat = to;
  if (haversineM(from, to) <= FAR_MOVE_M) {
    path[idx[k]!] = to;
  } else {
    const before = k === 0 ? [] : path.slice(0, idx[k - 1]! + 1);
    const after = path.slice(idx[k + 1]!);
    sp.path = [...before, to, ...after];
  }
  return sc;
}

function moveMerge(sc: Scenario, to: LngLat): Scenario {
  const from = sc.merge.lngLat;
  const far = haversineM(from, to) > FAR_MOVE_M;
  for (const sp of sc.spokes) if (!joinTarget(sc, sp)) retarget(sp, from, to);
  const t = sc.terminalPath?.length ? [...sc.terminalPath] : [from, sc.destination.lngLat];
  sc.terminalPath = far ? [to, sc.destination.lngLat] : [to, ...t.slice(1)];
  sc.merge.lngLat = to;
  return sc;
}

function moveDestination(sc: Scenario, to: LngLat): Scenario {
  const from = sc.destination.lngLat;
  const t = sc.terminalPath?.length ? [...sc.terminalPath] : [sc.merge.lngLat, from];
  sc.terminalPath = haversineM(from, to) > FAR_MOVE_M ? [sc.merge.lngLat, to] : [...t.slice(0, -1), to];
  sc.destination.lngLat = to;
  return sc;
}

let counter = 0;
/** Short id unique within the scenario. */
export function newId(sc: Scenario, prefix: string): string {
  const taken = new Set<string>([sc.merge.id, sc.destination.id]);
  for (const s of sc.spokes) {
    taken.add(s.id).add(s.start.id);
    for (const p of s.pickups) taken.add(p.id);
  }
  let id: string;
  do id = `${prefix}${(++counter).toString(36)}`; while (taken.has(id));
  return id;
}

/** Add a pickup where it falls along the spoke's route; its order follows from its position. */
export function addPickup(sc0: Scenario, spokeId: string, at: LngLat, name = 'New pickup', riders = 50): Scenario {
  const sc = clone(sc0);
  const sp = sc.spokes.find((s) => s.id === spokeId);
  if (!sp || sp.pickups.length >= MAX_PICKUPS) return sc0;
  healPath(sp, endOf(sc, sp));
  const path = sp.path!;
  const idx = stopIndices(sp, path)!;
  // Which segment of the via-point path is nearest?
  const along = project(path, at).alongM;
  let acc = 0;
  let seg = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const len = haversineM(path[i]!, path[i + 1]!);
    if (along <= acc + len) { seg = i; break; }
    acc += len;
    seg = i;
  }
  // Insert after vertex `seg`, but never before the start or after the merge.
  const insertAt = Math.min(path.length - 1, Math.max(1, seg + 1));
  const order = idx.slice(1, -1).filter((i) => i < insertAt).length; // pickups before it
  const stop: Stop = { id: newId(sc, 'p'), name, lngLat: at, riders };
  sp.pickups.splice(order, 0, stop);
  path.splice(insertAt, 0, at);
  return sc;
}

export function removePickup(sc0: Scenario, stopId: string): Scenario {
  const sc = clone(sc0);
  const hit = findStop(sc, stopId);
  if (!hit?.spoke || hit.index === 0) return sc0;
  const sp = hit.spoke;
  for (const j of joinersOf(sc, stopId)) { retarget(j, hit.stop.lngLat, sc.merge.lngLat); delete j.joinsAt; }
  healPath(sp, endOf(sc, sp));
  const i = sp.path!.findIndex((p) => same(p, hit.stop.lngLat));
  if (i > 0 && i < sp.path!.length - 1) sp.path!.splice(i, 1);
  sp.pickups.splice(hit.index - 1, 1);
  return sc;
}

export function addSpoke(sc0: Scenario, at: LngLat, name?: string): Scenario {
  if (sc0.spokes.length >= MAX_SPOKES) return sc0;
  const sc = clone(sc0);
  const id = newId(sc, 's');
  sc.spokes.push({
    id,
    name: name ?? `Spoke ${sc.spokes.length + 1}`,
    arrivalOffsetMin: 0,
    start: { id: newId(sc, 'p'), name: 'Start', lngLat: at, riders: 50 },
    pickups: [],
    path: [at, sc.merge.lngLat],
  });
  return sc;
}

export function removeSpoke(sc0: Scenario, spokeId: string): Scenario {
  const sc = clone(sc0);
  const gone = sc.spokes.find((s) => s.id === spokeId);
  for (const p of gone?.pickups ?? []) {
    for (const j of joinersOf(sc, p.id)) { retarget(j, p.lngLat, sc.merge.lngLat); delete j.joinsAt; }
  }
  sc.spokes = sc.spokes.filter((s) => s.id !== spokeId);
  return sc;
}

/** Make a pickup the new start, dropping everything before it (e.g. "start at Main instead"). */
export function startAtPickup(sc0: Scenario, stopId: string): Scenario {
  const sc = clone(sc0);
  const hit = findStop(sc, stopId);
  if (!hit?.spoke || hit.index === 0) return sc0;
  const sp = hit.spoke;
  healPath(sp, endOf(sc, sp));
  const i = sp.path!.findIndex((p) => same(p, hit.stop.lngLat));
  for (const p of [...sp.pickups.slice(0, hit.index - 1), hit.stop]) {
    for (const j of joinersOf(sc, p.id)) { retarget(j, p.lngLat, sc.merge.lngLat); delete j.joinsAt; }
  }
  const dropped = [sp.start, ...sp.pickups.slice(0, hit.index - 1)];
  const carried = dropped.reduce((a, s) => a + Math.max(0, s.riders), 0);
  sp.start = { ...hit.stop, riders: hit.stop.riders + carried };
  sp.pickups = sp.pickups.slice(hit.index);
  sp.path = sp.path!.slice(i);
  return sc;
}

export interface StopPatch { name?: string; riders?: number; ages?: Partial<Record<AgeGroup, number>> | null }

export function updateStop(sc0: Scenario, stopId: string, patch: StopPatch): Scenario {
  const sc = clone(sc0);
  const hit = findStop(sc, stopId);
  if (!hit) return sc0;
  if (patch.name !== undefined) hit.stop.name = patch.name;
  if (patch.riders !== undefined) hit.stop.riders = Math.max(0, Math.round(patch.riders));
  if (patch.ages === null) delete hit.stop.ages;
  else if (patch.ages) hit.stop.ages = { ...patch.ages };
  return sc;
}

export function updateSpoke(sc0: Scenario, spokeId: string, patch: Partial<Pick<Spoke, 'name' | 'area' | 'arrivalOffsetMin'>>): Scenario {
  const sc = clone(sc0);
  const sp = sc.spokes.find((s) => s.id === spokeId);
  if (!sp) return sc0;
  Object.assign(sp, patch);
  return sc;
}

/**
 * Make a spoke end by joining another spoke at one of its pickups (or ride to
 * the merge point again with null). A spoke that others join can't itself join.
 */
export function setJoin(sc0: Scenario, spokeId: string, stopId: string | null): Scenario {
  const sc = clone(sc0);
  const sp = sc.spokes.find((s) => s.id === spokeId);
  if (!sp) return sc0;
  if (stopId && sp.pickups.concat(sp.start).some((p) => joinersOf(sc, p.id).length)) return sc0;
  const from = endOf(sc, sp);
  if (stopId) {
    sp.joinsAt = stopId;
    if (!joinTarget(sc, sp)) return sc0;
  } else delete sp.joinsAt;
  retarget(sp, from, endOf(sc, sp));
  return sc;
}
