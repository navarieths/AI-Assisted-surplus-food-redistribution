import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WEIGHT_KEYS,
  resolveWeights,
  weightsTotal,
  acceptedCategories,
  preferredCategory,
  foodCompatibilityRatio,
  quantityFitRatio,
  roadDistanceRatio,
  demandRatio,
  evaluateTimeFeasibility,
  hardFilterReasons,
  scoreCandidate,
  templateExplanation,
  rankCandidates,
} from '../src/services/matching.js';
import { DEFAULT_MATCH_WEIGHTS } from '../src/config.js';

/* Fixtures use local midday so collection-hours maths is timezone-stable. */
function at(hoursFromNoon) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return new Date(d.getTime() + hoursFromNoon * 3600000).toISOString();
}

function listing(overrides = {}) {
  return {
    id: 1,
    title: 'Test listing',
    food_type: 'veg',
    servings: 50,
    ready_at: at(1),
    pickup_deadline: at(5),
    lat: 12.9716,
    lng: 77.5946,
    ...overrides,
  };
}

function recipient(overrides = {}) {
  return {
    id: 1,
    name: 'Test Recipient',
    capacity_servings: 100,
    demand: 0.5,
    accepted_categories: 'veg',
    collection_open: '08:00',
    collection_close: '22:00',
    ...overrides,
  };
}

const route = (distanceKm = 5, durationMin = 20, estimated = true) => ({
  distanceKm,
  durationMin,
  estimated,
});

/* ------------------------------- weights --------------------------------- */

test('default matching weights are 25/25/15/20/15 and total 100', () => {
  const w = resolveWeights();
  assert.deepEqual(w, DEFAULT_MATCH_WEIGHTS);
  assert.equal(w.foodCompatibility, 25);
  assert.equal(w.demand, 25);
  assert.equal(w.quantityFit, 15);
  assert.equal(w.roadDistance, 20);
  assert.equal(w.timeFeasibility, 15);
  assert.equal(weightsTotal(w), 100);
});

test('weights can be overridden per key', () => {
  const w = resolveWeights({ demand: 40, roadDistance: 5 });
  assert.equal(w.demand, 40);
  assert.equal(w.roadDistance, 5);
  assert.equal(w.foodCompatibility, 25); // untouched default
  assert.deepEqual(Object.keys(w).sort(), [...WEIGHT_KEYS].sort());
});

/* ----------------------------- hard-filter inputs ------------------------ */

test('acceptedCategories derives from veg_only when no explicit list', () => {
  assert.deepEqual(acceptedCategories({ veg_only: 1 }), ['veg']);
  assert.deepEqual(acceptedCategories({ veg_only: 0 }), ['veg', 'nonveg']);
  assert.deepEqual(acceptedCategories({ accepted_categories: 'veg, NonVeg' }), ['veg', 'nonveg']);
});

test('preferredCategory is the first accepted category', () => {
  assert.equal(preferredCategory({ veg_only: 1 }), 'veg');
  assert.equal(preferredCategory({ accepted_categories: 'veg' }), 'veg');
  assert.equal(preferredCategory({ accepted_categories: 'veg,nonveg' }), 'veg');
  assert.equal(preferredCategory({ accepted_categories: 'nonveg,veg' }), 'nonveg');
  assert.equal(preferredCategory({ veg_only: 0 }), null);
});

test('foodCompatibilityRatio rewards preferred food and rejects unaccepted', () => {
  assert.equal(foodCompatibilityRatio({ accepted_categories: 'veg' }, listing({ food_type: 'veg' })), 1);
  assert.equal(foodCompatibilityRatio({ accepted_categories: 'veg,nonveg' }, listing({ food_type: 'veg' })), 1);
  assert.equal(
    foodCompatibilityRatio({ accepted_categories: 'veg,nonveg' }, listing({ food_type: 'nonveg' })),
    0.6
  );
  assert.equal(foodCompatibilityRatio({ veg_only: 1 }, listing({ food_type: 'nonveg' })), 0);
});

test('quantityFitRatio penalises overflow past capacity', () => {
  assert.equal(quantityFitRatio({ capacity_servings: 0 }, listing({ servings: 50 })), 1);
  assert.equal(quantityFitRatio({ capacity_servings: 100 }, listing({ servings: 50 })), 1);
  assert.equal(quantityFitRatio({ capacity_servings: 50 }, listing({ servings: 50 })), 1);
  assert.equal(quantityFitRatio({ capacity_servings: 40 }, listing({ servings: 50 })), 0.75);
  assert.equal(quantityFitRatio({ capacity_servings: 25 }, listing({ servings: 50 })), 0);
});

test('roadDistanceRatio is linear and clamped', () => {
  assert.equal(roadDistanceRatio(0, 30), 1);
  assert.equal(roadDistanceRatio(15, 30), 0.5);
  assert.equal(roadDistanceRatio(30, 30), 0);
  assert.equal(roadDistanceRatio(45, 30), 0);
});

test('demandRatio clamps to 0..1 with a sensible default', () => {
  assert.equal(demandRatio({ demand: 0.7 }), 0.7);
  assert.equal(demandRatio({ demand: 2 }), 1);
  assert.equal(demandRatio({ demand: -1 }), 0);
  assert.equal(demandRatio({}), 0.5);
});

/* --------------------------- time feasibility ---------------------------- */

test('a comfortable window is feasible with a positive ratio', () => {
  const t = evaluateTimeFeasibility({
    listing: listing(),
    recipient: recipient(),
    route: route(5, 20),
    volunteerTravelMin: 10,
  });
  assert.equal(t.feasible, true);
  assert.ok(t.ratio > 0 && t.ratio <= 1);
  assert.deepEqual(t.reasons, []);
});

test('pickup after the deadline is infeasible', () => {
  const t = evaluateTimeFeasibility({
    listing: listing({ pickup_deadline: at(0.5) }),
    recipient: recipient(),
    route: route(5, 20),
    volunteerTravelMin: 10,
  });
  assert.equal(t.feasible, false);
  assert.ok(t.reasons.some((r) => /deadline/.test(r)));
});

test('delivery outside collection hours is infeasible', () => {
  const t = evaluateTimeFeasibility({
    listing: listing(),
    recipient: recipient({ collection_open: '06:00', collection_close: '07:00' }),
    route: route(5, 20),
    volunteerTravelMin: 10,
  });
  assert.equal(t.feasible, false);
  assert.ok(t.reasons.some((r) => /collection/.test(r)));
});

test('hardFilterReasons flags unaccepted category and bad timing', () => {
  assert.deepEqual(
    hardFilterReasons({
      listing: listing(),
      recipient: recipient(),
      route: route(),
      volunteerTravelMin: 10,
    }),
    []
  );
  const reasons = hardFilterReasons({
    listing: listing({ food_type: 'nonveg' }),
    recipient: recipient({ accepted_categories: 'veg' }),
    route: route(),
    volunteerTravelMin: 10,
  });
  assert.ok(reasons.some((r) => /not accepted/i.test(r)));
});

/* -------------------------------- scoring -------------------------------- */

test('scoreCandidate returns a 0..100 score whose parts sum to the total', () => {
  const { score, breakdown } = scoreCandidate({
    listing: listing(),
    recipient: recipient({ demand: 0.8 }),
    route: route(5, 20),
    volunteerTravelMin: 10,
  });
  assert.ok(score >= 0 && score <= 100, `score in range, got ${score}`);
  for (const key of WEIGHT_KEYS) {
    assert.ok(key in breakdown, `${key} in breakdown`);
    assert.ok(key in breakdown.weights, `${key} in weights`);
  }
  const sum = WEIGHT_KEYS.reduce((acc, key) => acc + breakdown[key], 0);
  assert.ok(Math.abs(sum - score) < 0.11, `parts sum (${sum}) ~= score (${score})`);
  assert.equal(breakdown.estimated, true);
  assert.equal(breakdown.distanceKm, 5);
  assert.equal(breakdown.ratios.foodCompatibility, 1);
  assert.equal(breakdown.ratios.demand, 0.8);
});

test('templateExplanation mentions estimated vs live road route', () => {
  const { breakdown } = scoreCandidate({
    listing: listing(),
    recipient: recipient(),
    route: route(5, 20),
    volunteerTravelMin: 10,
  });
  const estimated = templateExplanation(listing(), recipient(), breakdown);
  assert.match(estimated, /estimated/);
  assert.match(estimated, /score/i);

  const live = templateExplanation(listing(), recipient(), { ...breakdown, estimated: false });
  assert.match(live, /live road route/);
});

/* ------------------------------- ranking --------------------------------- */

test('rankCandidates applies hard filters, ranks and caps at the limit', async () => {
  const l = listing({ food_type: 'veg', servings: 50 });
  const mk = (id, over = {}) => recipient({ id, name: `R${id}`, ...over });
  const candidates = [
    mk(1), mk(2), mk(3), mk(4), mk(5), mk(6),
    mk(7, { accepted_categories: 'nonveg' }), // fails category filter
    mk(8, { collection_open: '06:00', collection_close: '07:00' }), // fails time filter
  ];
  const routeFn = async (_listing, r) => route(2 + r.id, 10 + r.id);

  const { scored, filtered, considered } = await rankCandidates({
    listing: l,
    candidates,
    routeFn,
    volunteerTravelMin: 5,
    limit: 5,
  });

  assert.equal(considered, 8);
  assert.equal(filtered.category, 1);
  assert.equal(filtered.time, 1);
  assert.equal(scored.length, 5, 'returns exactly the top 5');
  for (let i = 1; i < scored.length; i += 1) {
    assert.ok(scored[i - 1].score >= scored[i].score, 'sorted by score desc');
  }
  for (const s of scored) {
    assert.equal(typeof s.explanation, 'string');
    assert.ok(s.explanation.length > 0);
    assert.equal(s.breakdown.estimated, true);
  }
  // closest (lowest id) should rank first
  assert.equal(scored[0].recipient.id, 1);
});

test('rankCandidates returns fewer than the limit when candidates run out', async () => {
  const l = listing();
  const candidates = [recipient({ id: 1 }), recipient({ id: 2 })];
  const { scored } = await rankCandidates({
    listing: l,
    candidates,
    routeFn: async () => route(3, 12),
    volunteerTravelMin: 5,
    limit: 5,
  });
  assert.equal(scored.length, 2);
});
