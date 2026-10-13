/**
 * Rule-based listing validation.
 *
 * The rules themselves live in `server/config/safetyRules.json` so they can be
 * tuned without touching code. Set SAFETY_RULES_PATH to point at an alternate
 * file. The rules file is re-read automatically when it changes on disk.
 *
 * IMPORTANT: these checks are rule-based on provider-entered details only.
 * The platform does NOT certify food safety.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the shipped, default rules file. */
export const DEFAULT_RULES_PATH = path.resolve(__dirname, '../../config/safetyRules.json');

const HOURS = 60 * 60 * 1000;

/** mtime-keyed cache so edits to the JSON are picked up without a restart. */
const rulesCache = new Map();

/**
 * Load (and cache) the safety rules config. Throws a descriptive error if the
 * file is missing or malformed — the rules are a required asset.
 */
export function loadSafetyRules(file = process.env.SAFETY_RULES_PATH || DEFAULT_RULES_PATH) {
  const resolved = path.resolve(file);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (err) {
    throw new Error(`[safetyRules] cannot read rules file at ${resolved}: ${err.message}`);
  }
  const cached = rulesCache.get(resolved);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.rules;

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (err) {
    throw new Error(`[safetyRules] invalid JSON in ${resolved}: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.rules || typeof parsed.rules !== 'object') {
    throw new Error(`[safetyRules] ${resolved} must be an object with a "rules" map`);
  }
  rulesCache.set(resolved, { mtimeMs: stat.mtimeMs, rules: parsed });
  return parsed;
}

/** The active rules config (honours SAFETY_RULES_PATH). */
export function getSafetyRules() {
  return loadSafetyRules();
}

/** Mandatory disclaimer, sourced from the rules config. */
export const SAFETY_DISCLAIMER = getSafetyRules().disclaimer;

function parseTime(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Apply the configured rules to a listing.
 *
 * @param {object} listing  listing row (provider-entered details)
 * @param {number} now      reference time in epoch ms (injectable for tests)
 * @param {object} rulesConfig  rules config; defaults to the active file
 * @returns {{eligible:boolean, flags:Array, checkedAt:string, disclaimer:string, summary:string, rulesVersion:number|null}}
 */
export function validateListing(listing, now = Date.now(), rulesConfig = getSafetyRules()) {
  const settings = rulesConfig.settings || {};
  const defs = rulesConfig.rules || {};
  const flags = [];

  // Resolve a configured rule into a concrete flag, applying severity + message
  // templates. Disabled or unknown rules are skipped.
  const add = (code, params = {}) => {
    const def = defs[code];
    if (!def || def.enabled === false) return;
    const message = String(def.message || code).replace(/\{(\w+)\}/g, (match, key) =>
      params[key] !== undefined ? String(params[key]) : match
    );
    flags.push({ code, severity: def.severity || 'medium', message });
  };

  const ready = parseTime(listing.ready_at);
  const deadline = parseTime(listing.pickup_deadline);
  const prepared = parseTime(listing.prepared_at);

  const minDescriptionLength = settings.minDescriptionLength ?? 10;
  const deadlineSoonMinutes = settings.deadlineSoonMinutes ?? 30;
  const prepMaxAgeHours = settings.prepMaxAgeHours ?? 6;
  const prepAgingHours = settings.prepAgingHours ?? 4;
  const prepFutureGraceHours = settings.prepFutureGraceHours ?? 0.25;

  // ---- required location integrity ----
  if (!listing.lat || !listing.lng) {
    add('location_missing');
  } else if (Math.abs(listing.lat) > 90 || Math.abs(listing.lng) > 180) {
    add('location_invalid');
  }

  // ---- time window sanity ----
  if (!ready) add('ready_missing');
  if (!deadline) add('deadline_missing');
  if (ready && deadline && ready >= deadline) add('window_inverted');
  if (deadline && deadline <= now) {
    add('deadline_past');
  } else if (deadline && deadline - now < deadlineSoonMinutes * 60 * 1000) {
    add('deadline_soon', { minutes: deadlineSoonMinutes });
  }

  // ---- quantity ----
  if (!(listing.quantity_kg > 0)) add('quantity_zero');
  if (!(listing.servings > 0)) add('servings_zero');

  // ---- storage / temperature control ----
  const isPerishable = listing.food_type === 'nonveg' || listing.storage_condition === 'ambient';
  if (listing.storage_condition === 'ambient' && listing.food_type === 'nonveg') {
    add('cold_chain');
  }
  if (listing.storage_condition === 'hot' && !prepared) {
    add('hot_no_prep');
  }
  if (prepared) {
    const ageHours = (now - prepared) / HOURS;
    if (ageHours > prepMaxAgeHours) {
      add('prep_too_old', { age: ageHours.toFixed(1), max: prepMaxAgeHours });
    } else if (ageHours > prepAgingHours) {
      add('prep_aging', { min: prepAgingHours });
    }
    if (ageHours < -prepFutureGraceHours) {
      add('prep_future');
    }
  }
  if (isPerishable && listing.storage_condition === 'ambient' && !listing.packaging) {
    add('packaging_missing');
  }

  // ---- declarations ----
  if (!listing.allergens || !String(listing.allergens).trim()) add('allergens_undeclared');
  if (!listing.handling_notes || !String(listing.handling_notes).trim()) add('handling_undeclared');
  if (!listing.description || String(listing.description).trim().length < minDescriptionLength) {
    add('description_thin', { min: minDescriptionLength });
  }
  if (!listing.address || !String(listing.address).trim()) add('address_missing');

  const blocking = new Set(rulesConfig.blockingSeverities || ['high']);
  const eligible = !flags.some((f) => blocking.has(f.severity));

  return {
    eligible,
    flags,
    checkedAt: new Date().toISOString(),
    disclaimer: rulesConfig.disclaimer || SAFETY_DISCLAIMER,
    rulesVersion: rulesConfig.version ?? null,
    summary: eligible
      ? flags.length
        ? `Passed required checks with ${flags.length} advisory note(s).`
        : 'Passed all rule-based checks.'
      : `Blocked by ${flags.filter((f) => blocking.has(f.severity)).length} high-severity rule(s).`,
  };
}
