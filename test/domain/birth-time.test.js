import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveBirthTimeContext } from '../../src/domain/birth-time.js';

test('derives Shanghai civil time and approximate apparent solar time from YuanQi UTC birth instant', () => {
  const result = deriveBirthTimeContext({
    birth_time: '2024-02-04T08:00:00.000Z',
    birth_location: {
      status: 'captured', longitude: 121.4737, latitude: 31.2304,
      time_zone_id: 'Asia/Shanghai', time_zone_source: 'host_location_provider',
    },
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.time_zone_id, 'Asia/Shanghai');
  assert.equal(result.time_zone_source, 'host_location_provider');
  assert.equal(result.local_datetime, '2024-02-04T16:00:00');
  assert.equal(result.utc_offset_minutes, 480);
  assert.ok(Math.abs(result.longitude_correction_minutes - 485.8948) < 0.000001);
  assert.ok(Math.abs(result.equation_of_time_minutes - (-13.580275)) < 0.001);
  assert.equal(result.true_solar_datetime, '2024-02-04T15:52:18');
  assert.equal(result.algorithm_version, 'noaa-eot-approx-v1');
});

test('uses the offset in force at the exact instant across a DST repeated hour', () => {
  const daylight = deriveBirthTimeContext({
    birth_time: '2024-11-03T05:30:00.000Z',
    birth_location: { status: 'captured', longitude: -74.006, time_zone_id: 'America/New_York', time_zone_source: 'host_location_provider' },
  });
  const standard = deriveBirthTimeContext({
    birth_time: '2024-11-03T06:30:00.000Z',
    birth_location: { status: 'captured', longitude: -74.006, time_zone_id: 'America/New_York', time_zone_source: 'host_location_provider' },
  });
  assert.equal(daylight.local_datetime, '2024-11-03T01:30:00');
  assert.equal(standard.local_datetime, '2024-11-03T01:30:00');
  assert.equal(daylight.utc_offset_minutes, -240);
  assert.equal(standard.utc_offset_minutes, -300);
  assert.notEqual(daylight.true_solar_datetime, standard.true_solar_datetime);
});

test('keeps time context pending when the authorized host time zone or longitude is missing', () => {
  const missingZone = deriveBirthTimeContext({
    birth_time: '2024-02-04T08:00:00.000Z',
    birth_location: { status: 'captured', longitude: 121.4737 },
  });
  const missingLongitude = deriveBirthTimeContext({
    birth_time: '2024-02-04T08:00:00.000Z',
    birth_location: { status: 'captured', time_zone_id: 'Asia/Shanghai', time_zone_source: 'host_location_provider', longitude: null },
  });
  assert.equal(missingZone.status, 'unavailable');
  assert.equal(missingZone.local_datetime, null);
  assert.equal(missingLongitude.status, 'pending');
});

test('does not derive civil time until the host location is marked captured', () => {
  const pending = deriveBirthTimeContext({
    birth_time: '2024-02-04T08:00:00.000Z',
    birth_location: { status: 'pending', longitude: 121.4737, time_zone_id: 'Asia/Shanghai' },
  });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.local_datetime, null);
});

test('does not infer a time zone or coordinates when host location is unavailable', () => {
  const result = deriveBirthTimeContext({
    birth_time: '2024-02-04T08:00:00.000Z',
    birth_location: { status: 'unavailable' },
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.time_zone_id, null);
  assert.equal(result.true_solar_datetime, null);
});

test('rejects invalid timestamps, IANA zones and longitude values', () => {
  assert.throws(() => deriveBirthTimeContext({ birth_time: 'not-a-date', birth_location: {} }), /ISO timestamp/);
  const invalidZone = deriveBirthTimeContext({
    birth_time: '2024-02-04T08:00:00.000Z',
    birth_location: { status: 'captured', longitude: 0, time_zone_id: 'Mars/Olympus', time_zone_source: 'host_location_provider' },
  });
  assert.equal(invalidZone.status, 'unavailable');
  assert.throws(() => deriveBirthTimeContext({
    birth_time: '2024-02-04T08:00:00.000Z',
    birth_location: { status: 'captured', longitude: 181, time_zone_id: 'UTC', time_zone_source: 'host_location_provider' },
  }), /longitude/);
});
