/**
 * Rule-based listing validation.
 *
 * IMPORTANT: these checks are rule-based on provider-entered details only.
 * The platform does NOT certify food safety.
 */

export const SAFETY_DISCLAIMER =
  'Checks are rule-based on provider-entered details. This platform does not certify food safety.';

const HOURS = 60 * 60 * 1000;

function parseTime(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function flag(code, severity, message) {
  return { code, severity, message };
}

export function validateListing(listing, now = Date.now()) {
  const flags = [];
  const ready = parseTime(listing.ready_at);
  const deadline = parseTime(listing.pickup_deadline);
  const prepared = parseTime(listing.prepared_at);

  // ---- required location & contact integrity ----
  if (!listing.lat || !listing.lng) {
    flags.push(flag('location_missing', 'high', 'Pickup location is missing on the map.'));
  } else if (Math.abs(listing.lat) > 90 || Math.abs(listing.lng) > 180) {
    flags.push(flag('location_invalid', 'high', 'Pickup coordinates are out of range.'));
  }

  // ---- time window sanity ----
  if (!ready) {
    flags.push(flag('ready_missing', 'high', 'A food-ready time is required.'));
  }
  if (!deadline) {
    flags.push(flag('deadline_missing', 'high', 'A pickup deadline is required.'));
  }
  if (ready && deadline && ready >= deadline) {
    flags.push(flag('window_inverted', 'high', 'Food-ready time must be before the pickup deadline.'));
  }
  if (deadline && deadline <= now) {
    flags.push(flag('deadline_past', 'high', 'The pickup deadline is already in the past.'));
  }
  if (deadline && deadline - now < 30 * 60 * 1000 && deadline > now) {
    flags.push(flag('deadline_soon', 'medium', 'Less than 30 minutes remain before the pickup deadline.'));
  }

  // ---- quantity ----
  if (!(listing.quantity_kg > 0)) {
    flags.push(flag('quantity_zero', 'high', 'Quantity must be greater than zero.'));
  }
  if (!(listing.servings > 0)) {
    flags.push(flag('servings_zero', 'medium', 'Servings estimate is missing or zero.'));
  }

  // ---- storage / temperature control ----
  const isPerishable = listing.food_type === 'nonveg' || listing.storage_condition === 'ambient';
  if (listing.storage_condition === 'ambient' && listing.food_type === 'nonveg') {
    flags.push(
      flag('cold_chain', 'high', 'Non-vegetarian food must be stored chilled, frozen or hot — ambient is unsafe.')
    );
  }
  if (listing.storage_condition === 'hot' && !prepared) {
    flags.push(flag('hot_no_prep', 'medium', 'Hot food should declare when it was prepared.'));
  }
  if (prepared) {
    const ageHours = (now - prepared) / HOURS;
    if (ageHours > 6) {
      flags.push(
        flag('prep_too_old', 'high', `Food was prepared ${ageHours.toFixed(1)}h ago (limit 6h).`)
      );
    } else if (ageHours > 4) {
      flags.push(flag('prep_aging', 'medium', 'Food was prepared more than 4h ago.'));
    }
    if (ageHours < -0.25) {
      flags.push(flag('prep_future', 'medium', 'Prepared time is in the future.'));
    }
  }
  if (isPerishable && listing.storage_condition === 'ambient' && !listing.packaging) {
    flags.push(flag('packaging_missing', 'medium', 'Describe packaging for ambient perishable food.'));
  }

  // ---- declarations ----
  if (!listing.allergens || !String(listing.allergens).trim()) {
    flags.push(flag('allergens_undeclared', 'medium', 'Allergen information has not been declared.'));
  }
  if (!listing.description || String(listing.description).trim().length < 10) {
    flags.push(flag('description_thin', 'low', 'Add a short description of the food.'));
  }
  if (!listing.address || !String(listing.address).trim()) {
    flags.push(flag('address_missing', 'low', 'A human-readable pickup address is missing.'));
  }

  const eligible = !flags.some((f) => f.severity === 'high');
  return {
    eligible,
    flags,
    checkedAt: new Date().toISOString(),
    disclaimer: SAFETY_DISCLAIMER,
    summary: eligible
      ? flags.length
        ? `Passed required checks with ${flags.length} advisory note(s).`
        : 'Passed all rule-based checks.'
      : `Blocked by ${flags.filter((f) => f.severity === 'high').length} high-severity rule(s).`,
  };
}
