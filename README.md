# AI-Assisted Surplus Food Redistribution Platform

A hackathon-ready, end-to-end web app that connects food providers with surplus
food to NGOs/community kitchens, using **rule-based validation**, **deterministic
AI-free matching**, **OTP-verified volunteer pickup**, **live tracking**, a
**fallback carrier** path, and an **impact dashboard**.

> **Safety notice (also shown in the app):**
> *Checks are rule-based on provider-entered details. This platform does not certify food safety.*

> OTPs and notifications are **simulated** (shown in the UI and printed to the
> server console). There are **no payments** and no real SMS/email is sent.

---

## Stack

| Layer    | Technology |
|----------|------------|
| Frontend | React + Vite + Tailwind CSS + React Router, Leaflet + react-leaflet, Recharts, lucide-react |
| Backend  | Node + Express, JWT auth (roles: provider, recipient, volunteer, delivery_partner) |
| Database | SQLite via better-sqlite3 |
| Maps     | Nominatim geocoding, OSRM routing, OSM tiles (provider abstracted) |

Palette: navy `#0B2545`, green `#1E9E5A`, white, tint `#EAF6EE`. Mobile-friendly.

---

## Quick start

```bash
npm install          # installs client + server workspaces
npm run seed         # creates the SQLite DB with demo data
npm run dev          # starts API (:4000) and client (:5173)
```

Then open http://localhost:5173 and log in with any demo account
(password `password123`), or use the one-click demo buttons on the login screen.

```bash
npm test             # runs the backend unit tests (node:test)
npm run build        # production build of the client
```

### Demo accounts (all password `password123`)

| Role | Email |
|------|-------|
| Provider | `spice@demo.test`, `greenleaf@demo.test`, `nandini@demo.test`, `freshmart@demo.test` |
| Recipient | `hope@demo.test`, `annapurna@demo.test`, `asha@demo.test`, `seva@demo.test`, `littledrops@demo.test` |
| Volunteer | `rahul@demo.test`, `priya@demo.test`, `arjun@demo.test`, `sneha@demo.test` |
| Delivery partner | `rapidrelief@demo.test`, `citywheels@demo.test`, `lastmile@demo.test` |

---

## The demo flow

1. **Provider** creates a listing (search a real address on the map, drop a pin).
   Validation runs on save → `ELIGIBLE` or `FLAGGED` (unsafe details blocked).
2. Eligible listings are **matched**: Haversine pre-filter → real OSRM road
   distance for the top 10 → deterministic 0–100 score. Top candidates get offers.
3. **Recipient** accepts an offer → listing `ACCEPTED`, a task is created.
4. A **volunteer** claims the task (or the provider assigns one / triggers the
   fallback carrier) → `VOLUNTEER_ASSIGNED`.
5. Volunteer enters the **pickup OTP** → `PICKED_UP` → `IN_TRANSIT`, and the app
   posts the volunteer's GPS every 10s.
6. Recipient and provider watch the live map (polled every 5s) with route,
   remaining distance and ETA.
7. **Recipient confirms delivery** → `DELIVERED`, and the impact dashboard updates.

### Seeded listings (`npm run seed`)

Six listings in different states, all with **real coordinates in Bengaluru**:

| # | State | What it demonstrates |
|---|-------|----------------------|
| 1 | `LISTED` | Fresh listing, not yet validated |
| 2 | `FLAGGED` | Non-veg stored ambient — blocked by a high-severity rule |
| 3 | `OFFERED` | Ranked matches sent to recipients |
| 4 | `ACCEPTED` | Awaiting a volunteer |
| 5 | `IN_TRANSIT` | Volunteer picked up, live breadcrumb trail |
| 6 | `DELIVERED` | Completed with impact data |

Extra **historical delivered** donations are also seeded so the impact
dashboard and heat/cluster map have meaningful data.

Seed totals: **4 providers, 5 recipients, 4 volunteers, 3 delivery partners**.

---

## Workflow states (enforced server-side)

```
LISTED -> FLAGGED | ELIGIBLE -> OFFERED -> ACCEPTED -> VOLUNTEER_ASSIGNED
       -> PICKED_UP -> IN_TRANSIT -> DELIVERED
side states: DECLINED, NO_MATCH, EXPIRED, AT_RISK
```

Every transition is validated against the transition table in
`server/src/services/workflow.js` and written to `status_events` with actor,
role and reason.

---

## Validation rules (`server/src/services/validate.js`)

Rule-based, from provider-entered details only:

- location present and in range, human-readable address present
- ready time before pickup deadline; deadline not in the past (advisory if <30 min)
- quantity and servings greater than zero
- **cold chain**: non-vegetarian food may not be stored ambient
- food prepared more than 6h ago is blocked (advisory after 4h)
- allergens declared, packaging described, description not empty

`high` severity → `FLAGGED`; everything else is an advisory note. The app never
claims to certify food safety.

---

## Matching (`server/src/services/matching.js`)

Deterministic — **works with no AI key**:

1. Pre-filter recipients by Haversine radius (default 30 km) → top 10.
2. Fetch real road distance/duration via OSRM for those candidates.
3. Score 0–100 from weighted components:

   | Component | Weight |
   |-----------|--------|
   | Proximity (road distance) | 35 |
   | Capacity fit | 20 |
   | Pickup-time feasibility | 25 |
   | Food preference (veg-only recipients) | 10 |
   | Recipient reliability | 10 |

**Pickup-time feasibility** = prepared/ready time + volunteer travel + delivery
travel must fit before the pickup deadline **and** inside the recipient's
collection hours.

An **LLM is optional** (`LLM_API_KEY`) and may only rewrite the explanation
text, never the score. Without a key, a deterministic template is used.

---

## Real maps

- **`MapPicker`** is used for every location input: search box (Nominatim,
  debounced 500ms, cached, max 1 req/sec, India-biased via `countrycodes=in`),
  click/drag pin on a real Leaflet OSM map, and “Use my current location”.
  Saves **lat, lng and formatted address**.
- **`server/src/services/geo.js`** exposes `geocode(q)`, `reverseGeocode(lat,lng)`
  and `routeInfo(from,to) -> {distanceKm, durationMin, geometry}` using OSRM
  (`/route/v1/driving/{lng},{lat};{lng},{lat}?overview=full&geometries=geojson`),
  with a 4s timeout, an in-memory cache, and a **Haversine + 25 km/h fallback**
  flagged `estimated: true`.
- **Volunteer live tracking**: the volunteer app posts to
  `POST /volunteers/location` every **10s** while a task is active; recipient and
  provider screens poll `/tasks/:id/track` every **5s** and move the marker.
- **Task map** shows the pickup marker (green), drop marker (navy), volunteer
  marker, the OSRM route polyline, remaining distance and ETA, plus an
  **Open in Google Maps** deep link.
- **Map provider is abstracted**: set `MAP_PROVIDER=osm|mapbox|google`
  (default `osm`, no key). A key can be swapped in with no code changes.
- Leaflet default marker icons are fixed for Vite; custom coloured icons are used.
- The **impact page** includes a heat/cluster map of completed deliveries.

---

## Environment variables

Copy `server/.env.example` to `server/.env` (all optional for the demo):

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `4000` | API port |
| `JWT_SECRET` | dev value | Token signing |
| `MAP_PROVIDER` | `osm` | `osm` \| `mapbox` \| `google` |
| `MAPBOX_TOKEN` / `GOOGLE_MAPS_KEY` | — | required only for those providers |
| `LLM_API_KEY` | — | optional; rewrites explanations only |
| `LLM_BASE_URL` / `LLM_MODEL` | OpenAI / `gpt-4o-mini` | LLM endpoint |
| `MATCH_RADIUS_KM` | `30` | Haversine pre-filter radius |
| `GEO_TIMEOUT_MS` | `4000` | OSRM/Nominatim timeout |

---

## Project layout

```
server/
  src/
    index.js              Express app
    db.js                 SQLite schema + helpers
    seed.js               Bengaluru seed data
    auth.js               JWT + role middleware
    routes/               auth, geo, listings, matches, tasks, volunteers, impact, notifications
    services/
      geo.js              geocode / reverseGeocode / routeInfo (+ fallback)
      validate.js         rule-based listing validation
      matching.js         deterministic scoring (+ optional LLM rewrite)
      workflow.js         state machine, status_events, simulated notifications
      listings.js         shared listing/task logic and serialisation
      access.js           contact-visibility rules
  test/                   node:test unit tests
client/
  src/
    components/           Layout, MapPicker, MapView, TaskMap, LocationSharer, ui
    pages/                Login, ProviderDashboard, ListingForm/Detail, RecipientInbox/Tasks,
                          VolunteerAvailable/Tasks, TaskDetail, Impact, Notifications, Carriers
    lib/                  api, auth, format, mapConfig, leafletIcons
```

---

## Privacy & authorization

Contact details (phone/email) are returned **only** to authorized participants
of a donation: the owning provider, the accepted recipient, or the assigned
volunteer/delivery partner. Everyone else sees `contactVisible: false`.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Runs server + client together (concurrently) |
| `npm run seed` | (Re)creates the database with demo data |
| `npm test` | Backend unit tests |
| `npm run build` | Builds the client |
| `npm start` | Runs the API only |
