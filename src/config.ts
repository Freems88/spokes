/**
 * Every default the site uses lives in this file, and the "Assumptions" panel
 * renders it. Each value is a planning assumption, not a measurement.
 *
 * Coordinates are [lng, lat] (GeoJSON order).
 */
import type { LngLat, Params, Scenario } from './model/types';

/**
 * The ride itself: what the page promotes. Fill these in; empty fields are
 * left off the page rather than shown as placeholders.
 */
export const CAMPAIGN = {
  /** Name of the ride (also the page title). */
  name: 'Spokes',
  /** Headline call to ride. */
  tagline: 'Ride in from your neighbourhood. Arrive together.',
  /** One or two sentences on why we ride. */
  cause: '',
  /** e.g. 'Saturday, June 13'. */
  date: '',
  /** Sign-up / RSVP / more-info link (https://…), optional. */
  linkUrl: '',
  linkText: 'RSVP',
};

export const DEFAULT_PARAMS: Params = {
  /** The pace the lead sets. Mass rides with mixed abilities often go 10–13 km/h. */
  cruiseKmh: 12,
  /**
   * Age groups. A group slows the column to its pace once it makes up at
   * least `paceSetShare` of the riders; it never speeds the column up past
   * cruiseKmh. All values are rough planning guesses.
   */
  ages: {
    kids: { label: 'Under 12', paceKmh: 10, spaceFactor: 1.6, marshalWeight: 2 },
    teens: { label: '12–17', paceKmh: 16, spaceFactor: 1.0, marshalWeight: 1 },
    adults: { label: '18–64', paceKmh: 16, spaceFactor: 1.0, marshalWeight: 1 },
    seniors: { label: '65+', paceKmh: 13, spaceFactor: 1.1, marshalWeight: 1 },
  },
  /** Mix used at any stop that doesn't set its own. Shares should sum to 1. */
  defaultAgeMix: { kids: 0.05, teens: 0.05, adults: 0.78, seniors: 0.12 },
  paceSetShare: 0.1,
  /** Riders side by side, averaged (some rows hold 2, some 3). */
  ridersPerRow: 2.5,
  /** Front wheel to front wheel between rows. */
  rowSpacingM: 2.5,
  /** Stop at each pickup so the new riders can join and the column can close up. */
  regroupMin: 5,
  /** Extra riding time on every leg for the unexpected: a slow light, a flat, a wrong turn. */
  slackPct: 10,
  /** Riders are asked to arrive this long before a spoke rolls out. */
  meetBeforeStartMin: 15,
  /** The final ride leaves this long after the last rider of the last spoke arrives at the merge point. */
  mergeHoldMin: 15,
  /** Marshals needed: 1 per 20–25 riders (shown as a range). */
  ridersPerMarshal: { low: 20, high: 25 },
  /**
   * Used only when a route has no real signal data yet (step 2 replaces it
   * with Toronto Open Data signals snapped to the route). Downtown arterials
   * like Bloor run about one signal every 300 m.
   */
  signalsPerKmEstimate: 3,
  /** Target time for spoke heads to reach the merge point. Start times count back from it. */
  targetMergeArrival: '12:30',
  thresholds: {
    /** Comfortable maximum column length. */
    maxColumnM: 300,
    /** Comfortable maximum time one intersection is held. */
    maxBlockageS: 75,
    /** A spoke smaller than this at its start is vulnerable and hard to see. */
    minStartRiders: 50,
    /** All spokes should reach the merge point within this window. */
    maxArrivalSpreadMin: 10,
    /** A stop farther than this from its route probably needs re-routing. */
    maxStopOffsetM: 150,
  },
};

/**
 * Default scenario.
 *
 * Every coordinate is a signalised intersection taken from the City of
 * Toronto traffic-signal dataset (PX number in the comment), so the points
 * sit on the real road. `path` gives the via points sent to the router;
 * `npm run data` caches the snapped geometry in public/data/routes.geojson.
 * Without that cache the model uses straight lines between them.
 *
 * Pickup rider counts are split so each spoke hits the stated total.
 */
export const INTERSECTIONS = {
  // West: Bloor St W
  bloorKipling: [-79.53536, 43.64179], // PX 1321
  // Tom Riley Park: on Bloor at the park's frontage, east of Islington (park outline: OpenStreetMap).
  tomRiley: [-79.5195, 43.64553],
  bloorIslington: [-79.52344, 43.64465], // PX 0339
  bloorRoyalYork: [-79.51136, 43.64736], // PX 0338
  bloorJane: [-79.48448, 43.64933], // PX 0333
  bloorRunnymede: [-79.4763, 43.65113], // PX 0331
  bloorHighPark: [-79.4653, 43.65354], // PX 0329
  bloorKeele: [-79.46005, 43.65471], // PX 0328
  bloorDundasW: [-79.45245, 43.65632], // PX 0327
  bloorLansdowne: [-79.44273, 43.65834], // PX 0326
  bloorDufferin: [-79.43536, 43.65988], // PX 0325
  bloorOssington: [-79.42566, 43.66198], // PX 0341
  bloorBathurst: [-79.41121, 43.66511], // PX 0321
  bloorSpadina: [-79.40387, 43.66666], // PX 0281
  bloorStGeorge: [-79.39984, 43.66752], // PX 0271
  bloorAvenue: [-79.39414, 43.66872], // PX 0086
  bloorBay: [-79.38951, 43.66967], // PX 0070
  // East: Danforth Ave → Bloor St E
  danforthWarden: [-79.27365, 43.69436], // PX 0358
  danforthDanforthRd: [-79.27729, 43.69365], // PX 0357
  danforthVicPark: [-79.28836, 43.69123], // PX 0355
  danforthMain: [-79.30183, 43.68815], // PX 0353
  danforthWoodbine: [-79.31278, 43.68568], // PX 0351
  danforthCoxwell: [-79.32364, 43.68337], // PX 0349
  danforthDonlands: [-79.33732, 43.68042], // PX 0347
  danforthPape: [-79.34484, 43.67895], // PX 0345
  danforthChester: [-79.35196, 43.67756], // PX 0342
  danforthBroadview: [-79.35887, 43.6762], // PX 0294
  bloorCastleFrank: [-79.3682, 43.67377], // PX 0295
  bloorSherbourne: [-79.37685, 43.67236], // PX 0262
  // North: Yonge St → St Clair Ave W → Avenue Rd
  yongeSheppard: [-79.41094, 43.76151], // PX 0125
  yongeYorkMills: [-79.40672, 43.74415], // PX 0124
  yongeLawrence: [-79.40219, 43.7251], // PX 0055
  yongeEglinton: [-79.39837, 43.70673], // PX 0049
  yongeDavisville: [-79.39664, 43.6983], // PX 0047
  yongeStClair: [-79.39414, 43.68808], // PX 0046
  avenueStClair: [-79.40149, 43.68664], // PX 0112
  avenueDupont: [-79.39763, 43.6772], // PX 0109
  avenueDavenport: [-79.3966, 43.67472], // PX 0108
  // Merge and final ride
  qpcEStJoseph: [-79.39189, 43.66592], // PX 0085, Queen's Park Cres E
  qpWellesley: [-79.39065, 43.66358], // PX 0084, Queen's Park Cres E
  qpcEGrosvenor: [-79.38991, 43.66164], // PX 2280, keeps the router out of the park paths
  universityCollege: [-79.39049, 43.65986], // PX 0083
  universityDundas: [-79.38831, 43.65479], // PX 0081
  universityQueen: [-79.38663, 43.65085], // PX 0080
  queenYork: [-79.38496, 43.65122], // PX 1691
  nps: [-79.38334, 43.65156], // Queen St W in front of the square, between York and Bay
} satisfies Record<string, LngLat>;
const I = INTERSECTIONS;

export const DEFAULT_SCENARIO: Scenario = {
  name: 'Default: three spokes to City Hall',
  merge: { id: 'merge', name: "Queen's Park", lngLat: I.qpWellesley, riders: 200 }, // downtown riders join here
  destination: { id: 'dest', name: 'Nathan Phillips Square', lngLat: I.nps, riders: 0 },
  terminalPath: [I.qpWellesley, I.qpcEGrosvenor, I.universityCollege, I.universityDundas, I.universityQueen, I.queenYork, I.nps],
  spokes: [
    {
      id: 'west',
      name: 'West',
      area: 'Etobicoke & Bloor West',
      arrivalOffsetMin: 0,
      start: { id: 'w0', name: 'Tom Riley Park', lngLat: I.tomRiley, riders: 40 },
      pickups: [
        { id: 'w1', name: 'Runnymede', lngLat: I.bloorRunnymede, riders: 70 },
        { id: 'w2', name: 'High Park', lngLat: I.bloorHighPark, riders: 90 },
        { id: 'w3', name: 'Dufferin', lngLat: I.bloorDufferin, riders: 100 },
      ],
      path: [
        I.tomRiley, I.bloorRoyalYork, I.bloorJane, I.bloorRunnymede, I.bloorHighPark,
        I.bloorKeele, I.bloorDundasW, I.bloorLansdowne, I.bloorDufferin, I.bloorOssington, I.bloorBathurst,
        I.bloorSpadina, I.bloorStGeorge, I.bloorAvenue, I.qpcEStJoseph, I.qpWellesley,
      ],
    },
    {
      id: 'east',
      name: 'East',
      area: 'The Danforth',
      arrivalOffsetMin: -4,
      start: { id: 'e1', name: 'Main', lngLat: I.danforthMain, riders: 95 },
      pickups: [
        { id: 'e2', name: 'Woodbine', lngLat: I.danforthWoodbine, riders: 70 },
        { id: 'e3', name: 'Pape', lngLat: I.danforthPape, riders: 85 },
      ],
      path: [
        I.danforthMain, I.danforthWoodbine,
        I.danforthCoxwell, I.danforthDonlands, I.danforthPape, I.danforthChester, I.danforthBroadview,
        I.bloorCastleFrank, I.bloorSherbourne, I.bloorBay, I.bloorAvenue, I.qpcEStJoseph, I.qpWellesley,
      ],
    },
    {
      id: 'north',
      name: 'North',
      area: 'Midtown',
      arrivalOffsetMin: -8,
      start: { id: 'n1', name: 'Eglinton', lngLat: I.yongeEglinton, riders: 110 },
      pickups: [
        { id: 'n2', name: 'St Clair', lngLat: I.yongeStClair, riders: 65 },
      ],
      // Leaves Yonge at St Clair so it doesn't share Bloor with the East spoke.
      path: [
        I.yongeEglinton, I.yongeDavisville, I.yongeStClair,
        I.avenueStClair, I.avenueDupont, I.avenueDavenport, I.bloorAvenue, I.qpcEStJoseph, I.qpWellesley,
      ],
    },
  ],
};
