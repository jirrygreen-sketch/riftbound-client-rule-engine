import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROTOCOL_V2_VERSION,
  isV2ClientMessage,
  isV2Command,
  isV2CommandEnvelope,
  isV2RuneResourceCommand,
} from '../../dist/v2/index.js';

const base = { commandId: 'cmd-rune-1', stateVersion: 7 };
const energy = { ...base, type: 'rune-energy', runeObjectId: 'a-rune-1', zoneEntryId: 0 };
const power = { ...base, type: 'rune-power', runeObjectId: 'a-rune-1', zoneEntryId: 12 };

test('staged rune resource guard accepts exactly the approved intent fields', () => {
  assert.equal(isV2RuneResourceCommand(energy), true);
  assert.equal(isV2RuneResourceCommand(power), true);
  assert.equal(isV2RuneResourceCommand({ ...energy, runeObjectId: 'a-rune-2', zoneEntryId: Number.MAX_SAFE_INTEGER }), true);
});

test('rune resource intents remain absent from the general V2 wire until the real handler lands', () => {
  for (const command of [energy, power]) {
    assert.equal(isV2Command(command), false);
    assert.equal(isV2CommandEnvelope({ contract: 'riftbound.protocol.v2.command', command }), false);
    assert.equal(isV2ClientMessage({ type: 'command', protocolVersion: PROTOCOL_V2_VERSION, command }), false);
  }
  assert.equal(PROTOCOL_V2_VERSION, '2.0.0');
});

test('staged rune guard rejects extra fields, actor/amount/domain injection and malformed identities', () => {
  for (const field of ['amount', 'quantity', 'domain', 'playerId', 'resourceBalances', 'window', 'goldPower', 'payPending', 'uid']) {
    assert.equal(isV2RuneResourceCommand({ ...energy, [field]: 1 }), false, field);
  }
  for (const value of [
    { ...energy, commandId: '' },
    { ...energy, commandId: ' ' },
    { ...energy, stateVersion: -1 },
    { ...energy, stateVersion: 1.5 },
    { ...energy, stateVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...energy, runeObjectId: '' },
    { ...energy, runeObjectId: ' ' },
    { ...energy, zoneEntryId: -1 },
    { ...energy, zoneEntryId: 0.5 },
    { ...energy, zoneEntryId: Number.MAX_SAFE_INTEGER + 1 },
    { ...energy, zoneEntryId: '0' },
    { ...energy, type: 'gold-power' },
    { ...energy, type: 'pay-pending' },
    { ...energy, type: 'rune-energy', commandId: undefined },
    { ...energy, type: 'rune-energy', zoneEntryId: undefined },
  ]) assert.equal(isV2RuneResourceCommand(value), false);
});

test('rune guard is closed over exact object shape, including null prototype and accessors', () => {
  const inherited = Object.create({ extra: true });
  Object.assign(inherited, energy);
  assert.equal(isV2RuneResourceCommand(inherited), false);
  const accessor = { ...energy };
  Object.defineProperty(accessor, 'zoneEntryId', { enumerable: true, get: () => 0 });
  assert.equal(isV2RuneResourceCommand(accessor), false);
  const sparseArray = { ...energy, amount: new Array(1) };
  assert.equal(isV2RuneResourceCommand(sparseArray), false);
  assert.equal(isV2RuneResourceCommand(null), false);
  assert.equal(isV2RuneResourceCommand([]), false);
});
