import test from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm } from '../src/services/geo.js';

test('haversine returns zero for identical points', () => {
  assert.equal(haversineKm({ lat: 12.97, lng: 77.59 }, { lat: 12.97, lng: 77.59 }), 0);
});

test('haversine is symmetric and roughly correct', () => {
  const mgRoad = { lat: 12.9757, lng: 77.6068 };
  const koramangala = { lat: 12.9352, lng: 77.6245 };
  const a = haversineKm(mgRoad, koramangala);
  const b = haversineKm(koramangala, mgRoad);
  assert.ok(Math.abs(a - b) < 1e-9);
  // Straight-line distance between these Bengaluru localities is ~5-7 km.
  assert.ok(a > 4 && a < 8, `expected ~5-7km, got ${a}`);
});

test('haversine scales with known 1 degree of latitude', () => {
  const d = haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  // 1 degree of latitude is ~111 km
  assert.ok(Math.abs(d - 111.19) < 1, `got ${d}`);
});
