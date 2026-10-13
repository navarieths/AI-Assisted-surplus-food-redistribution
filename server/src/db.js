import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Normalised schema:
 *   users              — identity + auth for every role
 *   providers          — provider profile (keyed by user_id)
 *   recipients         — recipient profile (keyed by user_id)
 *   volunteers         — volunteer profile (keyed by user_id)
 *   delivery_partners  — delivery partner profile (keyed by user_id)
 *   listings           — surplus food listings
 *   validation_results — rule-check history for a listing
 *   offers             — deterministic matches offered to recipients
 *   assignments        — pickup/delivery jobs (offer accepted -> assigned carrier)
 *   status_events      — every workflow transition
 *   notifications      — simulated notifications
 *   volunteer_locations— live carrier breadcrumbs for tracking
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('provider','recipient','volunteer','delivery_partner')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS providers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_name TEXT,
  address TEXT,
  lat REAL,
  lng REAL
);

CREATE TABLE IF NOT EXISTS recipients (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_name TEXT,
  address TEXT,
  lat REAL,
  lng REAL,
  capacity_servings INTEGER NOT NULL DEFAULT 0,
  veg_only INTEGER NOT NULL DEFAULT 0,
  accepted_categories TEXT,
  demand REAL NOT NULL DEFAULT 0.5,
  collection_open TEXT NOT NULL DEFAULT '08:00',
  collection_close TEXT NOT NULL DEFAULT '22:00',
  reliability REAL NOT NULL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS volunteers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  address TEXT,
  lat REAL,
  lng REAL,
  vehicle TEXT,
  available INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS delivery_partners (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company_name TEXT,
  address TEXT,
  lat REAL,
  lng REAL,
  vehicle TEXT
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  food_type TEXT NOT NULL DEFAULT 'veg' CHECK (food_type IN ('veg','nonveg')),
  quantity_kg REAL NOT NULL DEFAULT 0,
  servings INTEGER NOT NULL DEFAULT 0,
  prepared_at TEXT,
  ready_at TEXT NOT NULL,
  pickup_deadline TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  address TEXT,
  storage_condition TEXT NOT NULL DEFAULT 'ambient'
    CHECK (storage_condition IN ('ambient','chilled','frozen','hot')),
  allergens TEXT,
  packaging TEXT,
  handling_notes TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'LISTED',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS validation_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  eligible INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  disclaimer TEXT,
  flags_json TEXT,
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id INTEGER,
  actor_role TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id),
  score REAL NOT NULL,
  breakdown_json TEXT NOT NULL,
  explanation TEXT,
  distance_km REAL,
  duration_min REAL,
  estimated INTEGER NOT NULL DEFAULT 0,
  rank INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'CANDIDATE'
    CHECK (status IN ('CANDIDATE','OFFERED','ACCEPTED','DECLINED','EXPIRED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (listing_id, recipient_id)
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  offer_id INTEGER REFERENCES offers(id),
  recipient_id INTEGER NOT NULL REFERENCES users(id),
  volunteer_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'CREATED',
  pickup_otp TEXT,
  pickup_otp_hash TEXT,
  pickup_otp_attempts INTEGER NOT NULL DEFAULT 0,
  pickup_otp_locked INTEGER NOT NULL DEFAULT 0,
  pickup_otp_issued_at TEXT,
  delivery_otp TEXT,
  pickup_verified_at TEXT,
  delivered_at TEXT,
  fallback INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assignment_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  volunteer_id INTEGER NOT NULL REFERENCES users(id),
  rank INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  travel_min REAL,
  distance_km REAL,
  feasible INTEGER NOT NULL DEFAULT 1,
  available INTEGER NOT NULL DEFAULT 1,
  reasons_json TEXT,
  status TEXT NOT NULL DEFAULT 'OFFERED'
    CHECK (status IN ('OFFERED','ACCEPTED','DECLINED','EXPIRED')),
  expires_at TEXT,
  responded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (assignment_id, volunteer_id)
);

CREATE TABLE IF NOT EXISTS volunteer_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  volunteer_id INTEGER NOT NULL REFERENCES users(id),
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  role TEXT,
  channel TEXT NOT NULL DEFAULT 'simulated',
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  listing_id INTEGER,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_provider ON listings(provider_id);
CREATE INDEX IF NOT EXISTS idx_validation_listing ON validation_results(listing_id);
CREATE INDEX IF NOT EXISTS idx_offers_listing ON offers(listing_id);
CREATE INDEX IF NOT EXISTS idx_offers_recipient ON offers(recipient_id);
CREATE INDEX IF NOT EXISTS idx_assignments_volunteer ON assignments(volunteer_id);
CREATE INDEX IF NOT EXISTS idx_assignments_recipient ON assignments(recipient_id);
CREATE INDEX IF NOT EXISTS idx_events_listing ON status_events(listing_id);
CREATE INDEX IF NOT EXISTS idx_vloc_assignment ON volunteer_locations(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_offers_assignment ON assignment_offers(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_offers_volunteer ON assignment_offers(volunteer_id);
`;

const LEGACY_TABLES = [
  'volunteer_locations',
  'notifications',
  'status_events',
  'assignment_offers',
  'assignments',
  'offers',
  'validation_results',
  'listings',
  'delivery_partners',
  'volunteers',
  'recipients',
  'providers',
  'users',
  // pre-normalisation tables
  'tasks',
  'matches',
];

/**
 * The demo database is disposable. If we detect the older, de-normalised schema
 * (single users table with profile columns / matches / tasks), drop the app
 * tables so the new normalised schema can be created. Re-run `npm run seed`.
 */
function migrateLegacySchema() {
  const has = (name) =>
    Boolean(
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(name)
    );
  const listingCols = has('listings')
    ? db.prepare(`PRAGMA table_info(listings)`).all().map((c) => c.name)
    : [];
  const legacy = has('matches') || has('tasks') || listingCols.includes('flags_json');
  if (!legacy) return;
  // eslint-disable-next-line no-console
  console.warn('[db] legacy schema detected — recreating tables. Run `npm run seed` to repopulate.');
  db.exec(LEGACY_TABLES.map((t) => `DROP TABLE IF EXISTS ${t};`).join('\n'));
}

/**
 * Additively add columns that were introduced after a database was first
 * created, so existing demo data survives schema evolution.
 */
function ensureColumns(table, columns) {
  const existing = new Set(
    db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
  );
  for (const [name, type] of columns) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
}

export function initSchema() {
  migrateLegacySchema();
  db.exec(SCHEMA);
  ensureColumns('listings', [
    ['handling_notes', 'TEXT'],
    ['contact_name', 'TEXT'],
    ['contact_phone', 'TEXT'],
  ]);
  ensureColumns('recipients', [
    ['accepted_categories', 'TEXT'],
    ['demand', 'REAL NOT NULL DEFAULT 0.5'],
  ]);
  ensureColumns('volunteers', [['available', 'INTEGER NOT NULL DEFAULT 1']]);
  ensureColumns('assignments', [
    ['pickup_otp_hash', 'TEXT'],
    ['pickup_otp_attempts', 'INTEGER NOT NULL DEFAULT 0'],
    ['pickup_otp_locked', 'INTEGER NOT NULL DEFAULT 0'],
    ['pickup_otp_issued_at', 'TEXT'],
  ]);
}

export const q = {
  all: (sql, params = []) => db.prepare(sql).all(params),
  get: (sql, params = []) => db.prepare(sql).get(params),
  run: (sql, params = []) => db.prepare(sql).run(params),
};

initSchema();
