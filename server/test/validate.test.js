import test from 'node:test';
import assert from 'node:assert/strict';
import { validateListing, SAFETY_DISCLAIMER } from '../src/services/validate.js';

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

test('a past pickup deadline is blocked', () => {
  const res = validateListing(base({ pickup_deadline: past(1) }));
  assert.equal(res.eligible, false);
  assert.ok(res.flags.some((f) => f.code === 'deadline_past'));
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

test('zero quantity is blocked', () => {
  const res = validateListing(base({ quantity_kg: 0 }));
  assert.equal(res.eligible, false);
  assert.ok(res.flags.some((f) => f.code === 'quantity_zero'));
});
