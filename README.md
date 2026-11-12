# Spokes

A promo site for a Toronto hub-and-spoke protest ride. Small rides start in neighbourhoods
across the city, pick up riders as they roll inward, meet at Queen's Park, and finish as one
short ride to City Hall. The page tells that story on an animated map, shows people where and
when to join, and keeps an editable planning model at the back for organisers.

Everything runs in the browser; there is no backend.

## Fill in the ride

Edit `CAMPAIGN` at the top of `src/config.ts`: the ride's name, tagline, a line on why we ride,
the date and an optional RSVP link. Empty fields are simply left off the page. Run `npm run og` afterwards so
the link-preview image matches; its URL in `index.html` is absolute, so update it if the site moves. Meeting points,
rider numbers and times live in `DEFAULT_SCENARIO` in the same file (or edit them on the page
under **For organisers** and share the link).

## Commands

```
npm install
npm run dev        # the site, at http://localhost:5173
npm test           # model, simulation, editing, sharing and copy tests
npm run plan       # print the default timetable and flags (--json for everything)
npm run data       # re-fetch Toronto signals and boundaries, re-route the defaults (public/data/)
npm run build      # static site in dist/
npm run og         # redraw the link-preview image and home-screen icon (public/og.png, apple-touch-icon.png)
```

## Deploy

**GitHub Pages:** push to `main`; `.github/workflows/pages.yml` tests, builds and publishes.
Once per repo: Settings → Pages → Source: **GitHub Actions**. On a free plan the repo must be public.

**Netlify:** connect the repo; `netlify.toml` has the build settings.

Re-routing after an edit uses the public OSRM server at routing.openstreetmap.de (fair use).
If it is busy or down, edited routes fall back to straight lines; the default routes are cached
and never depend on it.

## Layout

- `src/config.ts`: the ride copy (`CAMPAIGN`), every planning assumption, and the default scenario.
- `src/story.ts`, `src/charts.ts`: page copy and charts, written from the live plan.
- `src/model/`: the pure model (`model.ts`), animation state (`sim.ts`), edits, share links, routing, geometry.
- `public/data/`: cached routes (OSRM), Toronto traffic signals and former municipality boundaries (OGL–Toronto).

All times and numbers are planning estimates.
