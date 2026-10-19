import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROTOCOL_V2_VERSION,
  isV2ClientMessage,
  isV2Command,
  isV2CommandEnvelope,
  isV2CommandMessage,
  isV2RuneResourceCommand,
} from '../../dist/v2/index.js';

const base = { commandId: 'cmd-rune-wire', stateVersion: 11 };
const energy = { ...base, type: 'rune-energy', runeObjectId: 'a-rune-1', zoneEntryId: 3 };
const power = { ...base, type: 'rune-power', runeObjectId: 'b-rune-1', zoneEntryId: 9 };

test('enabled Rune intents pass the general command and transport guards', () => {
  for (const command of [energy, power]) {
    assert.equal(isV2RuneResourceCommand(command), true);
    assert.equal(isV2Command(command), true);
    assert.equal(isV2CommandEnvelope({ contract: 'riftbound.protocol.v2.command', command }), true);
    const message = { type: 'command', protocolVersion: PROTOCOL_V2_VERSION, command };
    assert.equal(isV2CommandMessage(message), true);
    assert.equal(isV2ClientMessage(message), true);
  }
});

test('enabled Rune wire shape remains exact and rejects client authority or aliases', () => {
  for (const field of ['amount', 'domain', 'playerId', 'actor', 'balances', 'window', 'goldPower', 'payPending']) {
    assert.equal(isV2Command({ ...energy, [field]: 1 }), false, field);
  }
  for (const command of [
    { ...energy, zoneEntryId: -1 },
    { ...energy, zoneEntryId: 1.5 },
    { ...energy, runeObjectId: ' ' },
    { ...energy, type: 'gold-power' },
    { ...power, zoneEntryId: Number.MAX_SAFE_INTEGER + 1 },
  ]) assert.equal(isV2Command(command), false);
});

test('unknown command types still reject through every general wire boundary', () => {
  const unknown = { ...base, type: 'unknown-rune-command', runeObjectId: 'a-rune-1', zoneEntryId: 0 };
  assert.equal(isV2Command(unknown), false);
  assert.equal(isV2CommandEnvelope({ contract: 'riftbound.protocol.v2.command', command: unknown }), false);
  assert.equal(isV2ClientMessage({ type: 'command', protocolVersion: PROTOCOL_V2_VERSION, command: unknown }), false);
});
