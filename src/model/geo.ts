import type { LngLat } from './types';

const R = 6_371_008.8; // mean Earth radius, m
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cumulative distance at each vertex; first is 0, last is total length. */
export function cumulativeM(line: LngLat[]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1]! + haversineM(line[i - 1]!, line[i]!));
  return out;
}

export function lengthM(line: LngLat[]): number {
  return cumulativeM(line).at(-1) ?? 0;
}

export interface Projection {
  /** Distance along the line to the nearest point. */
  alongM: number;
  /** Distance from the point to that nearest point. */
  offsetM: number;
}

/**
 * Nearest point on `line` to `pt`, considering only positions at or after
 * `minAlongM`, so stops can't project backwards on a route that doubles back.
 * Uses a local flat projection, which is accurate at city scale.
 */
export function project(line: LngLat[], pt: LngLat, minAlongM = 0): Projection {
  if (line.length === 0) return { alongM: 0, offsetM: 0 };
  if (line.length === 1) return { alongM: 0, offsetM: haversineM(line[0]!, pt) };
  const cum = cumulativeM(line);
  const kx = Math.cos(rad(pt[1])) * rad(1) * R;
  const ky = rad(1) * R;
  let best: Projection = { alongM: Infinity, offsetM: Infinity };
  for (let i = 0; i < line.length - 1; i++) {
    const segStart = cum[i]!;
    const segEnd = cum[i + 1]!;
    if (segEnd < minAlongM) continue;
    const a = line[i]!;
    const b = line[i + 1]!;
    const ax = (a[0] - pt[0]) * kx, ay = (a[1] - pt[1]) * ky;
    const bx = (b[0] - pt[0]) * kx, by = (b[1] - pt[1]) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const segLen = segEnd - segStart;
    if (segStart + t * segLen < minAlongM && segLen > 0) t = (minAlongM - segStart) / segLen;
    const px = ax + t * dx, py = ay + t * dy;
    const offsetM = Math.hypot(px, py);
    if (offsetM < best.offsetM) best = { alongM: segStart + t * segLen, offsetM };
  }
  return best;
}

/** Point at `alongM` metres along the line (clamped to its ends). */
export function pointAlong(line: LngLat[], alongM: number, cum = cumulativeM(line)): LngLat {
  if (line.length === 0) throw new Error('empty line');
  if (alongM <= 0) return line[0]!;
  const total = cum.at(-1)!;
  if (alongM >= total) return line.at(-1)!;
  let i = 1;
  while (cum[i]! < alongM) i++;
  const t = (alongM - cum[i - 1]!) / (cum[i]! - cum[i - 1]!);
  const a = line[i - 1]!, b = line[i]!;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

/** Sub-line between two distances; this is how the animation draws a column from tail to head. */
export function slice(line: LngLat[], fromM: number, toM: number, cum = cumulativeM(line)): LngLat[] {
  const lo = Math.max(0, Math.min(fromM, toM));
  const hi = Math.min(cum.at(-1) ?? 0, Math.max(fromM, toM));
  const out: LngLat[] = [pointAlong(line, lo, cum)];
  for (let i = 0; i < line.length; i++) if (cum[i]! > lo && cum[i]! < hi) out.push(line[i]!);
  out.push(pointAlong(line, hi, cum));
  return out;
}

/** Even–odd point-in-polygon test for one GeoJSON polygon (outer ring + holes). */
export function inPolygon(pt: LngLat, rings: LngLat[][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export interface Area { name: string; polygons: LngLat[][][] }

/** Name of the area containing the point, if any. */
export const areaAt = (pt: LngLat, areas: Area[]): string | null =>
  areas.find((a) => a.polygons.some((rings) => inPolygon(pt, rings)))?.name ?? null;
