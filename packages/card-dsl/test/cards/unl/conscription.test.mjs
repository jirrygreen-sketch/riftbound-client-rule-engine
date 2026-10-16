import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/conscription.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-25d95fca3a71b0c54c47c59f37cb281740cdfe6478a2d0f9c23309aaff471bcd";
const SOURCE_TEXT =
  "You may spend 5 XP as an additional cost to play this.\n" +
  "Choose an enemy unit at a battlefield with 3 :rb_might: or less. If you paid the additional cost, " +
  "choose any enemy unit at a battlefield instead. Take control of it, exhaust it, and recall it.";

const [costAbility, play] = program.abilities;
const [control, exhaust, recall] = play.body;
// The reference kernel compares controller placeholders ("controller" /
// "opponent") verbatim, so golden execution locks the targets through the
// kernel and runs the bodies without their TargetSpecs (the one-two-punch /
// facebreaker convention).
const executableBody = play.body.map(({ targets, ...rest }) => rest);

const enemyAtBattlefield = (kernel) =>
  world()
    .player("A")
    .player("B")
    .unit("enemy", {
      owner: "B",
      controller: "B",
      might: 2,
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();

test("unl-140-219 Conscription: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  // README section 2: the reason names the concrete missing pieces and tasks.
  assert.match(program.judgeReason, /cost\.additional/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /mightLte/);
  assert.match(program.judgeReason, /recall/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("unl-140-219 Conscription: the optional 5 XP additional cost is recorded as a cost component", () => {
  assert.equal(costAbility.kind, "static");
  // 356.2.b / 356.2.b.1: the printed "may ... as an additional cost" is an
  // Optional Additional Cost imposed by a passive ability of the played card.
  assert.equal(costAbility.effect.kind, "cost.additional");
  assert.equal(costAbility.effect.optional, true);
  assert.equal(costAbility.effect.stage, "optional-additional");
  assert.equal(costAbility.effect.appliesTo, "self");
  // 729 / 730.2: 5 XP, the player resource that is spent.
  assert.deepEqual(costAbility.effect.payments, [
    { kind: "xp", amount: { kind: "constant", value: 5 } }
  ]);
});

test("unl-140-219 Conscription: printed cost, one enemy target, and the control/exhaust/recall chain", () => {
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 5 },
    power: { kind: "constant", value: 2 }
  });

  // 355.5 makes "Choose an enemy unit at a battlefield" a targeting choice;
  // 355.10.b keeps "at a battlefield" a restriction on the unit. The Might
  // ceiling stays descriptive (see judgeReason).
  assert.deepEqual(control, {
    id: "conscription.take-control",
    op: "effect.control",
    args: { objects: { kind: "constant", value: { target: "conscription.enemy-unit" } } },
    targets: [
      {
        id: "conscription.enemy-unit",
        filter: {
          type: "unit",
          zone: "board",
          controller: "opponent",
          location: "battlefield",
          mightLte: 3
        },
        min: 1,
        max: 1,
        selection: "one"
      }
    ]
  });

  // "it" in "exhaust it" is the same referent (355.10.c), so the instruction
  // links to the control instruction rather than choosing a second unit.
  assert.equal(exhaust.op, "effect.exhaust");
  assert.equal(exhaust.linkedTo, "conscription.take-control");
  assert.deepEqual(exhaust.args, { target: { kind: "constant", value: "conscription.enemy-unit" } });
  assert.equal(exhaust.targets, undefined);

  // 457: a Recall relocates the permanent to its Base without being a Move.
  assert.equal(recall.op, "effect.move");
  assert.equal(recall.linkedTo, "conscription.exhaust");
  assert.deepEqual(recall.args.objects, {
    kind: "constant",
    value: { target: "conscription.enemy-unit" }
  });
  assert.deepEqual(recall.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(recall.args.mode, { kind: "constant", value: "recall" });
});

test("unl-140-219 Conscription golden: take-control then exhaust both resolve on the locked unit", () => {
  const kernel = enemyAtBattlefield();
  kernel.setTargets("conscription.enemy-unit", [kernel.ref("enemy")]);
  const outcome = resolveChainBody(executableBody, kernel);

  // The merged control and exhaust halves execute against the real kernel; the
  // Recall half is covered by a TODO below, so its own result is not asserted
  // here (it must not become a "this primitive is still missing" assertion).
  const resultFor = (id) => outcome.results.find((entry) => entry.id === id).result;
  assert.equal(resultFor("conscription.take-control").status, "executed");
  assert.equal(resultFor("conscription.exhaust").status, "executed");
  // 127.1 / 188-192: control changes to the spell's controller.
  assert.equal(kernel.getObject("enemy").controller, "A");
  // 415.1: exhaust marks the object as spent.
  assert.equal(kernel.getObject("enemy").exhausted, true);
  assert.equal(kernel.getObject("enemy").zone, "board");
  assert.deepEqual(outcome.linkedValues["conscription.take-control.controlled"].changes, [
    { object: { id: "enemy", zoneEntryId: 1 }, owner: "B", from: "B", to: "A" }
  ]);
  // Only the two merged halves are asserted; the Recall step's own events stay
  // unspecified so this card's golden does not depend on its merge state.
  const actions = outcome.events.map((event) => event.action);
  assert.equal(actions.includes("take-control"), true);
  assert.equal(actions.includes("exhaust"), true);
});

test("unl-140-219 Conscription golden: an already-controlled unit reports no control change (190.6.d)", () => {
  const kernel = world()
    .player("A")
    .player("B")
    .unit("own", { owner: "A", controller: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets("conscription.enemy-unit", [kernel.ref("own")]);
  const outcome = resolveChainBody(executableBody, kernel);

  // The control instruction still executes; there is nothing to change, so no
  // change is recorded (127.1: ownership is never changed).
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.linkedValues["conscription.take-control.controlled"], {
    count: 0,
    objects: [],
    changes: []
  });
  assert.equal(kernel.getObject("own").exhausted, true);
});

test("unl-140-219 Conscription golden: a target that left the Board ignores the whole chain (359.3.e.6)", () => {
  const kernel = enemyAtBattlefield();
  const stale = kernel.ref("enemy");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  kernel.setTargets("conscription.enemy-unit", [stale]);
  const outcome = resolveChainBody(executableBody, kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
    [
      ["conscription.take-control", "ignored", "mistargeted"],
      ["conscription.exhaust", "ignored", "linked-ignored"],
      ["conscription.recall", "ignored", "linked-ignored"]
    ]
  );
  assert.equal(kernel.getObject("enemy").zone, "hand");
});

test.todo(
  "unl-140-219 Conscription: charge the optional 5 XP additional cost at Finalize and switch the target range " +
    "when it was paid (CR 356.2.b/356.2.b.1 payment, 356.4.f.1 paid receipt) — needs the card-program cost plan " +
    "wiring (RIFT-89) and a cost-result binding, which the frozen IR has no expression for (condition.result)"
);

test.todo(
  "unl-140-219 Conscription: enforce the 'at a battlefield with 3 :rb_might: or less' targeting restriction at " +
    "Finalize/Resolve (CR 355.9.b, 143.2.a effective Might) once a Might-threshold target predicate is merged (RIFT-81~91/RIFT-90)"
);

test.todo(
  "unl-140-219 Conscription: perform the Recall (CR 457-460: relocates to Base, is not a Move, fires no Move " +
    "triggers, cannot be blocked by movement restrictions) once a Recall action distinct from move-location is merged (RIFT-109 follow-up)"
);

