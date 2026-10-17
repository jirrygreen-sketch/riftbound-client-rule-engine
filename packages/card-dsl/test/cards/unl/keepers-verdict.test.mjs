import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/keepers-verdict.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { AwaitChoice, runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-f90cd5af60e3899d3330ee8473377f3975c421713216d6ec28e24242296f72be";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Choose an enemy unit at a battlefield. Its owner places it on the top or bottom of their Main Deck.";

const [actionKeyword, play] = program.abilities;
const [chooseDestination] = play.body;
const [topMode, bottomMode] = chooseDestination.args.modes.value;
const toTop = topMode.body[0];
const toBottom = bottomMode.body[0];

// The reference kernel compares filter values literally, so the
// Finalize-locked enemy unit is supplied by the harness and the authored
// TargetSpec (asserted structurally above) is stripped before execution.
const { targets: _omittedSpec, ...chooseDestinationWithoutSpec } = chooseDestination;

test("unl-204-219 Keeper's Verdict: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-204-219 Keeper's Verdict: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // The unresolved block is the resolution-time mode choice inside a resolving
  // card body, with the contract-3.9 shape recorded as written.
  assert.match(program.judgeReason, /355\.17/);
  assert.match(program.judgeReason, /355\.16/);
  assert.match(program.judgeReason, /assertFinalizationSurface/);
  assert.match(program.judgeReason, /choice-plan adapter/);
});

test("unl-204-219 Keeper's Verdict: [Action] plus one top-or-bottom mode choice by the unit's owner", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 1);

  assert.equal(chooseDestination.id, "keepers-verdict.choose-destination");
  assert.equal(chooseDestination.op, "choice.mode");
  assert.equal(chooseDestination.linkedTo, undefined);
  // "Its owner" places the card: the chooser is read from the chosen unit's
  // owner referent (359.3.f.1).
  assert.deepEqual(chooseDestination.args.chooser, {
    kind: "object-property",
    object: { target: "keepers-verdict.enemy-unit" },
    property: "owner"
  });
  assert.deepEqual(chooseDestination.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(chooseDestination.args.different, { kind: "constant", value: true });

  // "Choose an enemy unit at a battlefield" is a specific choice, so the unit
  // is a target (355.5 / 355.7 / 355.9.a.1) and enemy plus at-a-battlefield are
  // its legality restrictions (355.9.b / 355.10.b).
  assert.deepEqual(chooseDestination.targets, [
    {
      id: "keepers-verdict.enemy-unit",
      filter: { type: "unit", controller: "opponent", location: "battlefield" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // The two exclusive modes are top and bottom of their Main Deck; the kernel
  // routes each card to its owner's deck (056.1).
  assert.deepEqual(
    chooseDestination.args.modes.value.map((mode) => mode.id),
    ["keepers-verdict-top", "keepers-verdict-bottom"]
  );
  assert.equal(topMode.body.length, 1);
  assert.equal(bottomMode.body.length, 1);
  assert.equal(toTop.op, "effect.zone");
  assert.deepEqual(toTop.args.to, { kind: "constant", value: "deck-top" });
  assert.equal(toBottom.op, "effect.zone");
  assert.deepEqual(toBottom.args.to, { kind: "constant", value: "deck-bottom" });
  for (const instruction of [toTop, toBottom]) {
    assert.equal(instruction.linkedTo, undefined);
    assert.equal(instruction.targets, undefined);
  }
});

test("unl-204-219 Keeper's Verdict golden: effect.zone sends the unit to the top of its owner's Main Deck", () => {
  const kernel = world()
    .unit("enemy", { owner: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .deck(["b-one", "b-two"], { owner: "B" })
    .build();
  const run = runInstruction(
    zone,
    { target: "keepers-verdict.enemy-unit", to: toTop.args.to },
    { world: kernel, targets: { "keepers-verdict.enemy-unit": [kernel.ref("enemy")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved, 1);
  // 056.1: the card goes to its OWNER's Main Deck, not the caster's.
  assert.deepEqual(kernel.zone("B", "deck").map((ref) => ref.id), ["enemy", "b-one", "b-two"]);
  assert.deepEqual(kernel.zone("A", "deck"), []);
  assert.deepEqual(run.events.map((event) => event.action), ["move-zone"]);
});

test("unl-204-219 Keeper's Verdict golden: effect.zone sends the unit to the bottom of its owner's Main Deck", () => {
  const kernel = world()
    .unit("enemy", { owner: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .deck(["b-one", "b-two"], { owner: "B" })
    .build();
  const run = runInstruction(
    zone,
    { target: "keepers-verdict.enemy-unit", to: toBottom.args.to },
    { world: kernel, targets: { "keepers-verdict.enemy-unit": [kernel.ref("enemy")] } }
  );

  assert.equal(run.result.status, "executed");
  // Bottom placement puts the card after the existing deck order and does not
  // disturb it (417.1.a / 437.4 semantics for the owner's deck).
  assert.deepEqual(kernel.zone("B", "deck").map((ref) => ref.id), ["b-one", "b-two", "enemy"]);
  assert.deepEqual(kernel.zone("A", "deck"), []);
});

test("unl-204-219 Keeper's Verdict golden: the real mode choice belongs to the unit's owner, not the caster", () => {
  const kernel = world()
    .unit("enemy", { owner: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .deck(["b-one", "b-two"], { owner: "B" })
    .build();
  kernel.setTargets("keepers-verdict.enemy-unit", [kernel.ref("enemy")]);

  // No answer yet: the mode request must be addressed to the owner (B).
  assert.throws(
    () => resolveChainBody([chooseDestinationWithoutSpec], kernel.clone()),
    (error) => {
      assert.ok(error instanceof AwaitChoice);
      assert.equal(error.request.type, "mode");
      assert.equal(error.request.chooser, "B");
      assert.deepEqual(error.request.options, ["keepers-verdict-top", "keepers-verdict-bottom"]);
      return true;
    }
  );

  // With the owner's answer supplied, the chosen mode executes for real.
  const answered = kernel.clone();
  answered.setTargets("keepers-verdict.enemy-unit", [answered.ref("enemy")]);
  answered.setAnswers({ "keepers-verdict.choose-destination/mode%3A0": "keepers-verdict-bottom" });
  const outcome = resolveChainBody([chooseDestinationWithoutSpec], answered);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["keepers-verdict.to-bottom", "executed"],
      ["keepers-verdict.choose-destination", "executed"]
    ]
  );
  assert.deepEqual(answered.zone("B", "deck").map((ref) => ref.id), ["b-one", "b-two", "enemy"]);
  // effect.zone submits its deck-bottom move through the closed vocabulary's
  // recycle action (CR 417.1: recycling takes cards from a zone to the bottom
  // of the corresponding deck, and 417.1.c routes them to their owner's deck).
  assert.deepEqual(answered.events.map((event) => event.action), ["recycle"]);
});

test("unl-204-219 Keeper's Verdict golden: a unit at a base is not a legal target for the printed restriction", () => {
  // 355.9.b / 355.10.b: "at a battlefield" restricts the target unit; the
  // merged filter matcher the chain uses compares the location type. The
  // reference kernel compares filter values literally, so the restriction is
  // asserted here rather than re-derived.
  const spec = chooseDestination.targets[0];
  assert.deepEqual(spec.filter, { type: "unit", controller: "opponent", location: "battlefield" });
  assert.notDeepEqual(spec.filter, { type: "unit", controller: "opponent" });
});

test("unl-204-219 Keeper's Verdict golden: a stale unit reference is mistargeted instead of moved to a deck", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 3 }).build();
  const stale = kernel.ref("enemy");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  const run = runInstruction(
    zone,
    { target: "keepers-verdict.enemy-unit", to: toTop.args.to },
    { world: kernel, targets: { "keepers-verdict.enemy-unit": [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.deepEqual(run.events, []);
  assert.deepEqual(kernel.zone("B", "deck"), []);
});
