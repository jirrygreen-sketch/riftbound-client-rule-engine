import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectDuelOptionalUnitPaymentV3,
} from '../dist/duel/index.js';

test('V3 inspect rejects an unadmitted or cloned session', () => {
  assert.throws(() => inspectDuelOptionalUnitPaymentV3(Object.freeze({})), /unadmitted action session/);
  assert.throws(() => inspectDuelOptionalUnitPaymentV3(structuredClone({ commandSession: {} })),
    /unadmitted action session/);
});
