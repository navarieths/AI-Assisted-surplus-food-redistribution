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

Then open http://localhost:5173 — you'll land on the public **landing page**.
Use **Sign in** with any demo account (password `password123`) or choose a
one-click demo account on the login screen.

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
2. Eligible listings are **matched**: Haversine pre-filter → hard filters
   (accepted food category, pickup-time feasibility) → real OSRM road distance for
   the top 10 → deterministic 0–100 score. The **top 5** become offers, and the
   provider screen draws them on a map (pickup + recipient markers, route lines).
3. **Recipient** accepts an offer → listing `ACCEPTED`, an **assignment** is created.
4. The recipient/provider (or the **Carriers** screen) triggers **Rank & invite
   volunteers**: carriers are ranked by real travel time to the pickup,
   availability and feasibility, and the top few are invited. Each invitation
   has a **configurable timeout**; declining or timing out **cascades** to the
   next ranked carrier, and when the list is exhausted the provider is nudged to
   the fallback path. A volunteer can also **claim** an open pickup directly, or
   the provider can assign one directly → `VOLUNTEER_ASSIGNED`.
5. The provider is shown the **pickup OTP** (delivered via the simulated
   notification channel and stored only as a **bcrypt hash**). The volunteer
   opens the dedicated **Verify Pickup** screen, enters the code (max **5
   attempts**, then locked) → `PICKED_UP` → `IN_TRANSIT`, with the pickup
   **timestamp** recorded. The app then posts the volunteer's GPS every 10s.
6. Recipient and provider watch the live map (polled every 5s) with route,
   remaining distance and ETA. A **“Simulate movement”** dev toggle advances the
   volunteer marker along the route server-side, so the demo works from a laptop
   with no real GPS.
7. **Recipient confirms delivery** → `DELIVERED`, and the impact dashboard updates.

### Seeded listings (`npm run seed`)

Six listings in different states, all with **real coordinates in Bengaluru**:

| # | State | What it demonstrates |
|---|-------|----------------------|
| 1 | `LISTED` | Fresh listing, not yet validated |
| 2 | `FLAGGED` | Non-veg stored ambient — blocked by a high-severity rule |
| 3 | `OFFERED` | Ranked matches sent to recipients |
| 4 | `ACCEPTED` | Awaiting a volunteer — 3 ranked invitations are seeded (with expiry) |
| 5 | `IN_TRANSIT` | Volunteer picked up (OTP stored hashed), live breadcrumb trail |
| 6 | `DELIVERED` | Completed with impact data |

Extra **historical delivered** donations are also seeded so the impact
dashboard and heat/cluster map have meaningful data.

Seed totals: **4 providers, 5 recipients, 4 volunteers, 3 delivery partners**.

---

## Database schema (SQLite)

Normalised, one profile table per role (each keyed by `user_id`):

| Table | Purpose |
|-------|---------|
| `users` | Identity + auth for every role (`role`, `name`, `email`, `phone`, `password_hash`) |
| `providers` | Provider profile — `org_name`, `address`, `lat`, `lng` |
| `recipients` | Recipient profile — `org_name`, coords, `capacity_servings`, `veg_only`, `accepted_categories`, `demand`, `collection_open/close`, `reliability` |
| `volunteers` | Volunteer profile — `address`, coords, `vehicle` |
| `delivery_partners` | Delivery-partner profile — `company_name`, coords, `vehicle` |
| `listings` | Surplus food listings (incl. `handling_notes`, per-listing `contact_name`/`contact_phone`) + workflow `status` |
| `validation_results` | Rule-check history for a listing (`eligible`, `flags_json`, `disclaimer`, `checked_at`) |
| `offers` | Deterministic matches offered to recipients (`score`, `breakdown_json`, `rank`, `status`) |
| `assignments` | Pickup/delivery jobs (`offer_id`, recipient, volunteer, pickup OTP **hash**, attempts/lock, timestamps) |
| `assignment_offers` | Ranked **volunteer invitations** per assignment (`score`, `travel_min`, `distance_km`, `feasible`, `available`, `reasons_json`, `status`, `expires_at`) |
| `status_events` | Every workflow transition with actor and reason |
| `notifications` | Simulated notifications |
| `volunteer_locations` | Live carrier breadcrumbs for tracking |

Profile tables cascade from `users`. The demo DB is disposable: `server/src/db.js`
detects the older de-normalised layout and recreates the tables — run
`npm run seed` afterwards.

### API endpoints

| Area | Endpoints |
|------|-----------|
| Auth | `POST /auth/login`, `GET /auth/me`, `GET /auth/demo-accounts` |
| Geo | `GET /geo/search`, `GET /geo/reverse`, `GET /geo/route` |
| Listings | `GET/POST /listings`, `GET/PATCH /listings/:id`, `POST /listings/:id/{validate,match,expire,at-risk}`, `GET /listings/:id/offers`, `GET /listings/:id/matches` (provider match map) |
| Offers | `GET /offers`, `POST /offers/:id/{accept,decline,explain}` |
| Assignments | `GET /assignments`, `GET /assignments/available`, `GET /assignments/invitations`, `POST /assignments/invitations/:offerId/respond`, `GET /assignments/:id`, `POST /assignments/:id/{invite,claim,assign,fallback,pickup,confirm-delivery}`, `GET /assignments/:id/volunteer-offers`, `GET /assignments/:id/pickup-otp`, `POST /assignments/:id/simulate-location`, `GET /assignments/:id/track` |
| Carriers | `GET /volunteers`, `POST /volunteers/location` |
| Impact | `GET /impact` |
| Notifications | `GET /notifications`, `POST /notifications/read-all` |

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

## Validation rules (`server/config/safetyRules.json`)

Rules are **configurable data**, not code. The default file is
`server/config/safetyRules.json`; point `SAFETY_RULES_PATH` at an alternate file
to override it. Edits are picked up automatically (the file is re-read when its
mtime changes). Each rule has an `enabled` flag, a `severity` and a templated
`message` (`{minutes}`, `{age}`, `{max}`, `{min}` are filled from the listing).
Tunable thresholds live under `settings` (e.g. `prepMaxAgeHours`,
`deadlineSoonMinutes`, `minDescriptionLength`).

Rule-based, from provider-entered details only:

- location present and in range, human-readable address present
- ready time before pickup deadline; deadline not in the past (advisory if <30 min)
- quantity and servings greater than zero
- **cold chain**: non-vegetarian food may not be stored ambient
- food prepared more than 6h ago is blocked (advisory after 4h)
- allergens declared, handling/storage notes described, packaging described,
  description not empty

`high` severity → `FLAGGED`. The provider listing form collects food type,
quantity, preparation time, pickup deadline, handling/storage details, pickup
location (via `MapPicker`) and contact info. A flagged listing shows its
blocking reasons and can be **edited and resubmitted** — saving re-runs the
checks and can move it `FLAGGED → ELIGIBLE`. The app never claims to certify
food safety.

---

## Matching (`server/src/services/matching.js`)

Deterministic — **works with no AI key**:

1. Pre-filter recipients by Haversine radius (default 30 km) → closest 10.
2. **Hard filters** — a recipient is dropped before scoring if they do not accept
   the listing's food category, or if pickup would miss the deadline / delivery
   would fall outside their collection hours.
3. Fetch real road distance/duration via OSRM for the surviving candidates.
4. Score 0–100 from weighted components (defaults, configurable):

   | Component | Weight | Meaning |
   |-----------|--------|---------|
   | Food compatibility | 25 | preferred category = full; accepted-but-not-preferred = partial; unaccepted is filtered out |
   | Demand | 25 | the recipient's `demand` (current need) 0–1 |
   | Quantity fit | 15 | servings vs `capacity_servings` (over-capacity decays to 0 at 2×) |
   | Road distance | 20 | closer (via OSRM road distance) scores higher |
   | Time feasibility | 15 | slack in the pickup window and collection hours |

5. Return the **top 5** with deterministic explanation strings and an `estimated`
   flag. `GET /listings/:id/matches` returns those matches with recipient
   coordinates and the OSRM route geometry for the provider match map.

**Pickup-time feasibility** = prepared/ready time + volunteer travel + delivery
travel must land the pickup before the deadline **and** delivery inside the
recipient's collection hours.

Weights live in `server/src/config.js` (`DEFAULT_MATCH_WEIGHTS`) and can be
overridden with the `MATCH_WEIGHTS` env var as JSON, e.g.
`MATCH_WEIGHTS='{"demand":40,"roadDistance":5}'`.

An **LLM is optional** (`LLM_API_KEY`) and may only rewrite the explanation
text, never the score. Without a key, a deterministic template is used.

---

## Volunteer assignment & pickup OTP

**Ranking** (`server/src/services/volunteerAssignment.js`) scores every active
carrier (volunteer or delivery partner) deterministically:

| Component | Weight | Meaning |
|-----------|--------|---------|
| Travel time to pickup | 50 | real OSRM duration carrier → pickup (Haversine fallback), scored down to 0 at `VOLUNTEER_MAX_TRAVEL_MIN` |
| Availability | 30 | opted-in, reduced by the carrier's active task count; opted-out scores 0 |
| Feasibility | 20 | can reach the pickup before the deadline **and** deliver inside the recipient's collection hours |

The top `VOLUNTEER_OFFER_LIMIT` carriers are invited (each invitation stores
`expires_at = now + VOLUNTEER_OFFER_TIMEOUT_SEC`). Invitations are **swept
lazily** on the next relevant request: expired invitations are marked `EXPIRED`
and the assignment **cascades** to the next ranked, not-yet-invited carriers.
When nobody is left, the provider gets a notification to trigger the fallback
carrier. Accepting assigns the carrier and supersedes the remaining invitations;
declining cascades immediately.

**Pickup OTP**: a 6-digit code is generated on assignment. Only a **bcrypt hash**
is stored (`pickup_otp_hash`), the clear-text column is left `NULL`, and the
plain value is delivered to the provider through the simulated notification and
exposed via the **provider-only** `GET /assignments/:id/pickup-otp` endpoint.
Verification is capped at `OTP_MAX_ATTEMPTS` (default **5**); after that the
assignment is locked (`pickup_otp_locked`) and even a correct code is rejected
until it is re-issued. The serialized assignment never leaks the hash or the
plain OTP — carriers only see their remaining attempt count.

**Simulate movement** (`ALLOW_SIMULATION`, default on): any participant can call
`POST /assignments/:id/simulate-location` to advance the volunteer marker one
step along the real OSRM route; the breadcrumb is stored like a genuine
geolocation post, so the provider/recipient tracking screens pick it up through
normal polling. The **Task map** shows a “Simulate movement” toggle. Set
`ALLOW_SIMULATION=false` to disable the endpoint in production.

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
  `POST /volunteers/location` every **10s** while an assignment is active;
  recipient and provider screens poll `/assignments/:id/track` every **5s** and
  move the marker.
- **Task map** shows the pickup marker (green), drop marker (navy), volunteer
  marker, the OSRM route polyline, remaining distance and ETA, plus an
  **Open in Google Maps** deep link and a **Simulate movement** dev toggle.
- **Provider match map**: the provider listing screen shows the pickup marker
  (green) and each matched recipient (navy), with an OSRM route line per match,
  and labels distances that fell back to the Haversine `estimated` value.
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
| `MATCH_TOP_N` | `10` | Candidates routed with OSRM after the Haversine pre-filter |
| `MATCH_RESULT_LIMIT` | `5` | Matches returned (and drawn on the provider match map) |
| `MATCH_OFFER_LIMIT` | `5` | Top matches turned into recipient offers |
| `MATCH_WEIGHTS` | `25/25/15/20/15` | JSON overrides for `foodCompatibility`, `demand`, `quantityFit`, `roadDistance`, `timeFeasibility` |
| `VOLUNTEER_OFFER_TIMEOUT_SEC` | `600` | How long a volunteer invitation stays open before it cascades |
| `VOLUNTEER_OFFER_LIMIT` | `3` | Ranked carriers invited at once |
| `VOLUNTEER_MAX_TRAVEL_MIN` | `60` | Travel time to pickup (min) that scores zero on the travel component |
| `VOLUNTEER_WEIGHTS` | `50/30/20` | JSON overrides for `travelTime`, `availability`, `feasibility` |
| `OTP_MAX_ATTEMPTS` | `5` | Pickup OTP attempts before the assignment is locked |
| `OTP_HASH_ROUNDS` | `8` | bcrypt cost for the stored pickup OTP hash |
| `ALLOW_SIMULATION` | `true` | Enable the dev “simulate movement” endpoint |
| `GEO_TIMEOUT_MS` | `4000` | OSRM/Nominatim timeout |
| `SAFETY_RULES_PATH` | `server/config/safetyRules.json` | Alternate validation rules file |

---

## Project layout

```
server/
  src/
    index.js              Express app
    db.js                 SQLite schema + helpers
    seed.js               Bengaluru seed data
    auth.js               JWT + role middleware
    routes/               auth, geo, listings, offers, assignments, volunteers, impact, notifications
    services/
      geo.js              geocode / reverseGeocode / routeInfo (+ fallback)
      validate.js         rule-based listing validation (loads config)
      matching.js         deterministic scoring (+ optional LLM rewrite)
      workflow.js         state machine, status_events, simulated notifications, OTP issue/verify
      listings.js         shared listing/offer/assignment logic and serialisation
      volunteerAssignment.js  carrier ranking, invitations, expiry/cascade, OTP reveal
      profiles.js         per-role profile lookups (users <-> profile tables)
      access.js           contact-visibility rules
  config/
    safetyRules.json      configurable validation rules + disclaimer
  test/                   node:test unit tests
client/
  src/
    components/           Layout, MapPicker, MapView, TaskMap, LocationSharer, ui
    pages/                Landing, Login, ProviderDashboard, ListingForm/Detail,
                          RecipientInbox/Tasks, VolunteerAvailable/Tasks, TaskDetail,
                          VerifyPickup, Impact, Notifications, Carriers
    lib/                  api, auth, format, mapConfig, leafletIcons
```

---

## Privacy & authorization

Contact details (phone/email) are returned **only** to authorized participants
of a donation: the owning provider, the accepted recipient, or the assigned
volunteer/delivery partner. Everyone else sees `contactVisible: false`. A
listing may carry its own pickup `contact_name`/`contact_phone`; those are gated
the same way and never exposed on the public listing object. A volunteer who has
only been **invited** (not yet accepted) is not a participant, so they see the
pickup address but no contact details. Pickup OTP hashes and the plain OTP are
likewise never serialized to carriers.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Runs server + client together (concurrently) |
| `npm run seed` | (Re)creates the database with demo data |
| `npm test` | Backend unit tests |
| `npm run build` | Builds the client |
| `npm start` | Runs the API only |
