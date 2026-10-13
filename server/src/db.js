import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('provider','recipient','volunteer','delivery_partner')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  org_name TEXT,
  lat REAL,
  lng REAL,
  address TEXT,
  veg_only INTEGER NOT NULL DEFAULT 0,
  capacity_servings INTEGER NOT NULL DEFAULT 0,
  reliability REAL NOT NULL DEFAULT 1.0,
  collection_open TEXT NOT NULL DEFAULT '08:00',
  collection_close TEXT NOT NULL DEFAULT '22:00',
  max_distance_km REAL NOT NULL DEFAULT 30,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  status TEXT NOT NULL DEFAULT 'LISTED',
  flags_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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

CREATE TABLE IF NOT EXISTS matches (
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

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  match_id INTEGER REFERENCES matches(id),
  recipient_id INTEGER NOT NULL REFERENCES users(id),
  volunteer_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'CREATED',
  pickup_otp TEXT,
  delivery_otp TEXT,
  pickup_verified_at TEXT,
  delivered_at TEXT,
  fallback INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS volunteer_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_matches_listing ON matches(listing_id);
CREATE INDEX IF NOT EXISTS idx_matches_recipient ON matches(recipient_id);
CREATE INDEX IF NOT EXISTS idx_tasks_volunteer ON tasks(volunteer_id);
CREATE INDEX IF NOT EXISTS idx_tasks_recipient ON tasks(recipient_id);
CREATE INDEX IF NOT EXISTS idx_events_listing ON status_events(listing_id);
CREATE INDEX IF NOT EXISTS idx_vloc_task ON volunteer_locations(task_id);
`;

export function initSchema() {
  db.exec(SCHEMA);
}

export const q = {
  all: (sql, params = []) => db.prepare(sql).all(params),
  get: (sql, params = []) => db.prepare(sql).get(params),
  run: (sql, params = []) => db.prepare(sql).run(params),
};

initSchema();
