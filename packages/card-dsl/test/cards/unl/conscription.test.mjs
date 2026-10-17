import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/conscription.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { translateCost } from "../../../../engine-core/dist/programs/play.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction } from "../../../../engine-core/dist/effects/testing/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

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
  // Re-probed 2026-10-17: the remaining gaps are the card-declaration binding,
  // the Might ceiling and the missing Recall action.
  assert.match(program.judgeReason, /translateCost/);
  assert.match(program.judgeReason, /translateObjectFilter/);
  assert.match(program.judgeReason, /condition\.result/);
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

test("unl-140-219 Conscription golden: the merged cost plan really charges the caller-supplied 5 XP component (356.2.b)", () => {
  // The Finalize-side optional-additional machinery is merged — a selected
  // optional component with an XP payment builds and pays through the real plan.
  // The card still lacks the wiring that feeds its declared cost.additional into
  // this input.
  const kernel = world().player("A", { xp: 7, energy: 5 }).build();
  kernel.addObject({
    ref: { id: "conscription", zoneEntryId: 1 },
    cardId: program.canonicalCardId,
    name: "Conscription",
    types: ["spell"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "chain",
    location: null,
    might: null,
    energy: 5,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  }, "chain");
  const context = kernel.clone({ source: kernel.ref("conscription"), sourceSnapshot: kernel.getObject("conscription") });
  const plan = buildCostPlan(context, {
    id: "cost:conscription",
    cost: { kind: "explicit", energy: { kind: "constant", value: 5 } },
    optionalAdditional: [
      {
        id: "conscription.additional-cost",
        kind: "additional",
        cost: { kind: "explicit", payments: [{ kind: "xp", amount: { kind: "constant", value: 5 } }] },
        selected: true
      }
    ]
  });
  assert.equal(plan.finalized, true);
  assert.deepEqual(plan.selectedAdditional.map((entry) => entry.id), ["conscription.additional-cost"]);
  assert.equal(plan.total.xp, 5);
  assert.equal(plan.total.energy, 5);

  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.equal(context.player("A").xp, 2);
});

test("unl-140-219 Conscription boundary: the printed cost translates, but the declared cost.additional has no binding path (CR 356.2.b)", () => {
  // Re-probed 2026-10-17: the printed 5 Energy / 2 Chaos Power half is wired
  // (translateCost returns the explicit plan input the golden builds and pays),
  // while the optional 5 XP cost lives on a static ability. programs/play.ts
  // never inspects static abilities, and the production static binder's layerFor
  // refuses the cost.additional kind, so Finalize cannot receive the optional
  // component from this card's own declaration.
  const translated = translateCost(play.cost, "conscription", "play");
  assert.deepEqual(translated, {
    kind: "explicit",
    energy: { kind: "constant", value: 5 },
    power: { kind: "constant", value: 2 }
  });

  assert.throws(
    () => translateCost({ ...play.cost, kind: "cost.additional", payments: costAbility.effect.payments }, "conscription", "play"),
    (error) => error.code === "judge-required" && /Additional costs are not bound/.test(error.message)
  );

  const board = fixture({
    cards: [{ id: "conscription", cardId: program.canonicalCardId, types: ["spell"], energy: 5, power: null, might: null }]
  });
  assert.throws(
    () => createEngineStaticBinder(board.engine).bindStatic(costAbility, board.kernel.getObject("conscription")),
    (error) => error.code === "judge-required" && /cost\.additional/.test(error.message) && /no layer mapping/.test(error.message)
  );
});

test("unl-140-219 Conscription boundary: a paid/declined receipt is readable, but no target range consumes it (CR 356.4.f.1)", () => {
  // The merged condition.result predicate really distinguishes the optional-cost
  // decision, yet the card's instead-branch has to switch the *target range*.
  // target-plan.ts reads only id/filter/location/min/max/selection from a
  // TargetSpec, so a receipt-gated range has no executed consumer; asserting this
  // here keeps the card from declaring a gate the engine would silently ignore.
  const condition = { kind: "result", result: "additional-cost-paid", id: costAbility.effect.id };
  const paid = { plan: { components: [{ id: costAbility.effect.id, stage: "optional-additional" }], selectedAdditional: [{ id: costAbility.effect.id, kind: "additional" }], declinedAdditional: [] }, receipt: { paid: true, additional: [{ id: costAbility.effect.id, paid: true }] } };
  const declined = { plan: { components: [{ id: costAbility.effect.id, stage: "optional-additional" }], selectedAdditional: [], declinedAdditional: [costAbility.effect.id] }, receipt: { paid: true, additional: [] } };
  const kernel = world().player("A", { xp: 7 }).build();
  const evaluate = (cost) => resolveChainBody([{
    id: "receipt-gate",
    op: "condition.value",
    args: { value: { kind: "constant", value: true } },
    condition
  }], kernel.clone(), { cost }).results[0].result;
  assert.equal(evaluate(paid).status, "executed");
  assert.deepEqual(evaluate(declined), { status: "negated", reason: "skipped", events: [] });
  assert.deepEqual(Object.keys(control.targets[0]).filter((key) => key === "condition"), []);
});

test("unl-140-219 Conscription boundary: the Might ceiling target filter is rejected before Finalize (CR 143.2.a)", () => {
  // The printed "3 :rb_might: or less" is part of the TargetSpec the production
  // filter translator has to translate; it still refuses mightLte, so a 7-Might
  // enemy would be an accepted candidate if the filter were fed through as-is.
  assert.throws(
    () => translateObjectFilter(control.targets[0].filter),
    (error) => error.code === "judge-required" && /Unsupported filter field mightLte/.test(error.message)
  );
  assert.equal(control.targets[0].filter.mightLte, 3);
});

test("unl-140-219 Conscription boundary: the worktree's effect.move still blocks the Recall half (CR 457-460)", () => {
  // The Recall is a distinct action, not a Move; the merged primitive reports
  // that boundary instead of relocating the unit, and this card must not
  // substitute a plain move-location for it.
  const kernel = enemyAtBattlefield();
  const run = runInstruction(move, {
    objects: recall.args.objects,
    to: recall.args.to,
    mode: recall.args.mode,
    linkKey: recall.args.linkKey
  }, { world: kernel, targets: { "conscription.enemy-unit": [kernel.ref("enemy")] } });
  assert.deepEqual(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  const receipt = run.linked.recalled;
  assert.match(String(receipt.blockedReason ?? ""), /Recall requires an action distinct from Move/);
  assert.equal(receipt.count, 0);
  assert.equal(kernel.getObject("enemy").zone, "board");
  assert.deepEqual(kernel.getObject("enemy").location, { type: "battlefield", id: "bf-1" });
});

