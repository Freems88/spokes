/**
 * Plan ⇄ URL. The scenario and any changed parameters are JSON, deflated and
 * base64url-encoded into the URL fragment (`#plan=…`), so a plan is a link
 * and nothing is stored on a server.
 *
 * Decoding treats the link as untrusted: unknown keys are ignored, numbers
 * are clamped to sane ranges, strings and arrays are capped, ids de-duplicated.
 */
import { MAX_PICKUPS, MAX_SPOKES } from './edit';
import { AGE_GROUPS, type LngLat, type Params, type Scenario, type Spoke, type Stop } from './types';

export const SHARE_VERSION = 1;
const MAX_PATH = 300;

export interface Shared { scenario: Scenario; params: Params }

// ── encoding ────────────────────────────────────────────────────────────

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const ll = (p: LngLat): LngLat => [r5(p[0]), r5(p[1])];

function compactScenario(sc: Scenario): unknown {
  const stop = (s: Stop) => ({ id: s.id, n: s.name, c: ll(s.lngLat), r: s.riders, ...(s.ages ? { a: s.ages } : {}) });
  return {
    n: sc.name,
    m: stop(sc.merge),
    d: stop(sc.destination),
    t: sc.terminalPath?.map(ll),
    s: sc.spokes.map((s) => ({
      id: s.id, n: s.name, ar: s.area, o: s.arrivalOffsetMin,
      st: stop(s.start), p: s.pickups.map(stop), v: s.path?.map(ll),
    })),
  };
}

/** Leaf values of `p` that differ from `base`, as a nested object. */
function diff(p: unknown, base: unknown): unknown {
  if (typeof p !== 'object' || p === null || typeof base !== 'object' || base === null) return p === base ? undefined : p;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(base)) {
    const d = diff((p as Record<string, unknown>)[k], (base as Record<string, unknown>)[k]);
    if (d !== undefined) out[k] = d;
  }
  return Object.keys(out).length ? out : undefined;
}

const toB64url = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodePlan(sc: Scenario, params: Params, defaults: Params): Promise<string> {
  const json = JSON.stringify({ v: SHARE_VERSION, sc: compactScenario(sc), p: diff(params, defaults) ?? {} });
  return `z${toB64url(await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw')))}`;
}

// ── decoding ────────────────────────────────────────────────────────────

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown, min: number, max: number, dflt: number) =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : dflt;
const str = (x: unknown, dflt: string, max = 60) =>
  typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) || dflt : dflt;
const coord = (x: unknown): LngLat | null =>
  Array.isArray(x) && x.length === 2 && x.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
  Math.abs(x[0] as number) <= 180 && Math.abs(x[1] as number) <= 85 ? [x[0] as number, x[1] as number] : null;

class Ids {
  private seen = new Set<string>();
  private n = 0;
  take(x: unknown, prefix: string): string {
    let id = typeof x === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(x) ? x : '';
    while (!id || this.seen.has(id)) id = `${prefix}x${(++this.n).toString(36)}`;
    this.seen.add(id);
    return id;
  }
}

function readAges(x: unknown): Stop['ages'] | undefined {
  if (!isObj(x)) return undefined;
  const out: NonNullable<Stop['ages']> = {};
  for (const g of AGE_GROUPS) if (x[g] !== undefined) out[g] = num(x[g], 0, 1, 0);
  return Object.keys(out).length ? out : undefined;
}

function readStop(x: unknown, ids: Ids, prefix: string, dfltName: string): Stop | null {
  if (!isObj(x)) return null;
  const c = coord(x.c);
  if (!c) return null;
  const ages = readAges(x.a);
  return { id: ids.take(x.id, prefix), name: str(x.n, dfltName), lngLat: c, riders: Math.round(num(x.r, 0, 20000, 0)), ...(ages ? { ages } : {}) };
}

function readPath(x: unknown): LngLat[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const pts = x.slice(0, MAX_PATH).map(coord).filter((p): p is LngLat => p !== null);
  return pts.length >= 2 ? pts : undefined;
}

function readScenario(x: unknown, fallback: Scenario): Scenario {
  if (!isObj(x)) throw new Error('missing scenario');
  const ids = new Ids();
  const merge = readStop(x.m, ids, 'm', fallback.merge.name);
  const dest = readStop(x.d, ids, 'd', fallback.destination.name);
  if (!merge || !dest) throw new Error('missing merge or destination');
  const spokes: Spoke[] = [];
  for (const s of Array.isArray(x.s) ? x.s.slice(0, MAX_SPOKES) : []) {
    if (!isObj(s)) continue;
    const start = readStop(s.st, ids, 'p', 'Start');
    if (!start) continue;
    const pickups = (Array.isArray(s.p) ? s.p.slice(0, MAX_PICKUPS) : [])
      .map((p) => readStop(p, ids, 'p', 'Pickup'))
      .filter((p): p is Stop => p !== null);
    const area = typeof s.ar === 'string' ? str(s.ar, '', 40) : undefined;
    spokes.push({
      id: ids.take(s.id, 's'), name: str(s.n, `Spoke ${spokes.length + 1}`, 40),
      ...(area ? { area } : {}),
      arrivalOffsetMin: Math.round(num(s.o, -120, 120, 0)),
      start, pickups, path: readPath(s.v),
    });
  }
  return { name: str(x.n, 'Shared plan', 80), merge, destination: dest, terminalPath: readPath(x.t), spokes };
}

/** Allowed range for every numeric parameter, mirroring Params' shape. */
const RANGES = {
  cruiseKmh: [5, 30], ridersPerRow: [1, 6], rowSpacingM: [1, 6], regroupMin: [0, 30], mergeHoldMin: [0, 60],
  paceSetShare: [0, 1], signalsPerKmEstimate: [0, 10],
  ridersPerMarshal: { low: [5, 100], high: [5, 100] },
  thresholds: {
    maxColumnM: [20, 5000], maxBlockageS: [5, 1200], minStartRiders: [0, 1000],
    maxArrivalSpreadMin: [0, 120], maxStopOffsetM: [10, 2000],
  },
  defaultAgeMix: Object.fromEntries(AGE_GROUPS.map((g) => [g, [0, 1]])),
  ages: Object.fromEntries(AGE_GROUPS.map((g) => [g, { paceKmh: [3, 30], spaceFactor: [0.5, 4], marshalWeight: [0, 10] }])),
} as const;

function applyRanges(target: Record<string, unknown>, patch: unknown, ranges: Record<string, unknown>) {
  if (!isObj(patch)) return;
  for (const [k, range] of Object.entries(ranges)) {
    if (!(k in patch)) continue;
    if (Array.isArray(range)) target[k] = num(patch[k], range[0] as number, range[1] as number, target[k] as number);
    else if (isObj(target[k])) applyRanges(target[k] as Record<string, unknown>, patch[k], range as Record<string, unknown>);
  }
}

function readParams(x: unknown, defaults: Params): Params {
  const p = structuredClone(defaults);
  applyRanges(p as unknown as Record<string, unknown>, x, RANGES as unknown as Record<string, unknown>);
  if (isObj(x) && typeof x.targetMergeArrival === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(x.targetMergeArrival)) {
    p.targetMergeArrival = x.targetMergeArrival;
  }
  if (p.ridersPerMarshal.low > p.ridersPerMarshal.high) {
    [p.ridersPerMarshal.low, p.ridersPerMarshal.high] = [p.ridersPerMarshal.high, p.ridersPerMarshal.low];
  }
  return p;
}

export async function decodePlan(code: string, fallback: Scenario, defaults: Params): Promise<Shared> {
  if (!code.startsWith('z') || code.length > 20_000) throw new Error('not a plan link');
  const bytes = await pipe(fromB64url(code.slice(1)), new DecompressionStream('deflate-raw'));
  if (bytes.length > 500_000) throw new Error('plan too large');
  const obj: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isObj(obj) || obj.v !== SHARE_VERSION) throw new Error('unsupported plan version');
  return { scenario: readScenario(obj.sc, fallback), params: readParams(obj.p, defaults) };
}

/** Read `#plan=…` from a URL hash. */
export const planFromHash = (hash: string) => new URLSearchParams(hash.replace(/^#/, '')).get('plan');
