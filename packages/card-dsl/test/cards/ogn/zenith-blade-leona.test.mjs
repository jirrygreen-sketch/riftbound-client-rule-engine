import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import zenithBlade from "../../../dist/cards/ogn/zenith-blade-leona.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import stun from "../../../../engine-core/dist/effects/instructions/effect.stun.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-a4a04e52d4544c14530e273f53c3890ccd0d8688ef9dc725dc0ef6b1d20103de";
const BASE = player => ({ type: "base", player });
const BATTLEFIELD = id => ({ type: "battlefield", id });

const [keyword, play] = zenithBlade.abilities;
const [stunInstruction, readInstruction, optionalInstruction] = play.body;
const moveInstruction = optionalInstruction.args.body.value[0];
const stunSpec = stunInstruction.targets[0];
const friendlyUnitTarget = optionalInstruction.targets[0];

/**
 * The card is played through the real ChainEngine (describePlay -> Finalize
 * target locks -> Resolve), which is the production path a played spell takes.
 *
 * The chain's interpreter adapter (chain/interpreter-adapter.ts) is what keeps
 * the raw Expr arguments for the frozen primitives, so effect.move evaluates the
 * linked Location itself; the adapter's literal-field table does not decode
 * effect.stun's target, so the Stun primitive is additionally pinned through the
 * default interpreter registry (the same convention as the merged Rune Prison,
 * Solari Chief and Twisted Fate goldens).
 */
const withoutTargets = instruction => {
  const { targets, ...rest } = instruction;
  return rest;
};

/** A real engine world with one legal enemy unit at a battlefield. */
function playZenithBlade({ answer = true, enemyBattlefield = "bf-2" } = {}) {
  const state = fixture({
    turnPlayer: "A",
    cards: [{ id: "zenith-blade", cardId: CANONICAL, types: ["spell"], energy: 3 }],
    choose: request => {
      if (request.type === "select-objects") return request.options.slice(0, request.max ?? 1);
      if (request.type === "optional") return answer;
      if (request.type === "mode") return request.options[0];
      throw new Error("unexpected choose " + request.type);
    }
  });
  // Move the enemy unit onto the battlefield the card reads; the friendly unit
  // starts at its Base so the Move is a real location change.
  state.engine.commit({ type: "move-location", object: state.kernel.ref("enemy"), to: BATTLEFIELD(enemyBattlefield) });
  state.engine.advance();
  const binding = createProgramBinding({
    cardPrograms: [{ ...zenithBlade, status: "executable", judgeReason: undefined }]
  });
  const draft = binding.describePlay(
    { type: "play", object: state.kernel.ref("zenith-blade"), player: "A" },
    state.kernel.getObject("zenith-blade")
  );
  return { ...state, draft };
}

/** Finalize the real chain item and return the locked target plans. */
function finalizeZenithBlade(state) {
  state.engine.execute(state.draft);
  const item = state.engine.items.at(-1);
  return item.targetPlans.map(plan => [plan.requirement.id, plan.selected.map(ref => ref.id)]);
}

test("Zenith Blade program is structurally valid EffectIR v2 data", () => {
  const result = validateCardProgram(zenithBlade);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Zenith Blade identity, ruleset, status, printed text and judgeReason", () => {
  assert.equal(zenithBlade.canonicalCardId, CANONICAL);
  assert.equal(zenithBlade.rulesetVersion, "core-1.5");
  assert.equal(zenithBlade.status, "judge-required");
  assert.equal(
    zenithBlade.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Stun an enemy unit at a battlefield. You may move a friendly unit to that enemy unit's battlefield. " +
      "(A stunned unit doesn't deal combat damage this turn.)"
  );
  // The judgeReason must name the rule that makes the choice part of the Move
  // (355.12), the execution evidence the golden drives, and the one remaining
  // runtime dependency: the effect Move's 355.4/355.4.a/451.1 destination
  // legality plus the blocked combat consequences it stages.
  assert.match(zenithBlade.judgeReason, /choice\.optional/);
  assert.match(zenithBlade.judgeReason, /355\.12/);
  assert.match(zenithBlade.judgeReason, /355\.4(\.a)?/);
  assert.match(zenithBlade.judgeReason, /451\.1/);
  assert.match(zenithBlade.judgeReason, /467\.2\.c\.1\.a/);
  assert.match(zenithBlade.judgeReason, /effect\.stun/);
  assert.match(zenithBlade.judgeReason, /Finalize/);
  assert.doesNotMatch(zenithBlade.judgeReason, /Nested\/repeated targets/);
  assert.ok(!/待实现|需要裁定/.test(zenithBlade.judgeReason));
  assert.equal(cardRegistryById.get(zenithBlade.canonicalCardId), zenithBlade);
});

test("Zenith Blade declares the printed [Action] keyword (CR 806)", () => {
  assert.equal(zenithBlade.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });
  assert.equal(keyword.value, undefined);
});

test("Zenith Blade structure: Stun, publish that battlefield, then the optional linked Move", () => {
  assert.equal(play.body.length, 3);
  assert.equal(play.cost, undefined);

  // "Stun an enemy unit at a battlefield." — a Choice with a location
  // restriction; 355.5.a prints this card as its example.
  assert.equal(stunInstruction.id, "stun-enemy-unit");
  assert.equal(stunInstruction.op, "effect.stun");
  assert.deepEqual(stunInstruction.args, { target: { kind: "constant", value: "enemy-unit-at-battlefield" } });
  assert.deepEqual(stunSpec, {
    id: "enemy-unit-at-battlefield",
    filter: { type: "unit", controller: "opponent", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(stunInstruction.picks, undefined);
  assert.equal(stunInstruction.linkedTo, undefined);

  // "that enemy unit's battlefield" — the Location is read at resolution and
  // published for the Move below.
  assert.equal(readInstruction.id, "read-that-battlefield");
  assert.equal(readInstruction.op, "condition.value");
  assert.equal(readInstruction.linkedTo, "stun-enemy-unit");
  assert.deepEqual(readInstruction.args.value, {
    kind: "object-property",
    object: { target: "enemy-unit-at-battlefield" },
    property: "location"
  });
  assert.deepEqual(readInstruction.args.key, { kind: "constant", value: "battlefield" });
  assert.equal(readInstruction.targets, undefined);

  // "You may move a friendly unit to that enemy unit's battlefield" — contract
  // 3.9: choice.optional wraps the chosen instruction, and CR 355.12 makes the
  // friendly unit a target chosen independently of the decision to move, so the
  // TargetSpec sits on the may node (the merged disarming-rake / salvage shape).
  assert.equal(optionalInstruction.id, "may-move-friendly-unit");
  assert.equal(optionalInstruction.op, "choice.optional");
  assert.equal(optionalInstruction.linkedTo, "read-that-battlefield");
  assert.equal(optionalInstruction.args.body.kind, "constant");
  assert.equal(optionalInstruction.args.body.value.length, 1);
  assert.deepEqual(optionalInstruction.targets, [
    {
      id: "friendly-unit",
      filter: { type: "unit", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(optionalInstruction.picks, undefined);
  assert.equal(moveInstruction.id, "move-friendly-unit");
  assert.equal(moveInstruction.op, "effect.move");
  assert.deepEqual(moveInstruction.args.objects, { kind: "constant", value: { target: "friendly-unit" } });
  assert.deepEqual(moveInstruction.args.to, {
    kind: "linked-value",
    instructionId: "read-that-battlefield",
    key: "battlefield"
  });
  // The Move body carries no target of its own: the nested-target shape is what
  // ChainEngine's Finalize surface rejected.
  assert.equal(moveInstruction.targets, undefined);
  assert.equal(moveInstruction.linkedTo, undefined);
  assert.equal(instructionDefinitionsById.has("effect.stun"), true);
  assert.equal(instructionDefinitionsById.has("effect.move"), true);
});

test("Zenith Blade golden: the Stun half stuns the locked enemy unit (CR 424.1)", () => {
  const kernel = world().unit("enemy-unit", { owner: "B", might: 4, location: BATTLEFIELD("bf1") }).build();
  const run = runInstruction(
    stun,
    // The interpreter evaluates target before dispatch, so a direct primitive
    // run receives the already-evaluated spec id (merged Rune Prison precedent).
    { target: stunInstruction.args.target.value },
    { world: kernel, targets: { "enemy-unit-at-battlefield": [kernel.ref("enemy-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-unit").stunned, true);
  assert.deepEqual(run.events.map(event => event.action), ["stun"]);
  assert.equal(run.linked.stunned.count, 1);
  assert.deepEqual(run.linked["stunned.objects"], [{ id: "enemy-unit", zoneEntryId: 1 }]);
});

test("Zenith Blade golden: an already Stunned unit stays legal and nothing extra happens (424.1.a.1)", () => {
  const kernel = world().unit("enemy-unit", { owner: "B", stunned: true }).build();
  const run = runInstruction(
    stun,
    { target: stunInstruction.args.target.value },
    { world: kernel, targets: { "enemy-unit-at-battlefield": [kernel.ref("enemy-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.stunned.count, 0);
  assert.equal(run.linked.stunned.alreadyStunned, 1);
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("enemy-unit").stunned, true);
});

test("Zenith Blade golden: the Stun half runs through the interpreter with the program body", () => {
  const kernel = world().unit("enemy-unit", { owner: "B", location: BATTLEFIELD("bf1") }).build();
  kernel.setTargets("enemy-unit-at-battlefield", [kernel.ref("enemy-unit")]);

  const outcome = runAbilityBody([withoutTargets(stunInstruction)], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("enemy-unit").stunned, true);
  assert.deepEqual(outcome.events.map(event => event.action), ["stun"]);
});

test("Zenith Blade golden: the real chain Finalize locks both printed choices", () => {
  // 355.8 / 355.12: Finalize locks the enemy unit named by the Stun and the
  // friendly unit named by the may-action; both live in one ability.
  assert.deepEqual(friendlyUnitTarget, {
    id: "friendly-unit",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });
  const state = playZenithBlade();
  assert.equal(state.draft.speed, "action");
  assert.deepEqual(
    state.draft.body.flatMap(instruction => (instruction.targets ?? []).map(target => target.id)),
    ["enemy-unit-at-battlefield", "friendly-unit"]
  );
  assert.deepEqual(finalizeZenithBlade(state), [
    ["enemy-unit-at-battlefield", ["enemy"]],
    ["friendly-unit", ["source"]]
  ]);
});

test("Zenith Blade boundary: the nested-target shape the Finalize surface rejects is the one this card no longer ships", () => {
  // CR 355.12 / contract 3.9: the friendly unit's TargetSpec belongs on the may
  // node. The rejected shape was the nested one, where the Move inside
  // choice.optional carried its own TargetSpec:
  const { targets: mayTargets, ...mayWithoutTargets } = optionalInstruction;
  assert.deepEqual(mayTargets, [friendlyUnitTarget]);
  const nested = [stunInstruction, readInstruction, {
    ...mayWithoutTargets,
    args: {
      ...optionalInstruction.args,
      body: { kind: "constant", value: [{ ...moveInstruction, targets: [friendlyUnitTarget] }] }
    }
  }];
  const state = playZenithBlade();
  const binding = createProgramBinding({ cardPrograms: [{
    ...zenithBlade, status: "executable", judgeReason: undefined,
    abilities: [keyword, { ...play, body: nested }]
  }] });
  let blocked;
  try {
    binding.describePlay(
      { type: "play", object: state.kernel.ref("zenith-blade"), player: "A" },
      state.kernel.getObject("zenith-blade")
    );
  } catch (error) {
    blocked = error;
  }
  assert.ok(blocked instanceof Error);
  assert.match(blocked.message, /Nested instruction targets require a target lifecycle adapter/);

  // The shipped program has no nested target, so the same path proceeds to the
  // real Finalize target plans (asserted in full above).
  assert.equal(play.body.flatMap(instruction =>
    (instruction.args.body?.value ?? []).flatMap(nestedInstruction => nestedInstruction.targets ?? [])
  ).length, 0);
});

test("Zenith Blade boundary: the chain adapter still cannot resolve the card's own Stun instruction", () => {
  // The production chain keeps the IR's Expr arguments and decodes only the ops
  // in chain/interpreter-adapter.ts LITERAL_FIELDS, which has no effect.stun
  // entry: Resolve rejects the card's own body with this exact error. That is
  // the engine-side dependency, not a card-semantics gap — the Stun primitive
  // itself is exercised through the interpreter above.
  const state = playZenithBlade();
  finalizeZenithBlade(state);
  assert.throws(() => resolveAll(state.engine), /effect\.stun target must be a spec id string/);
  assert.equal(state.kernel.getObject("enemy").stunned, false);
  assert.deepEqual(state.kernel.getObject("source").location, BASE("A"));
});

/**
 * The Move half of the card: the Location read plus the optional Move.
 *
 * This is a harness accommodation, not a card change: the Move body's target is
 * the may node's own TargetSpec, and the reference kernel is supplied with the
 * Finalize-locked reference through setTargets (the merged Solari Chief /
 * pit-rookie convention). Only the Stun instruction's link is dropped, because
 * Resolve stops at that instruction's adapter gap (asserted above); the Move's
 * linked Location read and the optional container are the program's own nodes.
 */
const moveHalfBody = [
  { ...readInstruction, linkedTo: undefined },
  { ...withoutTargets(optionalInstruction), args: { ...optionalInstruction.args } }
];

test("Zenith Blade golden: accepting the optional Move sends the friendly unit to the read battlefield", () => {
  const kernel = world()
    .unit("enemy-unit", { owner: "B", location: BATTLEFIELD("bf2") })
    .unit("friendly-unit", { owner: "A", exhausted: true, location: BASE("A") })
    .build();
  kernel.setTargets("enemy-unit-at-battlefield", [kernel.ref("enemy-unit")]);
  kernel.setTargets("friendly-unit", [kernel.ref("friendly-unit")]);
  kernel.setAnswers({ "may-move-friendly-unit/optional": true });

  // The production chain adapter keeps the raw Exprs, which is how effect.move
  // evaluates a linked Location itself (the default interpreter path passes the
  // already-evaluated LocationRef, and effect.move requires an Expr).
  const outcome = resolveChainBody(moveHalfBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status]),
    [
      ["read-that-battlefield", "executed"],
      // The container reports after its children (completion order is
      // documented in effects/interpreter/README.md).
      ["move-friendly-unit", "executed"],
      ["may-move-friendly-unit", "executed"]
    ]
  );
  assert.deepEqual(outcome.linkedValues["read-that-battlefield.battlefield"], BATTLEFIELD("bf2"));
  assert.deepEqual(kernel.getObject("friendly-unit").location, BATTLEFIELD("bf2"));
  // An effect Move is not the Standard Move ability: no exhaust, no cost (144).
  assert.equal(kernel.getObject("friendly-unit").exhausted, true);
  assert.deepEqual(outcome.events.map(event => event.action), ["move-location"]);
});

test("Zenith Blade golden: declining the optional Move leaves the unit untouched", () => {
  const kernel = world()
    .unit("enemy-unit", { owner: "B", location: BATTLEFIELD("bf2") })
    .unit("friendly-unit", { owner: "A", exhausted: true, location: BASE("A") })
    .build();
  kernel.setTargets("enemy-unit-at-battlefield", [kernel.ref("enemy-unit")]);
  kernel.setTargets("friendly-unit", [kernel.ref("friendly-unit")]);
  kernel.setAnswers({ "may-move-friendly-unit/optional": false });

  const outcome = resolveChainBody(moveHalfBody, kernel);

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results.at(-1).result.reason, "skipped");
  assert.deepEqual(kernel.getObject("friendly-unit").location, BASE("A"));
  assert.equal(kernel.getObject("friendly-unit").exhausted, true);
  assert.deepEqual(outcome.events, []);
});

test("Zenith Blade golden: the Move half resolves with a caller-supplied Finalize destination", () => {
  // The production caller owns the runtime Location (355.4.a); this pins the
  // primitive half with the destination the Move above actually read.
  const kernel = world().unit("friendly-unit", { owner: "A", location: BASE("A") }).build();
  const run = runInstruction(
    move,
    { objects: moveInstruction.args.objects, to: { kind: "constant", value: BATTLEFIELD("bf3") } },
    { world: kernel, targets: { "friendly-unit": [kernel.ref("friendly-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("friendly-unit").location, BATTLEFIELD("bf3"));
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
  assert.equal(run.linked.moved.count, 1);
});

test.todo(
  "Zenith Blade Move Destination legality: give the Finalize surface a location plan for effect.move so the " +
    "stunned unit's battlefield is proved a valid Move Destination (355.4 / 355.4.a / 449.2 / 451.1); the merged " +
    "TurnFlow/CombatFlow already produce Contested (452) and stage the Showdown for committed effect Moves, but " +
    "combat start (466.2) and simultaneous combat damage (467.2.c.1.a / 467.3) remain explicitly blocked in the " +
    "Turn/Combat workstream"
);

test.todo(
  "Zenith Blade chain Resolve: decode effect.stun's literal target in chain/interpreter-adapter.ts " +
    "LITERAL_FIELDS so the card's own body resolves through the production chain (currently throws " +
    "\"effect.stun target must be a spec id string\"); the golden asserts that exact engine-side boundary"
);

test.todo(
  "Zenith Blade Stunned consequences: a Stunned unit does not contribute Might to combat damage " +
    "(424.1.b) while still needing its full Might in damage to be killed (424.1.c), and the Stunned " +
    "status is lost at step 3d of the end-of-turn cleanup (424.1.a.2)"
);

