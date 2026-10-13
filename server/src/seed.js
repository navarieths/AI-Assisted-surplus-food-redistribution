import { db, q } from './db.js';
import { hashPassword } from './auth.js';
import { logEvent, notify } from './services/workflow.js';
import { validateListing } from './services/validate.js';

/**
 * Seed: 4 providers, 5 recipients, 4 volunteers, 3 delivery partners and 6
 * listings in different workflow states — all with real coordinates in Bengaluru.
 * A few extra delivered donations are added so the impact dashboard has data.
 */

const PASSWORD = 'password123';
const NOW = Date.now();
const H = 60 * 60 * 1000;
const D = 24 * H;

const iso = (ms) => new Date(ms).toISOString();
const hoursAgo = (h) => iso(NOW - h * H);
const hoursFromNow = (h) => iso(NOW + h * H);

function resetTables() {
  const tables = [
    'volunteer_locations',
    'notifications',
    'status_events',
    'tasks',
    'matches',
    'listings',
    'users',
  ];
  for (const t of tables) db.exec(`DELETE FROM ${t};`);
  db.exec(`DELETE FROM sqlite_sequence;`);
}

const USERS = [
  // --- 4 providers ---
  { role: 'provider', name: 'Spice Garden Restaurant', org_name: 'Spice Garden', email: 'spice@demo.test', phone: '+91 90000 10001', lat: 12.9757, lng: 77.6068, address: 'MG Road, Bengaluru' },
  { role: 'provider', name: 'Green Leaf Hotel', org_name: 'Green Leaf', email: 'greenleaf@demo.test', phone: '+91 90000 10002', lat: 12.9719, lng: 77.6412, address: 'Indiranagar, Bengaluru' },
  { role: 'provider', name: 'Nandini Bakery', org_name: 'Nandini Bakery', email: 'nandini@demo.test', phone: '+91 90000 10003', lat: 12.925, lng: 77.5938, address: 'Jayanagar, Bengaluru' },
  { role: 'provider', name: 'FreshMart Supermarket', org_name: 'FreshMart', email: 'freshmart@demo.test', phone: '+91 90000 10004', lat: 12.9698, lng: 77.75, address: 'Whitefield, Bengaluru' },
  // --- 5 recipients ---
  { role: 'recipient', name: 'Hope Foundation', org_name: 'Hope Foundation', email: 'hope@demo.test', phone: '+91 90000 20001', lat: 12.9352, lng: 77.6245, address: 'Koramangala, Bengaluru', capacity_servings: 120, veg_only: 0, collection_open: '08:00', collection_close: '21:00', reliability: 0.95 },
  { role: 'recipient', name: 'Annapurna Community Kitchen', org_name: 'Annapurna Kitchen', email: 'annapurna@demo.test', phone: '+91 90000 20002', lat: 12.9856, lng: 77.6051, address: 'Shivajinagar, Bengaluru', capacity_servings: 200, veg_only: 1, collection_open: '07:00', collection_close: '22:00', reliability: 0.9 },
  { role: 'recipient', name: 'Asha Trust Shelter', org_name: 'Asha Trust', email: 'asha@demo.test', phone: '+91 90000 20003', lat: 12.9916, lng: 77.555, address: 'Rajajinagar, Bengaluru', capacity_servings: 80, veg_only: 0, collection_open: '09:00', collection_close: '20:00', reliability: 0.85 },
  { role: 'recipient', name: 'Seva Bhojanalaya', org_name: 'Seva Bhojanalaya', email: 'seva@demo.test', phone: '+91 90000 20004', lat: 13.0035, lng: 77.5647, address: 'Malleshwaram, Bengaluru', capacity_servings: 150, veg_only: 1, collection_open: '06:00', collection_close: '21:00', reliability: 0.98 },
  { role: 'recipient', name: 'Little Drops Orphanage', org_name: 'Little Drops', email: 'littledrops@demo.test', phone: '+91 90000 20005', lat: 12.9116, lng: 77.6389, address: 'HSR Layout, Bengaluru', capacity_servings: 60, veg_only: 0, collection_open: '08:00', collection_close: '19:00', reliability: 0.8 },
  // --- 4 volunteers ---
  { role: 'volunteer', name: 'Rahul Verma', email: 'rahul@demo.test', phone: '+91 90000 30001', lat: 12.9611, lng: 77.6387, address: 'Domlur, Bengaluru' },
  { role: 'volunteer', name: 'Priya Nair', email: 'priya@demo.test', phone: '+91 90000 30002', lat: 12.9767, lng: 77.5713, address: 'Majestic, Bengaluru' },
  { role: 'volunteer', name: 'Arjun Rao', email: 'arjun@demo.test', phone: '+91 90000 30003', lat: 12.9166, lng: 77.6101, address: 'BTM Layout, Bengaluru' },
  { role: 'volunteer', name: 'Sneha Iyer', email: 'sneha@demo.test', phone: '+91 90000 30004', lat: 13.1007, lng: 77.5963, address: 'Yelahanka, Bengaluru' },
  // --- 3 delivery partners (fallback carriers) ---
  { role: 'delivery_partner', name: 'RapidRelief Logistics', org_name: 'RapidRelief', email: 'rapidrelief@demo.test', phone: '+91 90000 40001', lat: 12.9716, lng: 77.5946, address: 'Central Bengaluru' },
  { role: 'delivery_partner', name: 'CityWheels Couriers', org_name: 'CityWheels', email: 'citywheels@demo.test', phone: '+91 90000 40002', lat: 12.98, lng: 77.62, address: 'Richmond Town, Bengaluru' },
  { role: 'delivery_partner', name: 'LastMile Heroes', org_name: 'LastMile', email: 'lastmile@demo.test', phone: '+91 90000 40003', lat: 12.95, lng: 77.58, address: 'Wilson Garden, Bengaluru' },
];

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Offline deterministic score using Haversine distance (no network during seed). */
function offlineScore(listing, recipient, volunteerTravelMin = 12) {
  const distanceKm = Math.round(haversineKm(listing, recipient) * 100) / 100;
  const durationMin = Math.round((distanceKm / 25) * 60 * 10) / 10;
  const radius = 30;
  const W = { proximity: 35, capacity: 20, feasibility: 25, foodPreference: 10, reliability: 10 };
  const proximity = Math.max(0, 1 - distanceKm / radius) * W.proximity;
  let capacity = W.capacity;
  if (recipient.capacity_servings > 0 && listing.servings > recipient.capacity_servings) {
    const overflow = listing.servings / recipient.capacity_servings;
    capacity = Math.max(0, W.capacity * (2 - overflow));
  }
  const foodPreference = recipient.veg_only && listing.food_type === 'nonveg' ? 0 : W.foodPreference;
  const reliability = recipient.reliability * W.reliability;
  const readyAt = new Date(listing.ready_at);
  const pickupArrival = new Date(readyAt.getTime() + volunteerTravelMin * 60000);
  const arrival = new Date(pickupArrival.getTime() + durationMin * 60000);
  const beforeDeadline = pickupArrival <= new Date(listing.pickup_deadline);
  const open = Number((recipient.collection_open || '08:00').split(':')[0]) * 60;
  const close = Number((recipient.collection_close || '22:00').split(':')[0]) * 60;
  const arrMin = arrival.getHours() * 60 + arrival.getMinutes();
  const withinCollection = arrMin >= open && arrMin <= close;
  const feasible = beforeDeadline && withinCollection;
  const feasibility = feasible ? W.feasibility : 0;
  const score = Math.round((proximity + capacity + foodPreference + reliability + feasibility) * 10) / 10;
  const breakdown = {
    proximity: Math.round(proximity * 10) / 10,
    capacity: Math.round(capacity * 10) / 10,
    feasibility,
    foodPreference,
    reliability: Math.round(reliability * 10) / 10,
    weights: W,
    distanceKm,
    durationMin,
    estimated: true,
    volunteerTravelMin,
    pickupBy: pickupArrival.toISOString(),
    arrivalAt: arrival.toISOString(),
    feasibilityReasons: feasible
      ? []
      : [!beforeDeadline && 'Pickup after deadline.', !withinCollection && 'Outside collection hours.'].filter(Boolean),
    collectionHours: `${recipient.collection_open}-${recipient.collection_close}`,
    movable: feasible,
    score,
  };
  const explanation = `${recipient.name} is ${distanceKm} km / ~${durationMin} min from the pickup point (estimated). ${
    feasible ? 'Timings fit before the deadline and within collection hours.' : 'Timing risk on the window.'
  } Deterministic score ${score} (0-100).`;
  return { distanceKm, durationMin, score, breakdown, explanation };
}

function insertListing(row) {
  const cols = [
    'provider_id', 'title', 'description', 'food_type', 'quantity_kg', 'servings',
    'prepared_at', 'ready_at', 'pickup_deadline', 'lat', 'lng', 'address',
    'storage_condition', 'allergens', 'packaging', 'status', 'flags_json', 'created_at',
  ];
  const info = q.run(
    `INSERT INTO listings (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    cols.map((c) => row[c] ?? null)
  );
  return q.get(`SELECT * FROM listings WHERE id = ?`, [info.lastInsertRowid]);
}

function addMatch(listing, recipient, status, rank, override) {
  const s = override || offlineScore(listing, recipient);
  q.run(
    `INSERT INTO matches (listing_id, recipient_id, score, breakdown_json, explanation, distance_km,
      duration_min, estimated, rank, status) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      listing.id, recipient.id, s.score, JSON.stringify(s.breakdown), s.explanation,
      s.distanceKm, s.durationMin, 1, rank, status,
    ]
  );
  return q.get(`SELECT * FROM matches WHERE listing_id = ? AND recipient_id = ?`, [listing.id, recipient.id]);
}

function setListingStatus(listingId, from, to, reason) {
  q.run(`UPDATE listings SET status = ?, updated_at = datetime('now') WHERE id = ?`, [to, listingId]);
  logEvent(listingId, from, to, { id: 1, role: 'system' }, reason);
}

async function main() {
  resetTables();

  const pw = hashPassword(PASSWORD);
  const ids = {};
  for (const u of USERS) {
    const cols = ['role', 'name', 'email', 'phone', 'password_hash', 'org_name', 'lat', 'lng', 'address'];
    const info = q.run(
      `INSERT INTO users (${cols.join(',')}, veg_only, capacity_servings, collection_open, collection_close, reliability)
       VALUES (${cols.map(() => '?').join(',')}, ?, ?, ?, ?, ?)`,
      [
        u.role, u.name, u.email, u.phone || null, pw, u.org_name || null, u.lat, u.lng, u.address,
        u.veg_only || 0, u.capacity_servings || 0, u.collection_open || '08:00', u.collection_close || '22:00',
        u.reliability ?? 1.0,
      ]
    );
    ids[u.email] = Number(info.lastInsertRowid);
  }
  const U = (email) => ids[email];
  const user = (email) => q.get(`SELECT * FROM users WHERE id = ?`, [U(email)]);
  const provider = (email) => user(email);

  /* ---------------------- 6 listings, 6 states ---------------------- */

  // 1. LISTED — freshly created, not yet validated
  const l1 = insertListing({
    provider_id: U('spice@demo.test'),
    title: 'Veg Biryani Trays (fresh)',
    description: 'Eight trays of freshly cooked vegetable biryani from the lunch service.',
    food_type: 'veg', quantity_kg: 12, servings: 40,
    prepared_at: hoursAgo(1), ready_at: hoursFromNow(0.5), pickup_deadline: hoursFromNow(4),
    lat: 12.9757, lng: 77.6068, address: 'MG Road, Bengaluru',
    storage_condition: 'hot', allergens: 'None declared', packaging: 'Sealed food-grade trays',
    status: 'LISTED', flags_json: null, created_at: hoursAgo(0.2),
  });
  logEvent(l1.id, null, 'LISTED', provider('spice@demo.test'), 'Listing created');

  // 2. FLAGGED — non-veg stored ambient (high severity)
  const flagged = insertListing({
    provider_id: U('greenleaf@demo.test'),
    title: 'Chicken Curry & Rice (leftover)',
    description: 'Surplus chicken curry and steamed rice from the dinner buffet.',
    food_type: 'nonveg', quantity_kg: 6, servings: 25,
    prepared_at: hoursAgo(7), ready_at: hoursAgo(6), pickup_deadline: hoursFromNow(2),
    lat: 12.9719, lng: 77.6412, address: 'Indiranagar, Bengaluru',
    storage_condition: 'ambient', allergens: '', packaging: '',
    status: 'LISTED', flags_json: null, created_at: hoursAgo(6.5),
  });
  {
    const res = validateListing(flagged);
    q.run(`UPDATE listings SET flags_json = ? WHERE id = ?`, [JSON.stringify(res), flagged.id]);
    setListingStatus(flagged.id, 'LISTED', 'FLAGGED', res.summary);
  }

  // 3. OFFERED — matched and offered to recipients
  const l3 = insertListing({
    provider_id: U('nandini@demo.test'),
    title: 'Assorted Pastries & Croissants',
    description: 'End-of-day bakery items, best enjoyed today.',
    food_type: 'veg', quantity_kg: 9, servings: 50,
    prepared_at: hoursAgo(3), ready_at: hoursAgo(0.5), pickup_deadline: hoursFromNow(3),
    lat: 12.925, lng: 77.5938, address: 'Jayanagar, Bengaluru',
    storage_condition: 'ambient', allergens: 'Contains wheat, milk, eggs', packaging: 'Boxed',
    status: 'LISTED', flags_json: null, created_at: hoursAgo(3),
  });
  {
    const res = validateListing(l3);
    q.run(`UPDATE listings SET flags_json = ? WHERE id = ?`, [JSON.stringify(res), l3.id]);
    logEvent(l3.id, 'LISTED', 'ELIGIBLE', provider('nandini@demo.test'), res.summary);
    setListingStatus(l3.id, 'ELIGIBLE', 'OFFERED', 'Offered to top 3 matches');
    addMatch(l3, user('hope@demo.test'), 'OFFERED', 1);
    addMatch(l3, user('littledrops@demo.test'), 'OFFERED', 2);
    addMatch(l3, user('seva@demo.test'), 'OFFERED', 3);
    notify(U('hope@demo.test'), 'recipient', 'New surplus match', 'Assorted Pastries — accept in your inbox.', l3.id);
    notify(U('littledrops@demo.test'), 'recipient', 'New surplus match', 'Assorted Pastries — accept in your inbox.', l3.id);
  }

  // 4. ACCEPTED — recipient accepted, awaiting volunteer
  const l4 = insertListing({
    provider_id: U('freshmart@demo.test'),
    title: 'Rice & Dal (bulk cooked)',
    description: 'Two large vessels of rice and dal from the morning service.',
    food_type: 'veg', quantity_kg: 25, servings: 90,
    prepared_at: hoursAgo(1.5), ready_at: hoursAgo(0.5), pickup_deadline: hoursFromNow(5),
    lat: 12.9698, lng: 77.75, address: 'Whitefield, Bengaluru',
    storage_condition: 'hot', allergens: 'None declared', packaging: 'Insulated containers',
    status: 'LISTED', flags_json: null, created_at: hoursAgo(2),
  });
  {
    const res = validateListing(l4);
    q.run(`UPDATE listings SET flags_json = ? WHERE id = ?`, [JSON.stringify(res), l4.id]);
    logEvent(l4.id, 'LISTED', 'ELIGIBLE', provider('freshmart@demo.test'), res.summary);
    setListingStatus(l4.id, 'ELIGIBLE', 'OFFERED', 'Offered to top matches');
    setListingStatus(l4.id, 'OFFERED', 'ACCEPTED', 'Recipient accepted');
    const m = addMatch(l4, user('annapurna@demo.test'), 'ACCEPTED', 1);
    q.run(
      `INSERT INTO tasks (listing_id, match_id, recipient_id, status, delivery_otp)
       VALUES (?,?,?, 'CREATED', '654321')`,
      [l4.id, m.id, U('annapurna@demo.test')]
    );
    notify(U('freshmart@demo.test'), 'provider', 'Donation accepted', 'Annapurna Community Kitchen accepted — awaiting volunteer.', l4.id);
  }

  // 5. IN_TRANSIT — volunteer picked up, en route
  const l5 = insertListing({
    provider_id: U('spice@demo.test'),
    title: 'Sandwich Platters (chilled)',
    description: 'Assorted vegetarian sandwiches from the afternoon event.',
    food_type: 'veg', quantity_kg: 8, servings: 35,
    prepared_at: hoursAgo(2), ready_at: hoursAgo(1.2), pickup_deadline: hoursFromNow(2),
    lat: 12.9757, lng: 77.6068, address: 'MG Road, Bengaluru',
    storage_condition: 'chilled', allergens: 'Contains wheat, milk', packaging: 'Chilled boxes',
    status: 'LISTED', flags_json: null, created_at: hoursAgo(2.2),
  });
  {
    const res = validateListing(l5);
    q.run(`UPDATE listings SET flags_json = ? WHERE id = ?`, [JSON.stringify(res), l5.id]);
    logEvent(l5.id, 'LISTED', 'ELIGIBLE', provider('spice@demo.test'), res.summary);
    setListingStatus(l5.id, 'ELIGIBLE', 'OFFERED', 'Offered to top matches');
    setListingStatus(l5.id, 'OFFERED', 'ACCEPTED', 'Hope Foundation accepted');
    const m = addMatch(l5, user('hope@demo.test'), 'ACCEPTED', 1);
    setListingStatus(l5.id, 'ACCEPTED', 'VOLUNTEER_ASSIGNED', 'Rahul Verma assigned');
    const info = q.run(
      `INSERT INTO tasks (listing_id, match_id, recipient_id, volunteer_id, status, pickup_otp, delivery_otp, pickup_verified_at)
       VALUES (?,?,?,?, 'IN_TRANSIT', '135790', '246801', datetime('now','-18 minutes'))`,
      [l5.id, m.id, U('hope@demo.test'), U('rahul@demo.test')]
    );
    const taskId = Number(info.lastInsertRowid);
    setListingStatus(l5.id, 'VOLUNTEER_ASSIGNED', 'PICKED_UP', 'Pickup OTP verified');
    setListingStatus(l5.id, 'PICKED_UP', 'IN_TRANSIT', 'En route to recipient');
    // a short breadcrumb trail between MG Road and Koramangala
    const trail = [
      [12.9700, 77.6150], [12.9600, 77.6200], [12.9500, 77.6225], [12.9430, 77.6240],
    ];
    trail.forEach(([lat, lng], i) => {
      q.run(
        `INSERT INTO volunteer_locations (task_id, volunteer_id, lat, lng, recorded_at)
         VALUES (?,?,?,?, datetime('now', ?))`,
        [taskId, U('rahul@demo.test'), lat, lng, `-${(trail.length - i) * 3} minutes`]
      );
    });
    notify(U('hope@demo.test'), 'recipient', 'Donation on the way', 'Rahul Verma picked up your sandwiches.', l5.id);
  }

  // 6. DELIVERED — completed today
  const l6 = insertListing({
    provider_id: U('nandini@demo.test'),
    title: 'Breads & Buns (packaged)',
    description: 'Sealed packets of breads and buns from the morning bake.',
    food_type: 'veg', quantity_kg: 15, servings: 60,
    prepared_at: hoursAgo(5), ready_at: hoursAgo(4), pickup_deadline: hoursAgo(1),
    lat: 12.925, lng: 77.5938, address: 'Jayanagar, Bengaluru',
    storage_condition: 'ambient', allergens: 'Contains wheat, gluten', packaging: 'Sealed packets',
    status: 'LISTED', flags_json: null, created_at: hoursAgo(6),
  });
  {
    const res = validateListing(l6);
    q.run(`UPDATE listings SET flags_json = ? WHERE id = ?`, [JSON.stringify(res), l6.id]);
    logEvent(l6.id, 'LISTED', 'ELIGIBLE', provider('nandini@demo.test'), res.summary);
    setListingStatus(l6.id, 'ELIGIBLE', 'OFFERED', 'Offered');
    setListingStatus(l6.id, 'OFFERED', 'ACCEPTED', 'Hope Foundation accepted');
    const m = addMatch(l6, user('hope@demo.test'), 'ACCEPTED', 1);
    setListingStatus(l6.id, 'ACCEPTED', 'VOLUNTEER_ASSIGNED', 'Priya Nair assigned');
    const info = q.run(
      `INSERT INTO tasks (listing_id, match_id, recipient_id, volunteer_id, status, pickup_otp, delivery_otp, pickup_verified_at, delivered_at)
       VALUES (?,?,?,?, 'DELIVERED', '111222', '333444', datetime('now','-4 hours'), datetime('now','-3 hours'))`,
      [l6.id, m.id, U('hope@demo.test'), U('priya@demo.test')]
    );
    setListingStatus(l6.id, 'VOLUNTEER_ASSIGNED', 'PICKED_UP', 'Pickup OTP verified');
    setListingStatus(l6.id, 'PICKED_UP', 'IN_TRANSIT', 'En route');
    setListingStatus(l6.id, 'IN_TRANSIT', 'DELIVERED', 'Recipient confirmed delivery');
    notify(U('nandini@demo.test'), 'provider', 'Donation delivered', 'Hope Foundation confirmed receipt.', l6.id);
    void info;
  }

  /* --------------- extra historical deliveries for the impact page --------------- */
  const history = [
    { provider: 'spice@demo.test', recipient: 'asha@demo.test', volunteer: 'arjun@demo.test', title: 'Party Snacks', kg: 10, servings: 45, food: 'veg', days: 1, p: 0, r: 0 },
    { provider: 'greenleaf@demo.test', recipient: 'seva@demo.test', volunteer: 'rahul@demo.test', title: 'Veg Pulao', kg: 18, servings: 70, food: 'veg', days: 2, p: 1, r: 1 },
    { provider: 'freshmart@demo.test', recipient: 'littledrops@demo.test', volunteer: 'priya@demo.test', title: 'Fresh Produce Crates', kg: 22, servings: 80, food: 'veg', days: 3, p: 2, r: 2 },
    { provider: 'nandini@demo.test', recipient: 'annapurna@demo.test', volunteer: 'sneha@demo.test', title: 'Cakes & Desserts', kg: 7, servings: 30, food: 'veg', days: 4, p: 3, r: 3 },
  ];
  const geoOf = (email) => user(email);
  history.forEach((h) => {
    const pUser = geoOf(h.provider);
    const rUser = geoOf(h.recipient);
    const listing = insertListing({
      provider_id: pUser.id, title: h.title,
      description: `Historical delivered donation: ${h.title}.`,
      food_type: h.food, quantity_kg: h.kg, servings: h.servings,
      prepared_at: iso(NOW - (h.days * D + 6 * H)), ready_at: iso(NOW - (h.days * D + 5 * H)),
      pickup_deadline: iso(NOW - (h.days * D + 2 * H)),
      lat: pUser.lat, lng: pUser.lng, address: pUser.address,
      storage_condition: 'chilled', allergens: 'None declared', packaging: 'Sealed',
      status: 'LISTED', flags_json: null, created_at: iso(NOW - (h.days * D + 7 * H)),
    });
    const res = validateListing({ ...listing, prepared_at: iso(NOW - 2 * H) });
    q.run(`UPDATE listings SET flags_json = ? WHERE id = ?`, [JSON.stringify(res), listing.id]);
    logEvent(listing.id, 'LISTED', 'ELIGIBLE', { id: 1, role: 'system' }, 'Passed checks (historical)');
    setListingStatus(listing.id, 'ELIGIBLE', 'OFFERED', 'Offered');
    setListingStatus(listing.id, 'OFFERED', 'ACCEPTED', 'Accepted');
    const m = addMatch(listing, rUser, 'ACCEPTED', 1);
    setListingStatus(listing.id, 'ACCEPTED', 'VOLUNTEER_ASSIGNED', 'Volunteer assigned');
    q.run(
      `INSERT INTO tasks (listing_id, match_id, recipient_id, volunteer_id, status, pickup_otp, delivery_otp, pickup_verified_at, delivered_at)
       VALUES (?,?,?,?, 'DELIVERED', '000000', '999999', datetime('now', ?), datetime('now', ?))`,
      [listing.id, m.id, rUser.id, geoOf(h.volunteer).id, `-${h.days * 24 + 4} hours`, `-${h.days * 24 + 3} hours`]
    );
    setListingStatus(listing.id, 'VOLUNTEER_ASSIGNED', 'PICKED_UP', 'Pickup verified');
    setListingStatus(listing.id, 'PICKED_UP', 'IN_TRANSIT', 'En route');
    setListingStatus(listing.id, 'IN_TRANSIT', 'DELIVERED', 'Recipient confirmed');
  });

  const counts = q.get(`SELECT
    (SELECT COUNT(*) FROM users WHERE role='provider') AS providers,
    (SELECT COUNT(*) FROM users WHERE role='recipient') AS recipients,
    (SELECT COUNT(*) FROM users WHERE role='volunteer') AS volunteers,
    (SELECT COUNT(*) FROM users WHERE role='delivery_partner') AS partners,
    (SELECT COUNT(*) FROM listings WHERE id <= 6) AS core_listings,
    (SELECT COUNT(*) FROM listings) AS listings,
    (SELECT COUNT(*) FROM tasks WHERE status='DELIVERED') AS delivered`);

  console.log('Seed complete:', counts);
  console.log('Demo password for all accounts: ' + PASSWORD);
  console.log('Core listings: LISTED, FLAGGED, OFFERED, ACCEPTED, IN_TRANSIT, DELIVERED.');
  console.log('Extra historical deliveries were added so the impact dashboard has data.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
