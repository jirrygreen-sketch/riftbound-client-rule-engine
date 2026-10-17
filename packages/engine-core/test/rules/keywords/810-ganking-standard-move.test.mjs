// docs/rules/scenarios/keywords.yaml — Ganking (CR v1.5 810.1.b, 810.1.c.3, 810.2, 144.4.c.1).
//
// The merged Ganking expansion (src/effects/keywords/Ganking.ts) is a static
// `continuous.movement` permission, and src/zones/movement.ts is the merged
// Standard Move kernel that consumes the derived `hasGanking` fact. The tests
// below now have to solve a real wiring question: Ganking’s declared permission
// shape (`permission: "battlefield-to-battlefield"` + `addsPermission`) is not the
// shape `layers/rules/query.ts movement()` reads (`permission.routes`), so the
// keyword cannot yet reach the move kernel through the layer query. The tests
// therefore execute the zones kernel with the permission fact the merged query
// would produce, and pin the missing bridge with an explicit todo.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ContinuousEffectRegistry } from '../../../dist/layers/duration.js';
import { movement } from '../../../dist/layers/rules/query.js';
import { createDuelBoard, placeDuelUnit, selectDuelBattlefields } from '../../../dist/duel/battlefields.js';
import { moveDuelUnitsStandard } from '../../../dist/zones/movement.js';
import ganking from '../../../dist/effects/keywords/Ganking.js';

const seats = () => ['A', 'B'].map(playerId => ({
  playerId,
  battlefields: [
    { instanceId: `${playerId}-1`, cardId: 'printing-x' },
    { instanceId: `${playerId}-2`, cardId: 'printing-y' },
    { instanceId: `${playerId}-3`, cardId: 'printing-z' }
  ]
}));

/** The canonical board plus its two selected Battlefields, exactly like test/rules/movement. */
const boardWith = objectId => {
  const board = createDuelBoard(selectDuelBattlefields(seats(), () => 0));
  const bf1 = board.battlefields[0].locationId;
  const bf2 = board.battlefields[1].locationId;
  return { board: placeDuelUnit(board, { objectId, controllerPlayerId: 'A', locationId: bf1 }), bf1, bf2 };
};

const readinessFor = (board, { ganking = [], exhausted = [] } = {}) => board.units.map(unit => ({
  objectId: unit.objectId,
  readied: !exhausted.includes(unit.objectId),
  hasGanking: ganking.includes(unit.objectId)
}));

const move = (board, readiness, to, actor = 'A', unitUIDs = ['u1']) => moveDuelUnitsStandard(board, readiness, {
  actor, unitUIDs, destinationLocationId: to,
  timing: { phase: 'main', stateOpen: true, turnPlayerId: actor, priorityPlayerId: actor }
});

test('keywords-ganking-battlefield-to-battlefield-move: a Ganking unit moves Battlefield to Battlefield and exhausts (CR 810.1.b, 144.4.c.1)', () => {
  const { board, bf1, bf2 } = boardWith('u1');
  const result = move(board, readinessFor(board, { ganking: ['u1'] }), bf2);

  assert.equal(result.board.units.find(unit => unit.objectId === 'u1').locationId, bf2);
  assert.deepEqual(result.group.events, [{ objectId: 'u1', actor: 'A', fromLocationId: bf1, toLocationId: bf2 }]);
  assert.deepEqual(result.readiness, [{ objectId: 'u1', readied: false, hasGanking: true }], 'one Exhaust cost, not two');
});

test('keywords-ganking-battlefield-to-battlefield-move: without Ganking the same move is illegal (CR 144.4.c.1)', () => {
  const { board, bf2 } = boardWith('u1');
  assert.throws(() => move(board, readinessFor(board), bf2), /Ganking|illegal|Legal/i);
});

test('keywords-ganking-multiple-redundant: several Ganking instances grant one permission and no extra move (CR 810.2)', () => {
  // The keyword declares `stacking: "single"`, so two printed instances collapse.
  assert.equal(ganking.stacking, 'single');
  assert.equal(ganking.valued, false);
  const { board, bf2 } = boardWith('u1');
  const first = move(board, readinessFor(board, { ganking: ['u1'] }), bf2);
  assert.equal(first.group.exhaustedCount, 1);
  assert.equal(first.readiness[0].readied, false, 'a second Standard Move is impossible this turn');
  // The destination only needs to differ from the unit's current Battlefield:
  // the rejection comes from the exhausted state, not from the route.
  const thirdField = board.battlefields[0].locationId === bf2 ? board.battlefields[2].locationId : board.battlefields[0].locationId;
  assert.throws(
    () => move(first.board, first.readiness, thirdField),
    /readied|exhausted|Exhaust|illegal|Legal/i
  );
});

test.todo('keywords-ganking-battlefield-to-battlefield-move (layer query wiring): src/layers/rules/query.ts movement() only reads `effect.permission.routes`, while the merged Ganking expansion declares `permission: "battlefield-to-battlefield"` with `source`/`destination`/`addsPermission` (src/effects/keywords/Ganking.ts), so the keyword never reaches the Standard Move kernel through the merged layer query; the zones kernel above is executed against the derived `hasGanking` fact instead');
