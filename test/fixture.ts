/**
 * Frozen test fixture: the original spec scenario and assumptions
 * (13 km/h, 3-minute regroups, 5-minute merge hold, no cushion, spokes from
 * Kipling, Warden and Yonge & Sheppard). Tests use this rather than the
 * shipped defaults, so retuning the real plan doesn't break the model tests.
 */
import { DEFAULT_PARAMS, DEFAULT_SCENARIO, INTERSECTIONS as I } from '../src/config';
import type { Params, Scenario } from '../src/model/types';

export const P: Params = {
  ...structuredClone(DEFAULT_PARAMS),
  cruiseKmh: 13, finalPaceKmh: 13, regroupMin: 3, mergeHoldMin: 5, slackPct: 0, meetBeforeStartMin: 15,
};

const base = structuredClone(DEFAULT_SCENARIO);
const by = (id: string) => base.spokes.find((s) => s.id === id)!;

export const S: Scenario = {
  ...base,
  // The original merge point and final-ride path (east crescent), frozen here.
  merge: { ...base.merge, lngLat: I.qpWellesley },
  terminalPath: [I.qpWellesley, I.qpcEGrosvenor, I.universityCollege, I.universityDundas, I.universityQueen, I.queenYork, I.nps],
  spokes: [
    {
      ...by('west'), area: 'Etobicoke',
      start: { id: 'w0', name: 'Kipling & Bloor', lngLat: I.bloorKipling, riders: 40 },
      pickups: [
        { id: 'w1', name: 'Runnymede', lngLat: I.bloorRunnymede, riders: 70 },
        { id: 'w2', name: 'High Park', lngLat: I.bloorHighPark, riders: 90 },
        { id: 'w3', name: 'Dufferin', lngLat: I.bloorDufferin, riders: 100 },
      ],
      path: [
        I.bloorKipling, I.bloorIslington, I.bloorRoyalYork, I.bloorJane, I.bloorRunnymede, I.bloorHighPark,
        I.bloorKeele, I.bloorDundasW, I.bloorLansdowne, I.bloorDufferin, I.bloorOssington, I.bloorBathurst,
        I.bloorSpadina, I.bloorStGeorge, I.bloorAvenue, I.qpcEStJoseph, I.qpWellesley,
      ],
    },
    {
      ...by('east'), area: 'Scarborough',
      start: { id: 'e0', name: 'Warden & Danforth', lngLat: I.danforthWarden, riders: 35 },
      pickups: [
        { id: 'e1', name: 'Main', lngLat: I.danforthMain, riders: 60 },
        { id: 'e2', name: 'Woodbine', lngLat: I.danforthWoodbine, riders: 70 },
        { id: 'e3', name: 'Pape', lngLat: I.danforthPape, riders: 85 },
      ],
      path: [
        I.danforthWarden, I.danforthDanforthRd, I.danforthVicPark, I.danforthMain, I.danforthWoodbine,
        I.danforthCoxwell, I.danforthDonlands, I.danforthPape, I.danforthChester, I.danforthBroadview,
        I.bloorCastleFrank, I.bloorSherbourne, I.bloorBay, I.bloorAvenue, I.qpcEStJoseph, I.qpWellesley,
      ],
    },
    {
      ...by('north'), area: 'North York', joinsAt: undefined,
      start: { id: 'n0', name: 'Yonge & Sheppard', lngLat: I.yongeSheppard, riders: 50 },
      pickups: [
        { id: 'n1', name: 'Eglinton', lngLat: I.yongeEglinton, riders: 60 },
        { id: 'n2', name: 'St Clair', lngLat: I.yongeStClair, riders: 65 },
      ],
      path: [
        I.yongeSheppard, I.yongeYorkMills, I.yongeLawrence, I.yongeEglinton, I.yongeDavisville, I.yongeStClair,
        I.avenueStClair, I.avenueDupont, I.avenueDavenport, I.bloorAvenue, I.qpcEStJoseph, I.qpWellesley,
      ],
    },
  ],
};
