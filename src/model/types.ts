export type LngLat = [number, number];

export const AGE_GROUPS = ['kids', 'teens', 'adults', 'seniors'] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];
/** Head-count (or share) per age group. */
export type Crowd = Record<AgeGroup, number>;

export interface AgeProfile {
  label: string;
  /** Pace this group can comfortably hold for an hour. */
  paceKmh: number;
  /** Road space per rider relative to an adult (1 = 1 m at defaults). */
  spaceFactor: number;
  /** How many riders each one counts as when sizing marshals. */
  marshalWeight: number;
}

export interface Stop {
  id: string;
  name: string;
  lngLat: LngLat;
  /** Riders who join here (at a start: riders who set off). */
  riders: number;
  /** Age mix of those riders as shares; missing groups → 0. Missing entirely → params.defaultAgeMix. */
  ages?: Partial<Crowd>;
}

export interface Spoke {
  id: string;
  name: string;
  /** Former municipality or area, used for labels. */
  area?: string;
  start: Stop;
  pickups: Stop[];
  /** Head arrival at the merge point, relative to the target time, in minutes (negative = earlier). */
  arrivalOffsetMin: number;
  /** Route geometry from start to merge. Missing → straight segments through the stops. */
  path?: LngLat[];
  /** Signal positions as metres along `path`. Missing → estimated from signalsPerKmEstimate. */
  signalsAlongM?: number[];
}

export interface Scenario {
  name: string;
  spokes: Spoke[];
  /** Merge point; `riders` = riders who join there (downtown riders). */
  merge: Stop;
  destination: Stop;
  terminalPath?: LngLat[];
  terminalSignalsAlongM?: number[];
}

export interface Thresholds {
  maxColumnM: number;
  maxBlockageS: number;
  minStartRiders: number;
  maxArrivalSpreadMin: number;
  maxStopOffsetM: number;
}

export interface Params {
  /** The pace the lead marshal sets; slow age groups can pull it down, never up. */
  cruiseKmh: number;
  ages: Record<AgeGroup, AgeProfile>;
  defaultAgeMix: Crowd;
  /** An age group sets the pace once it is at least this share of a column. */
  paceSetShare: number;
  ridersPerRow: number;
  rowSpacingM: number;
  regroupMin: number;
  /** Extra riding time added to every leg, in percent of distance ÷ speed. */
  slackPct: number;
  /** Riders are asked to arrive this long before a spoke rolls out. */
  meetBeforeStartMin: number;
  mergeHoldMin: number;
  ridersPerMarshal: { low: number; high: number };
  signalsPerKmEstimate: number;
  /** "HH:MM", local time. */
  targetMergeArrival: string;
  thresholds: Thresholds;
}

export type FlagLevel = 'warn' | 'tradeoff' | 'info';

export interface Flag {
  level: FlagLevel;
  /** Spoke id, "terminal" or "plan". */
  scope: string;
  code: 'slow-pace' | 'long-column' | 'long-blockage' | 'small-start' | 'arrival-spread' | 'stop-off-route' | 'stop-order' | 'empty';
  message: string;
}

/** Times are seconds after midnight. */
export interface StopTiming {
  stop: Stop;
  kind: 'start' | 'pickup' | 'merge';
  alongM: number;
  /** Head of the column arrives (start: equals depart). */
  arriveS: number;
  departS: number;
  ridersAfter: number;
  crowdAfter: Crowd;
  lengthAfterM: number;
  /** Distance from the stop to the nearest point on the route. */
  offRouteM: number;
}

export interface Leg {
  fromId: string;
  toId: string;
  fromM: number;
  toM: number;
  distanceM: number;
  riders: number;
  crowd: Crowd;
  paceKmh: number;
  /** Age group setting the pace, or null when the lead's cruise speed does. */
  paceSetBy: AgeGroup | null;
  lengthM: number;
  blockageS: number;
  signals: number;
  signalsEstimated: boolean;
  departS: number;
  arriveS: number;
}

export interface Marshals {
  low: number;
  high: number;
}

export interface SpokePlan {
  id: string;
  name: string;
  area?: string;
  startS: number;
  headArriveMergeS: number;
  tailArriveMergeS: number;
  distanceM: number;
  /** Start to head arrival at the merge, including regroup stops. */
  durationS: number;
  startRiders: number;
  peakRiders: number;
  peakLengthM: number;
  maxBlockageS: number;
  signals: number;
  /** Sum over every signal of the time it is held: total cross-street wait. */
  totalHoldS: number;
  marshals: Marshals;
  stops: StopTiming[];
  legs: Leg[];
  path: LngLat[];
}

export interface TerminalPlan {
  riders: number;
  crowd: Crowd;
  paceKmh: number;
  paceSetBy: AgeGroup | null;
  joinAtMerge: number;
  lengthM: number;
  blockageS: number;
  distanceM: number;
  departS: number;
  headArriveS: number;
  tailArriveS: number;
  /** Head travel time. */
  durationS: number;
  signals: number;
  signalsEstimated: boolean;
  totalHoldS: number;
  marshals: Marshals;
  path: LngLat[];
}

export interface Plan {
  scenario: Scenario;
  params: Params;
  spokes: SpokePlan[];
  terminal: TerminalPlan;
  totalRiders: number;
  arrivalSpreadS: number;
  flags: Flag[];
}
