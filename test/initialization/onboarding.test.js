import test from 'node:test';
import assert from 'node:assert/strict';
import { beginInitialization, completeInitializationLocation } from '../../src/initialization/onboarding.js';

test('first-run initialization requires no user birth fields or confirmation', () => {
  const result = beginInitialization({ now: '2026-11-28T00:00:00.000Z' });
  assert.equal(result.action, 'started');
  assert.equal(result.state.status, 'collecting_environment');
  assert.equal(result.state.yuanqiBirthTime, '2026-11-28T00:00:00.000Z');
  assert.deepEqual(result.state.missingFields, []);
  assert.deepEqual(result.state.locationStrategy, ['host_location_provider', 'ip_geolocation']);
});

test('unavailable automatic location does not block YuanQi initialization', () => {
  const started = beginInitialization({ now: '2026-11-28T00:00:00.000Z' });
  const ready = completeInitializationLocation(started.state, {
    status: 'unavailable',
    source: 'unavailable',
  });
  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.missingFields, []);
  assert.equal(ready.birthLocation.status, 'unavailable');
});

test('automatic IP location is retained as a distinct low-precision source', () => {
  const started = beginInitialization({ now: '2026-11-28T00:00:00.000Z' });
  const ready = completeInitializationLocation(started.state, {
    status: 'captured',
    source: 'ip_geolocation',
    latitude: 35.6762,
    longitude: 139.6503,
    accuracyMeters: null,
    timeZoneId: 'Asia/Tokyo',
  });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.birthLocation.source, 'ip_geolocation');
  assert.equal(ready.birthLocation.accuracyMeters, null);
  assert.equal(ready.birthLocation.timeZoneId, 'Asia/Tokyo');
});
