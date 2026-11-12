/**
 * "Follow the ride" camera: what should be in frame at time t. Pure; the
 * map eases toward it. Phases:
 *   overview  before anyone moves: every route
 *   converge  spokes riding in: the moving columns, riders still waiting,
 *             and the merge point, so the frame tightens as they come downtown
 *   merge     everyone gathering: close on the merge point
 *   final     the final ride: merge point to destination
 */
import { haversineM } from './geo';
import type { SimState } from './sim';
import type { LngLat, Plan } from './types';

export type CameraPhase = 'overview' | 'converge' | 'merge' | 'final';
export interface CameraTarget { phase: CameraPhase; bounds: [LngLat, LngLat] }

/** Smallest frame, in metres across, so the camera never dives into one block. */
export const MIN_SPAN_M = 900;

function box(pts: LngLat[]): [LngLat, LngLat] {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}

/** Grow a box around its centre until it spans at least `minM` each way. */
export function atLeast([[x0, y0], [x1, y1]]: [LngLat, LngLat], minM: number): [LngLat, LngLat] {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const w = haversineM([x0, cy], [x1, cy]), h = haversineM([cx, y0], [cx, y1]);
  const mPerDegY = 111_195, mPerDegX = mPerDegY * Math.cos((cy * Math.PI) / 180);
  const hx = Math.max(w, minM) / 2 / mPerDegX, hy = Math.max(h, minM) / 2 / mPerDegY;
  return [[cx - hx, cy - hy], [cx + hx, cy + hy]];
}

export function cameraTarget(plan: Plan, s: SimState): CameraTarget {
  const t = s.t;
  const merge = plan.scenario.merge.lngLat;
  const firstStart = Math.min(...plan.spokes.map((sp) => sp.startS));
  const allIn = Math.max(...plan.spokes.map((sp) => sp.tailArriveMergeS));

  if (!plan.spokes.length || t < firstStart) {
    return { phase: 'overview', bounds: box([...plan.spokes.flatMap((sp) => sp.path), ...plan.terminal.path]) };
  }
  if (t < allIn) {
    const pts: LngLat[] = [merge];
    for (const c of s.columns) if (c.id !== 'terminal') pts.push(...c.line);
    for (const b of s.blobs) if (b.kind === 'start' || b.kind === 'pickup') pts.push(b.lngLat);
    return { phase: 'converge', bounds: atLeast(box(pts), MIN_SPAN_M) };
  }
  if (t < plan.terminal.departS) {
    return { phase: 'merge', bounds: atLeast(box([merge]), MIN_SPAN_M) };
  }
  return { phase: 'final', bounds: atLeast(box([...plan.terminal.path, merge, plan.scenario.destination.lngLat]), MIN_SPAN_M) };
}
