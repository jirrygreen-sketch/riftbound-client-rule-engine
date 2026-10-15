// P4 actions profile (riftbound-duel-v3-actions-1 / duel-command-v3-actions-1) contract tests.
// Guards and transport admission are structural only, not actor/window/cost/source authority.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1, DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  DUEL_PROJECTION_SCHEMA_V2_ACTIONS_REJECTED,
  isDuelProjectionV3Actions1, isDuelProjectionMessageV3Actions1,
  isDuelCommandV3Actions1, isDuelCommandMessageV3Actions1,
} from '../dist/duel-actions-contract-v3.js';
import {
  DUEL_PROJECTION_SCHEMA_V2, DUEL_PROJECTION_SCHEMA_V3,
  isDuelProjectionV2, isDuelProjectionV3, isDuelProjectionAny,
  isDuelCommand, isDuelCommandMessage,
} from '../dist/duel-contract.js';
import { isClientMessage, isServerMessage, isDuelProjectionTransport,
  isDuelCommandTransport } from '../dist/index.js';

const v2Fixtures = JSON.parse(readFileSync(new URL('./fixtures/duel-v2-projection.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);

function asP4Setup(viewer = 'p1') {
  const projection = clone(v2Fixtures.setup[viewer === null ? 'null' : viewer]);
  projection.projectionSchema = DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1;
  projection.match.schemaVersion = 3;
  return projection;
}
function asP4Playing(scenario = 'changed', viewer = 'p1') {
  const key = viewer === null ? 'null' : viewer;
  const projection = clone(v2Fixtures[scenario][key]);
  projection.projectionSchema = DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1;
  projection.match.schemaVersion = 3;
  for (const player of projection.match.players) {
    player.legend = { cardId: player.legend.cardId, controllerPlayerId: player.playerId, readiness: 'ready' };
  }
  projection.match.board.gears = [];
  projection.match.frame.chain = { active: false };
  projection.match.frame.pendingChoice = null;
  projection.match.frame.execution = { status: 'ready' };
  return projection;
}
// A V3-base projection (no P4 frame fields) used to prove P3 stays exact.
function asV3Base(scenario = 'changed', viewer = 'p1') {
  const key = viewer === null ? 'null' : viewer;
  const projection = clone(v2Fixtures[scenario][key]);
  projection.projectionSchema = DUEL_PROJECTION_SCHEMA_V3;
  projection.match.schemaVersion = 3;
  for (const player of projection.match.players) {
    player.legend = { cardId: player.legend.cardId, controllerPlayerId: player.playerId, readiness: 'ready' };
  }
  projection.match.board.gears = [];
  return projection;
}
const packet = projection => ({ type: 'duel-projection', roomId: 'room-1', projection });
const commandPacket = command => ({
  type: 'duel-command', commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  requestId: 'req-1', commandId: 'cmd-1', expectedVersion: 5, command,
});
function hide(object, key) {
  const value = object[key];
  Object.defineProperty(object, key, { configurable: true, enumerable: false, writable: true, value });
}
const actionBase = extra => ({ id: 'action-1', label: 'Action', enabled: true, ...extra });

test('transport admits exact P4 without widening historical profile guards', () => {
  for (const projection of [asP4Setup(), asP4Playing(), asP4Playing('changed', null)]) {
    assert.equal(isDuelProjectionTransport(projection), true);
    assert.equal(isServerMessage(packet(projection)), true);
    assert.equal(isDuelProjectionAny(projection), false);
    assert.equal(isServerMessage(packet({ ...projection, projectionSchema: 'unknown-profile' })), false);
  }
  const command = commandPacket({ type: 'end-turn', windowId: 'opaque-window' });
  assert.equal(isDuelCommandTransport(command), true);
  assert.equal(isClientMessage(command), true);
  assert.equal(isDuelCommandMessage(command), false);
  const untagged = { ...command };
  delete untagged.commandProfile;
  assert.equal(isClientMessage(untagged), false);
  assert.equal(isClientMessage({ ...command, commandProfile: 'unknown-profile' }), false);
  assert.equal(isClientMessage({ ...command, actor: 'p1' }), false);
});

test('P4 uses independent profile constants and never the retired v2-actions name', () => {
  assert.equal(DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1, 'riftbound-duel-v3-actions-1');
  assert.equal(DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, 'duel-command-v3-actions-1');
  assert.equal(DUEL_PROJECTION_SCHEMA_V2_ACTIONS_REJECTED, 'riftbound-duel-v2-actions-1');
  assert.notEqual(DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1, DUEL_PROJECTION_SCHEMA_V3);
  assert.notEqual(DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1, DUEL_PROJECTION_SCHEMA_V2);
});

test('P4 playing projection is accepted for both seats and spectators, and only by the P4 guard', () => {
  for (const viewer of ['p1', 'p2', null]) {
    const projection = asP4Playing('changed', viewer);
    assert.equal(isDuelProjectionV3Actions1(projection), true, `P4 playing ${viewer}`);
    assert.equal(isDuelProjectionMessageV3Actions1(packet(projection)), true, `P4 message ${viewer}`);
    // P3 base guard must not accept P4 (no extra frame fields) and P4 must not masquerade as P3.
    assert.equal(isDuelProjectionV3(projection), false, `P3 guard rejects P4 ${viewer}`);
    assert.equal(isDuelProjectionAny(projection), false, `Any union not widened ${viewer}`);
  }
  // sanity: the underlying V3 base shape (with gears/legend, no P4 frame fields) still passes P3.
  assert.equal(isDuelProjectionV3(asV3Base('changed', 'p1')), true);
  assert.equal(isDuelProjectionV3Actions1(asV3Base('changed', 'p1')), false);
});

test('P4 setup reuses V3 setup with no permanent fields and rejects any injected permanent', () => {
  for (const viewer of ['p1', 'p2', null]) {
    const setup = asP4Setup(viewer === null ? null : viewer);
    assert.equal(isDuelProjectionV3Actions1(setup), true, `P4 setup ${viewer}`);
    assert.equal(Object.hasOwn(setup.match.setup, 'gears'), false);
    assert.equal(Object.hasOwn(setup.match.setup.players[0].legend, 'readiness'), false);
  }
  const candidate = asP4Setup('p1');
  candidate.match.setup.gears = [];
  assert.equal(isDuelProjectionV3Actions1(candidate), false);
});

test('P4 rejects wrong schemaVersion, retired profile names, and missing frame extensions', () => {
  const lowSchema = asP4Playing('changed', 'p1'); lowSchema.match.schemaVersion = 2;
  assert.equal(isDuelProjectionV3Actions1(lowSchema), false, 'schemaVersion 2 mixed with P4');
  const v1Schema = asP4Playing('changed', 'p1'); v1Schema.match.schemaVersion = 1;
  assert.equal(isDuelProjectionV3Actions1(v1Schema), false, 'schemaVersion 1 mixed with P4');
  const rejected = asP4Playing('changed', 'p1'); rejected.projectionSchema = DUEL_PROJECTION_SCHEMA_V2_ACTIONS_REJECTED;
  assert.equal(isDuelProjectionV3Actions1(rejected), false, 'retired v2-actions name');
  const p3Name = asP4Playing('changed', 'p1'); p3Name.projectionSchema = DUEL_PROJECTION_SCHEMA_V3;
  assert.equal(isDuelProjectionV3Actions1(p3Name), false, 'P3 profile name with P4 frame');
  const p2Name = asP4Playing('changed', 'p1'); p2Name.projectionSchema = DUEL_PROJECTION_SCHEMA_V2;
  assert.equal(isDuelProjectionV2(p2Name), false, 'P2 guard rejects P4 shape');
  for (const key of ['chain', 'pendingChoice', 'execution']) {
    const missing = asP4Playing('changed', 'p1'); delete missing.match.frame[key];
    assert.equal(isDuelProjectionV3Actions1(missing), false, `missing frame.${key}`);
    const hidden = asP4Playing('changed', 'p1'); hide(hidden.match.frame, key);
    assert.equal(isDuelProjectionV3Actions1(hidden), false, `non-enumerable frame.${key}`);
  }
  const extraFrame = asP4Playing('changed', 'p1'); extraFrame.match.frame.extra = 1;
  assert.equal(isDuelProjectionV3Actions1(extraFrame), false, 'extra frame key');
});

test('chain/pending-choice/execution summaries enforce ADR semantic bounds', () => {
  const chainOpen = asP4Playing('changed', 'p1');
  chainOpen.match.frame.chain = { active: true, itemCount: 1, pendingCount: 0 };
  assert.equal(isDuelProjectionV3Actions1(chainOpen), false, 'active chain with stateOpen');

  const chainZero = asP4Playing('changed', 'p1');
  chainZero.match.frame.stateOpen = false;
  chainZero.match.frame.chain = { active: true, itemCount: 0, pendingCount: 0 };
  assert.equal(isDuelProjectionV3Actions1(chainZero), false, 'active chain requires itemCount >= 1');

  const chainPending = asP4Playing('changed', 'p1');
  chainPending.match.frame.stateOpen = false;
  chainPending.match.frame.chain = { active: true, itemCount: 2, pendingCount: 2 };
  assert.equal(isDuelProjectionV3Actions1(chainPending), true, 'all chain items can still await finalization');
  chainPending.match.frame.chain.pendingCount = 3;
  assert.equal(isDuelProjectionV3Actions1(chainPending), false, 'pendingCount cannot exceed itemCount');

  const chainOk = asP4Playing('changed', 'p1');
  chainOk.match.frame.stateOpen = false;
  chainOk.match.frame.chain = { active: true, itemCount: 2, pendingCount: 0 };
  assert.equal(isDuelProjectionV3Actions1(chainOk), true);

  const badExecution = asP4Playing('changed', 'p1'); badExecution.match.frame.execution = { status: 'maybe' };
  assert.equal(isDuelProjectionV3Actions1(badExecution), false);
  const badChoice = asP4Playing('changed', 'p1'); badChoice.match.frame.pendingChoice = { active: 'yes' };
  assert.equal(isDuelProjectionV3Actions1(badChoice), false);

  const ownerChoice = asP4Playing('changed', 'p1');
  ownerChoice.match.frame.pendingChoice = { active: true, choiceId: 'choice-1', kind: 'play-choices',
    prompts: [{ promptId: 'enter-location', kind: 'destination', minSelections: 1, maxSelections: 1,
      options: [{ id: 'opt-base-p1', label: 'Own base' }] }] };
  ownerChoice.match.frame.execution = { status: 'pending' };
  ownerChoice.actions = [actionBase({ kind: 'answer-pending-choice', choiceId: 'choice-1' })];
  assert.equal(isDuelProjectionV3Actions1(ownerChoice), true, 'owner choice visible to authenticated viewer');

  const spectatorSeesOwner = asP4Playing('changed', null);
  spectatorSeesOwner.match.frame.pendingChoice = clone(ownerChoice.match.frame.pendingChoice);
  spectatorSeesOwner.match.frame.execution = { status: 'pending' };
  assert.equal(isDuelProjectionV3Actions1(spectatorSeesOwner), false, 'spectator must not see owner choice variant');

  const nonOwnerSummary = asP4Playing('changed', 'p2');
  nonOwnerSummary.match.frame.pendingChoice = { active: true };
  nonOwnerSummary.match.frame.execution = { status: 'pending' };
  assert.equal(isDuelProjectionV3Actions1(nonOwnerSummary), true, 'non-owner sees only {active:true}');
});

test('choice prompts and combat targets enforce option bounds and seat separation', () => {
  const prompt = (overrides = {}) => ({ promptId: 'p', kind: 'effect-choice', minSelections: 1,
    maxSelections: 2, options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], ...overrides });
  const withChoice = (choice) => {
    const projection = asP4Playing('changed', 'p1');
    projection.match.frame.pendingChoice = { active: true, choiceId: 'c', kind: 'play-choices', prompts: [choice] };
    projection.match.frame.execution = { status: 'pending' };
    return projection;
  };
  assert.equal(isDuelProjectionV3Actions1(withChoice(prompt())), true);
  assert.equal(isDuelProjectionV3Actions1(withChoice(prompt({ maxSelections: 3 }))), false, 'max > options');
  assert.equal(isDuelProjectionV3Actions1(withChoice(prompt({ minSelections: 3 }))), false, 'min > max');
  assert.equal(isDuelProjectionV3Actions1(withChoice(prompt({ options: [] }))), false, 'no options');
  assert.equal(isDuelProjectionV3Actions1(withChoice(prompt({ options: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }))), false, 'duplicate option ids');
  assert.equal(isDuelProjectionV3Actions1(withChoice(prompt({ kind: 'bogus' }))), false, 'unknown prompt kind');

  const combat = asP4Playing('changed', 'p1');
  combat.match.frame.pendingChoice = { active: true, choiceId: 'cc', kind: 'combat-allocation',
    fieldLocationId: combat.match.board.battlefields[0].locationId, side: 'attacker', budget: 3,
    targets: [{ unitObjectId: 'p2-unit-1', lethalNeed: 2 }] };
  combat.match.frame.execution = { status: 'pending' };
  assert.equal(isDuelProjectionV3Actions1(combat), true);
  const seatTarget = clone(combat);
  seatTarget.match.frame.pendingChoice.targets = [{ unitObjectId: 'p1', lethalNeed: 1 }];
  assert.equal(isDuelProjectionV3Actions1(seatTarget), false, 'target cannot be a seat id');
  const zeroLethal = clone(combat);
  zeroLethal.match.frame.pendingChoice.targets = [{ unitObjectId: 'p2-unit-1', lethalNeed: 0 }];
  assert.equal(isDuelProjectionV3Actions1(zeroLethal), false, 'lethalNeed must be positive');
});

test('P4 actions cover the eight new kinds with exact keys and reject malformed variants', () => {
  const projection = asP4Playing('changed', 'p1');
  projection.actions = [
    actionBase({ kind: 'play-card', cardUID: 'p1-main-1', windowId: 'win-1' }),
    actionBase({ kind: 'activate-ability', sourceObjectId: 'p1-rune', abilityOptionId: 'ability-1', windowId: 'win-1' }),
    actionBase({ kind: 'pass-priority', windowId: 'win-1' }),
    actionBase({ kind: 'pass-focus', windowId: 'win-1' }),
    actionBase({ kind: 'standard-move', windowId: 'win-1', selectableUnitUIDs: ['p1-unit-1'],
      destinations: [{ locationId: projection.match.board.battlefields[0].locationId, eligibleUnitUIDs: ['p1-unit-1'] }] }),
    actionBase({ kind: 'answer-pending-choice', choiceId: 'choice-1' }),
    actionBase({ kind: 'assign-combat-damage', choiceId: 'combat-1' }),
    actionBase({ kind: 'end-turn', windowId: 'win-1' }),
  ];
  // give each action a unique id
  projection.actions.forEach((action, i) => { action.id = `action-${i}`; });
  assert.equal(isDuelProjectionV3Actions1(projection), true, 'all eight P4 action kinds are accepted');

  const withAction = (action) => { const p = asP4Playing('changed', 'p1'); p.actions = [action]; return p; };
  assert.equal(isDuelProjectionV3Actions1(withAction(actionBase({ kind: 'play-card', cardUID: 'c', windowId: 'w' }))), true);
  assert.equal(isDuelProjectionV3Actions1(withAction(actionBase({ kind: 'play-card', cardUID: 'c' }))), false, 'missing windowId');
  assert.equal(isDuelProjectionV3Actions1(withAction({ ...actionBase({ kind: 'play-card', cardUID: 'c', windowId: 'w' }), might: 3 })), false, 'unknown key');
  assert.equal(isDuelProjectionV3Actions1(withAction({ ...actionBase({ kind: 'play-card', cardUID: 'c', windowId: 'w' }), enabled: 'no' })), false, 'enabled must be boolean');
  assert.equal(isDuelProjectionV3Actions1(withAction(actionBase({ kind: 'unknown-kind', windowId: 'w' }))), false, 'unknown kind');
  assert.equal(isDuelProjectionV3Actions1(withAction(actionBase({ kind: 'standard-move', windowId: 'w',
    selectableUnitUIDs: ['u'], destinations: [{ locationId: 'not-a-location', eligibleUnitUIDs: ['u'] }] }))), false,
    'destination must be a board location');
  assert.equal(isDuelProjectionV3Actions1(withAction(actionBase({ kind: 'standard-move', windowId: 'w',
    selectableUnitUIDs: ['u'], destinations: [{ locationId: asP4Playing('changed', 'p1').match.board.battlefields[0].locationId,
      eligibleUnitUIDs: ['u'] }, { locationId: asP4Playing('changed', 'p1').match.board.battlefields[0].locationId, eligibleUnitUIDs: ['u'] }] }))), false,
    'duplicate destination');
  assert.equal(isDuelProjectionV3Actions1(withAction({ ...actionBase({ kind: 'end-turn', windowId: 'w' }), id: 'x', }),
  ), true);

  const dup = asP4Playing('changed', 'p1');
  dup.actions = [actionBase({ kind: 'pass-priority', windowId: 'w' }), actionBase({ kind: 'pass-priority', windowId: 'w' })];
  assert.equal(isDuelProjectionV3Actions1(dup), false, 'duplicate action id');

  const spectatorActions = asP4Playing('changed', null);
  spectatorActions.actions = [actionBase({ kind: 'pass-priority', windowId: 'w' })];
  assert.equal(isDuelProjectionV3Actions1(spectatorActions), false, 'spectator must have no actions');

  const ended = asP4Playing('changed', 'p1');
  ended.match.frame.phase = 'ended';
  ended.match.frame.priorityPlayerId = null;
  ended.actions = [actionBase({ kind: 'pass-priority', windowId: 'w' })];
  assert.equal(isDuelProjectionV3Actions1(ended), false, 'no actions when ended');
});

test('P4 commands accept the legacy five plus the eight new actions and reject arbitrary fields', () => {
  const legacy = [
    { type: 'mulligan', selectedUIDs: ['a', 'b'] },
    { type: 'rune-energy', uid: 'r1' },
    { type: 'rune-power', uid: 'r2' },
    { type: 'gold-power', uid: 'g1' },
    { type: 'pay-pending', paymentId: 'pay-1', plan: { power: [{ requirementIndex: 0, from: 'Fury', amount: 1 }] } },
  ];
  for (const command of legacy) assert.equal(isDuelCommandV3Actions1(command), true, JSON.stringify(command));

  const next = [
    { type: 'play-card', cardUID: 'c1', windowId: 'w1' },
    { type: 'activate-ability', sourceObjectId: 'r1', abilityOptionId: 'a1', windowId: 'w1' },
    { type: 'pass-priority', windowId: 'w1' },
    { type: 'pass-focus', windowId: 'w1' },
    { type: 'standard-move', windowId: 'w1', unitUIDs: ['u1', 'u2'], destinationLocationId: 'loc-1' },
    { type: 'answer-pending-choice', choiceId: 'ch1', answers: [{ promptId: 'p1', optionIds: ['o1', 'o2'] }] },
    { type: 'assign-combat-damage', choiceId: 'cc1', assignments: [{ unitObjectId: 'e1', amount: 2 }, { unitObjectId: 'e2', amount: 1 }] },
    { type: 'end-turn', windowId: 'w1' },
  ];
  for (const command of next) assert.equal(isDuelCommandV3Actions1(command), true, JSON.stringify(command));

  const bad = [
    [{ type: 'play-card', cardUID: 'c1', windowId: 'w1', might: 3 }, 'play-card with might'],
    [{ type: 'play-card', cardUID: 'c1' }, 'play-card missing windowId'],
    [{ type: 'play-card', cardUID: 'c1', windowId: 'w1', actor: 'p1' }, 'play-card with actor'],
    [{ type: 'assign-combat-damage', choiceId: 'c', assignments: [{ unitObjectId: 'e1', amount: 0 }] }, 'zero assignment'],
    [{ type: 'assign-combat-damage', choiceId: 'c', assignments: [{ unitObjectId: 'e1', amount: -1 }] }, 'negative assignment'],
    [{ type: 'assign-combat-damage', choiceId: 'c', assignments: [{ unitObjectId: 'e1', amount: 1.5 }] }, 'fractional assignment'],
    [{ type: 'assign-combat-damage', choiceId: 'c', assignments: [{ unitObjectId: 'e1', amount: 1 }, { unitObjectId: 'e1', amount: 1 }] }, 'duplicate target'],
    [{ type: 'standard-move', windowId: 'w', unitUIDs: [], destinationLocationId: 'loc' }, 'empty unitUIDs'],
    [{ type: 'standard-move', windowId: 'w', unitUIDs: ['u'], destinationLocationId: 'u' }, 'uid equals destination'],
    [{ type: 'answer-pending-choice', choiceId: 'c', answers: [{ promptId: 'p', optionIds: ['a'] }, { promptId: 'p', optionIds: ['b'] }] }, 'duplicate promptId'],
    [{ type: 'answer-pending-choice', choiceId: 'c', answers: [{ promptId: 'p', optionIds: ['a', 'a'] }] }, 'duplicate optionIds'],
    [{ type: 'end-turn' }, 'end-turn missing windowId'],
    [{ type: 'pass-priority', windowId: 'w', delta: 1 }, 'pass-priority with delta'],
    [{ type: 'frobnicate' }, 'unknown command kind'],
  ];
  for (const [command, label] of bad) assert.equal(isDuelCommandV3Actions1(command), false, label);

  // The old command guard must NOT be widened to accept any P4 command.
  for (const command of next) assert.equal(isDuelCommand(command), false, `legacy guard rejects ${command.type}`);
  assert.equal(isDuelCommand({ type: 'play-card', cardUID: 'c1', windowId: 'w1' }), false);
});

test('P4 tagged packet requires the exact profile tag and never accepts a legacy envelope', () => {
  assert.equal(isDuelCommandMessageV3Actions1(commandPacket({ type: 'end-turn', windowId: 'w1' })), true);
  assert.equal(isDuelCommandMessageV3Actions1(commandPacket({ type: 'mulligan', selectedUIDs: ['a'] })), true);

  const wrongProfile = { ...commandPacket({ type: 'end-turn', windowId: 'w1' }), commandProfile: 'duel-command-legacy-5' };
  assert.equal(isDuelCommandMessageV3Actions1(wrongProfile), false, 'wrong command profile tag');
  const noTag = { type: 'duel-command', requestId: 'r', commandId: 'c', expectedVersion: 1,
    command: { type: 'end-turn', windowId: 'w1' } };
  assert.equal(isDuelCommandMessageV3Actions1(noTag), false, 'legacy envelope is not a P4 packet');
  assert.equal(isDuelCommandMessage(noTag), false, 'legacy guard rejects P4-tagged command payload');
  const legacyWithP4 = { type: 'duel-command', requestId: 'r', commandId: 'c', expectedVersion: 1,
    command: { type: 'play-card', cardUID: 'c', windowId: 'w' } };
  assert.equal(isDuelCommandMessage(legacyWithP4), false, 'legacy guard never upgrades to P4');
  const extraKey = { ...commandPacket({ type: 'end-turn', windowId: 'w1' }), roomId: 'room' };
  assert.equal(isDuelCommandMessageV3Actions1(extraKey), false, 'packet extra key');
});

test('resourceCost stays in its legal domain and plain-data negatives fail closed', () => {
  const cost = asP4Playing('pending', 'p1');
  assert.equal(isDuelProjectionV3Actions1(cost), true, 'valid pendingPayment resolvedCost');
  const badDomain = asP4Playing('pending', 'p1');
  badDomain.match.frame.pendingPayment.resolvedCost = { energy: 0, power: [{ allowedDomains: ['Nope'], amount: 1 }] };
  assert.equal(isDuelProjectionV3Actions1(badDomain), false, 'illegal power domain');

  const sparse = asP4Playing('changed', 'p1');
  sparse.actions = new Array(2); sparse.actions[1] = actionBase({ kind: 'pass-priority', windowId: 'w' });
  assert.equal(isDuelProjectionV3Actions1(sparse), false, 'sparse array');

  const accessor = asP4Playing('changed', 'p1');
  Object.defineProperty(accessor, 'match', { configurable: true, enumerable: true, get() { return {}; } });
  assert.equal(isDuelProjectionV3Actions1(accessor), false, 'getter instead of data descriptor');

  const symbol = asP4Playing('changed', 'p1');
  symbol[Symbol('extra')] = 1;
  assert.equal(isDuelProjectionV3Actions1(symbol), false, 'symbol key');

  const proto = asP4Playing('changed', 'p1');
  Object.setPrototypeOf(proto, { inherited: true });
  assert.equal(isDuelProjectionV3Actions1(proto), false, 'exotic prototype');

  const actionAccessor = asP4Playing('changed', 'p1');
  actionAccessor.actions = [actionBase({ kind: 'play-card', cardUID: 'c', windowId: 'w' })];
  Object.defineProperty(actionAccessor.actions[0], 'cardUID', { configurable: true, enumerable: true, get() { return 'c'; } });
  assert.equal(isDuelProjectionV3Actions1(actionAccessor), false, 'action field getter');

  // JSON round-trip of a legal projection is preserved.
  const legal = asP4Playing('changed', 'p1');
  assert.equal(isDuelProjectionV3Actions1(JSON.parse(JSON.stringify(legal))), true);
  assert.equal(isDuelProjectionMessageV3Actions1(packet(JSON.parse(JSON.stringify(legal)))), true);
});
