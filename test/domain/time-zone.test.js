import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBirthTimeZone } from '../../src/domain/time-zone.js';

test('prefers an explicit valid IANA zone supplied by the authorized host', () => {
  assert.deepEqual(resolveBirthTimeZone({
    time_zone_id: 'Asia/Shanghai',
    latitude: 40.7128,
    longitude: -74.006,
  }), {
    time_zone_id: 'Asia/Shanghai',
    time_zone_source: 'host_location_provider',
  });
});

test('resolves Shanghai and New York IANA zones offline from authorized coordinates', () => {
  assert.deepEqual(resolveBirthTimeZone({ latitude: 31.2304, longitude: 121.4737 }), {
    time_zone_id: 'Asia/Shanghai',
    time_zone_source: 'coordinate_lookup',
  });
  assert.deepEqual(resolveBirthTimeZone({ latitude: 40.7128, longitude: -74.006 }), {
    time_zone_id: 'America/New_York',
    time_zone_source: 'coordinate_lookup',
  });
});

test('falls back from an invalid host zone to the coordinate boundary database', () => {
  assert.deepEqual(resolveBirthTimeZone({
    time_zone_id: 'Mars/Olympus',
    latitude: 31.2304,
    longitude: 121.4737,
  }), {
    time_zone_id: 'Asia/Shanghai',
    time_zone_source: 'coordinate_lookup',
  });
});

test('defaults to Beijing time when neither a valid host zone nor authorized coordinates are available', () => {
  assert.deepEqual(resolveBirthTimeZone({ latitude: null, longitude: null }), {
    time_zone_id: 'Asia/Shanghai',
    time_zone_source: 'default_beijing',
  });
  assert.deepEqual(resolveBirthTimeZone({ latitude: 91, longitude: 0 }), {
    time_zone_id: null,
    time_zone_source: 'unavailable',
  });
});
