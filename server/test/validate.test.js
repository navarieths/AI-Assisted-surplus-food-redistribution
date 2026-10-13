import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateListing,
  loadSafetyRules,
  getSafetyRules,
  SAFETY_DISCLAIMER,
} from '../src/services/validate.js';

const future = (h) => new Date(Date.now() + h * 3600000).toISOString();
const past = (h) => new Date(Date.now() - h * 3600000).toISOString();

function base(overrides = {}) {
  return {
    food_type: 'veg',
    quantity_kg: 5,
    servings: 20,
    prepared_at: past(1),
    ready_at: future(0.5),
    pickup_deadline: future(4),
    lat: 12.9716,
    lng: 77.5946,
    address: 'MG Road, Bengaluru',
    storage_condition: 'chilled',
    allergens: 'Contains milk',
    packaging: 'Sealed trays',
    handling_notes: 'Keep refrigerated below 5°C.',
    description: 'Fresh vegetarian food from the lunch service.',
    ...overrides,
  };
}

test('a clean listing passes all rule checks', () => {
  const res = validateListing(base());
  assert.equal(res.eligible, true);
  assert.equal(res.flags.length, 0);
  assert.equal(res.disclaimer, SAFETY_DISCLAIMER);
});

test('non-vegetarian food stored ambient is blocked', () => {
  const res = validateListing(base({ food_type: 'nonveg', storage_condition: 'ambient' }));
  assert.equal(res.eligible, false);
  assert.ok(res.flags.some((f) => f.code === 'cold_chain' && f.severity === 'high'));
});

test('chilled non-vegetarian food is not flagged for the cold chain', () => {
  const res = validateListing(base({ food_type: 'nonveg', storage_condition: 'chilled' }));
  assert.ok(!res.flags.some((f) => f.code === 'cold_chain'));
  assert.equal(res.eligible, true);
});

test('a past pickup deadline is blocked', () => {
  const res = validateListing(base({ pickup_deadline: past(1) }));
  assert.equal(res.eligible, false);
  assert.ok(res.flags.some((f) => f.code === 'deadline_past'));
});

test('a deadline inside the configured window warns but does not block', () => {
  const res = validateListing(base({ ready_at: future(0.1), pickup_deadline: future(0.2) }));
  assert.ok(res.flags.some((f) => f.code === 'deadline_soon' && f.severity === 'medium'));
  assert.equal(res.eligible, true);
});

test('inverted ready/deadline window is blocked', () => {
  const res = validateListing(base({ ready_at: future(5), pickup_deadline: future(2) }));
  assert.equal(res.eligible, false);
  assert.ok(res.flags.some((f) => f.code === 'window_inverted'));
});

test('food prepared too long ago is blocked', () => {
  const res = validateListing(base({ prepared_at: past(8) }));
  assert.equal(res.eligible, false);
  assert.ok(res.flags.some((f) => f.code === 'prep_too_old'));
});

test('missing allergen declaration is an advisory, not a block', () => {
  const res = validateListing(base({ allergens: '' }));
  assert.ok(res.flags.some((f) => f.code === 'allergens_undeclared'));
  assert.equal(res.eligible, true);
});

test('missing handling/storage instructions is an advisory, not a block', () => {
  const res = validateListing(base({ handling_notes: '' }));
  assert.ok(res.flags.some((f) => f.code === 'handling_undeclared' && f.severity === 'low'));
  assert.equal(res.eligible, true);
});

test('missing address is an advisory, not a block', () => {
  const res = validateListing(base({ address: '' }));
  assert.ok(res.flags.some((f) => f.code === 'address_missing'));
  assert.equal(res.eligible, true);
});

test('missing pickup location is blocked', () => {
  const res = validateListing(base({ lat: null, lng: null }));
  assert.equal(res.eligible, false);
  assert.ok(res.flags.some((f) => f.code === 'location_missing'));
});

test('zero quantity is blocked', () => {
  const res = validateListing(base({ quantity_kg: 0 }));
  assert.equal(res.eligible, false);
  assert.ok(res.flags.some((f) => f.code === 'quantity_zero'));
});

/* ----------------------------- configuration ----------------------------- */

test('the shipped rules file loads with the expected shape', () => {
  const rules = loadSafetyRules();
  assert.equal(typeof rules.version, 'number');
  assert.equal(typeof rules.disclaimer, 'string');
  assert.ok(rules.rules && typeof rules.rules === 'object');
  assert.ok(rules.rules.cold_chain);
  assert.equal(rules.disclaimer, SAFETY_DISCLAIMER);
  assert.deepEqual(getSafetyRules(), rules);
});

test('a disabled rule is skipped', () => {
  const rules = loadSafetyRules();
  const custom = {
    ...rules,
    rules: { ...rules.rules, cold_chain: { ...rules.rules.cold_chain, enabled: false } },
  };
  const res = validateListing(
    base({ food_type: 'nonveg', storage_condition: 'ambient' }),
    Date.now(),
    custom
  );
  assert.ok(!res.flags.some((f) => f.code === 'cold_chain'));
  assert.equal(res.eligible, true);
});

test('configured thresholds are honoured', () => {
  const rules = loadSafetyRules();
  const custom = {
    ...rules,
    settings: { ...rules.settings, minDescriptionLength: 1000 },
  };
  const res = validateListing(base({ description: 'short' }), Date.now(), custom);
  assert.ok(res.flags.some((f) => f.code === 'description_thin'));
});

test('messages use values from the rules config', () => {
  const rules = loadSafetyRules();
  const custom = {
    ...rules,
    settings: { ...rules.settings, prepMaxAgeHours: 2 },
  };
  const res = validateListing(base({ prepared_at: past(3) }), Date.now(), custom);
  const flag = res.flags.find((f) => f.code === 'prep_too_old');
  assert.ok(flag);
  assert.match(flag.message, /limit 2h/);
});

test('an alternate rules file is loaded from an explicit path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safety-rules-'));
  const file = path.join(dir, 'rules.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 99,
      disclaimer: 'Custom disclaimer.',
      blockingSeverities: ['high'],
      settings: {},
      rules: {
        location_missing: { enabled: true, severity: 'high', message: 'Custom location message.' },
      },
    })
  );
  const rules = loadSafetyRules(file);
  assert.equal(rules.version, 99);
  assert.equal(rules.disclaimer, 'Custom disclaimer.');

  const res = validateListing(base({ lat: null, lng: null }), Date.now(), rules);
  assert.equal(res.disclaimer, 'Custom disclaimer.');
  assert.deepEqual(
    res.flags.map((f) => f.code),
    ['location_missing']
  );
  assert.equal(res.flags[0].message, 'Custom location message.');
});

test('an unreadable rules file fails loudly', () => {
  assert.throws(() => loadSafetyRules('/definitely/not/a/rules/file.json'), /safetyRules/);
});
