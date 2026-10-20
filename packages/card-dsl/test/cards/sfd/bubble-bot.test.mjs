import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const cardId = "card.hash-34880fcae16bd9461e4c318dfb455365ff9e353db357f948b4a15dea7e01b389";
const program = cardProgramsById.get(cardId);

test("bubble-bot program is registered and validates", () => {
  assert.ok(program, "bubble-bot must be in the generated card registry");
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("bubble-bot structure: trigger, target, body", () => {
  assert.equal(program.status, "executable");
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.equal(ability.trigger.filter.event, "card-played");
  assert.equal(ability.trigger.filter.filter.source, "self");
  assert.equal(ability.trigger.filter.filter.player, "controller");
  assert.equal(ability.optional, false);
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.op, "effect.ready");
  // effect.ready defaults to the source; the body must name the locked target.
  assert.deepEqual(instruction.args, {
    objects: { kind: "constant", value: { kind: "target", id: "other-friendly-mech" } }
  });
  assert.equal(instruction.targets.length, 1);
  const [target] = instruction.targets;
  assert.equal(target.id, "other-friendly-mech");
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
  assert.equal(target.filter.tag, "Mech");
  assert.equal(target.filter.controller, "controller");
  assert.equal(target.filter.other, true);
});

// --- Production goldens: the original registry program through the generic
// scenario harness (ProgramBinding -> ChainEngine play, card-played trigger,
// Finalize target lock, Resolve). Printed: Unit, Mind, 3 Energy, Might 3, Mech.
import { runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";

const BASE_A = { type: "base", player: "A" };
const BASE_B = { type: "base", player: "B" };
const bubble = { id: "bubble", cardId, program, types: ["unit"], tags: ["Mech", "Yordle", "Bandle City"], zone: "hand", energy: 3, power: [], might: 3 };
const playAndResolve = [
  { type: "play", object: "bubble", player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" },
];
const stateOf = (result, id) => result.state.objects.find(object => object.ref.id === id);

test("sfd-062-221 Bubble Bot readies the other friendly Mech, not itself, a non-Mech or an enemy Mech", () => {
  const result = runCardScenario(program, {
    players: { A: { energy: 3 } },
    objects: [
      bubble,
      { id: "mech", owner: "A", types: ["unit"], tags: ["Mech"], zone: "board", location: BASE_A, might: 2, exhausted: true },
      { id: "non-mech", owner: "A", types: ["unit"], tags: ["Yordle"], zone: "board", location: BASE_A, might: 2, exhausted: true },
      { id: "enemy-mech", owner: "B", controller: "B", types: ["unit"], tags: ["Mech"], zone: "board", location: BASE_B, might: 2, exhausted: true },
    ],
    operations: playAndResolve,
    expect: {
      objects: {
        bubble: { zone: "board", exhausted: true },
        mech: { exhausted: false },
        "non-mech": { exhausted: true },
        "enemy-mech": { exhausted: true },
      },
      players: { A: { energy: 0 } },
      events: { includes: [{ timingPoint: "card-played" }] },
    },
  });
  result.asserts();
  assert.deepEqual(result.state.chain, []);
});

test("sfd-062-221 Bubble Bot readies exactly the chosen one of two friendly Mechs", () => {
  const result = runCardScenario(program, {
    players: { A: { energy: 3 } },
    answers: { "target:other-friendly-mech": ["mech-2"] },
    objects: [
      bubble,
      { id: "mech-1", owner: "A", types: ["unit"], tags: ["Mech"], zone: "board", location: BASE_A, might: 2, exhausted: true },
      { id: "mech-2", owner: "A", types: ["unit"], tags: ["Mech"], zone: "board", location: BASE_A, might: 4, exhausted: true },
    ],
    operations: playAndResolve,
  });
  assert.equal(stateOf(result, "mech-2").exhausted, false);
  assert.equal(stateOf(result, "mech-1").exhausted, true);
  assert.equal(stateOf(result, "bubble").exhausted, true);
});

test("sfd-062-221 Bubble Bot with no other friendly Mech still resolves its play and readies nothing", () => {
  const result = runCardScenario(program, {
    players: { A: { energy: 3 } },
    objects: [
      bubble,
      { id: "non-mech", owner: "A", types: ["unit"], tags: ["Yordle"], zone: "board", location: BASE_A, might: 2, exhausted: true },
      { id: "enemy-mech", owner: "B", controller: "B", types: ["unit"], tags: ["Mech"], zone: "board", location: BASE_B, might: 2, exhausted: true },
    ],
    operations: [{ type: "play", object: "bubble", player: "A" }],
    expect: {
      objects: { bubble: { zone: "board", exhausted: true }, "non-mech": { exhausted: true }, "enemy-mech": { exhausted: true } },
      players: { A: { energy: 0 } },
    },
  });
  result.asserts();
  assert.deepEqual(result.state.chain, [], "the trigger without a legal Mech target leaves no item behind");
});
