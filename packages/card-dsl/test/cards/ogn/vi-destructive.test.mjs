import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/vi-destructive.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction } from "../../../../engine-core/dist/effects/testing/index.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { translateCost } from "../../../../engine-core/dist/programs/play.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID = "card.hash-bcfd5b90d3252713ccfca0703a0d9aef17711a45ff2065bd68d7dd7822950b51";
const literal = (value) => ({ kind: "constant", value });
const gankingKeyword = keywordDefinitionsById.get("Ganking");

test("ogn-036-298 Vi, Destructive: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.match(program.judgeReason, /permission\.routes/);
  assert.match(program.judgeReason, /pick\/choice/);
  assert.match(program.judgeReason, /Trash/);
  assert.match(program.judgeReason, /choiceObjects|精确 ObjectRef/);
  assert.match(program.judgeReason, /buildCostPlan/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(83|89|90|91|257|258|261|347)/);
});

test("ogn-036-298 Vi, Destructive: identity, ruleset and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
      "Recycle 1 from your trash: Give me +1 :rb_might: this turn."
  );
});

test("ogn-036-298 Vi, Destructive: Ganking keyword plus an action-speed activated recycle-for-Might ability", () => {
  assert.equal(program.abilities.length, 2);
  const [ganking, activated] = program.abilities;
  assert.deepEqual(ganking, { kind: "keyword", keyword: "ganking" });

  assert.equal(activated.kind, "activated");
  // No printed [Action]/[Reaction] permission: units default to action timing.
  assert.equal(activated.timing, "action");
  assert.equal(activated.restriction, undefined);

  // "Recycle 1 from your trash" is a cost (417.3), declared through the frozen
  // CostSpec payment shape; the printed part is the trash zone and owner.
  assert.deepEqual(activated.cost.payments, [
    {
      kind: "recycle",
      choice: {
        id: "vi-destructive.trash-card",
        options: ["card-in-controller-trash"],
        zone: "trash",
        owner: "controller",
        min: 1,
        max: 1,
        selection: "one"
      }
    }
  ]);

  assert.equal(activated.body.length, 1);
  const [instruction] = activated.body;
  assert.equal(instruction.id, "vi-destructive.might-1");
  assert.equal(instruction.op, "continuous.might");
  assert.equal(instruction.args.amount.value, 1);
  assert.equal(instruction.args.duration.value, "end-of-turn");
  // "me" is the ability source, read through the contract 3.6 symbolic
  // source selector (the merged continuous.might args shape).
  assert.deepEqual(instruction.args.objects, {
    kind: "constant",
    value: { kind: "source" }
  });
});

test("ogn-036-298 Vi, Destructive golden: 'Give me +1 Might this turn' registers an end-of-turn arithmetic effect", () => {
  const base = world().unit("vi", { might: 3, exhausted: true }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("vi") });

  const outcome = resolveChainBody(program.abilities[1].body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["vi-destructive.might-1", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 1);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.deepEqual(outcome.results[0].result.linkedValues.affected, {
    count: 1,
    objects: [kernel.ref("vi")]
  });

  const engine = createLayerEngine(kernel.objects, kernel.continuousEffects.map((entry) => ({
    effect: entry.effect, duration: entry.duration, timestamp: 1
  })));
  assert.equal(engine.evaluate(kernel.ref("vi")).might, 4);
  assert.equal(engine.expireAt("turn-end").length, 1);
  assert.equal(engine.evaluate(kernel.ref("vi")).might, 3);
});

test("ogn-036-298 Vi, Destructive golden: the Recycle 1 from trash cost is charged through the merged cost plan (417.3)", () => {
  const base = world().unit("vi", { might: 3 }).build();
  const trashRef = base.addObject({
    ref: { id: "trash-card", zoneEntryId: 1 }, name: "trash-card", owner: "A", controller: "A",
    zone: "trash", location: null, exhausted: false, might: 1, types: ["unit"], tags: [],
    keywords: [], energy: null, power: null
  }, "trash");
  const kernel = base.clone({ sourceSnapshot: base.getObject("vi") });
  // The card's static cost carries a non-ref trash placeholder, so the plan is
  // built with the Finalize-time candidate list (the same hand-off the merged
  // discard-cost tests use); the printed shape itself is asserted above.
  kernel.setPicks("vi-destructive.trash-card", [trashRef]);
  const plan = buildCostPlan(kernel, {
    id: "cost:vi-destructive",
    cost: {
      payments: [
        {
          kind: "recycle",
          choice: {
            id: "vi-destructive.trash-card",
            options: [trashRef],
            zone: "trash",
            owner: "controller",
            min: 1,
            max: 1,
            selection: "one"
          }
        }
      ]
    }
  });
  assert.deepEqual(plan.total.actions.map((entry) => entry.action.type), ["recycle"]);
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.getObject("trash-card").zone, "deck");
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["trash-card"]);
});

test("ogn-036-298 Vi, Destructive: the printed trash placeholder is not an exact ObjectRef, so static Finalize rejects the cost (417.3)", () => {
  // The static IR can only spell the printed selection as a placeholder string.
  // Handing the card's own cost to the merged planner throws the exact
  // invalid-cost-plan error; the transfer of a Finalize-time trash choice into
  // the activation's pick/choice is the remaining gap.
  const kernel = world().unit("vi", { might: 3 }).build();
  assert.deepEqual(program.abilities[1].cost.payments[0].choice.options, ["card-in-controller-trash"]);
  assert.throws(
    () => buildCostPlan(kernel, { id: "cost:vi-destructive", cost: program.abilities[1].cost }),
    (error) => error.name === "CostPlanError" && error.reason === "invalid-cost-plan" && /exact object reference/.test(error.message)
  );
});

test("ogn-036-298 Vi, Destructive: production activation translate + Finalize reject the card's own cost", () => {
  // The same failure through the real production adapter: translateCost keeps
  // the placeholder, describeActivate builds the draft, and the chain's Finalize
  // call to buildCostPlan throws.
  const translated = translateCost(program.abilities[1].cost, "activate:vi:1:A:1", "activate");
  assert.deepEqual(translated.payments, [
    {
      kind: "recycle",
      choice: {
        id: "vi-destructive.trash-card",
        options: ["card-in-controller-trash"],
        zone: "trash",
        owner: "controller",
        min: 1,
        max: 1,
        selection: "one"
      }
    }
  ]);

  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const f = fixture({
    cards: [{ id: "vi", cardId: CARD_ID, types: ["unit"], energy: 2, power: ["Fury"], might: 3 }]
  });
  binding.attachLifecycle(f.engine);
  const draft = binding.describeActivate(f.kernel.getObject("vi"), "A", 0);
  assert.equal(draft.kind, "activated");
  assert.equal(draft.speed, "action");
  assert.throws(
    () => f.engine.execute({ ...draft, kind: "triggered" }),
    (error) => error.name === "CostPlanError" && error.reason === "invalid-cost-plan" && /exact object reference/.test(error.message)
  );
});

test("ogn-036-298 Vi, Destructive: the merged Ganking expansion registers a permission string the rules query cannot read (810.1.b)", () => {
  // The keyword expansion and the production static binder are both merged; the
  // registered effect keeps permission as a plain string, while the movement
  // query reads permission.routes. The registered Battlefield->Battlefield
  // route therefore never appears for the granted unit.
  assert.equal(gankingKeyword.keyword.toLowerCase(), "ganking");
  const [gankingAbility] = gankingKeyword.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(gankingAbility.kind, "static");
  assert.deepEqual(gankingAbility.effect, {
    kind: "continuous.movement",
    permission: "battlefield-to-battlefield",
    source: "battlefield",
    destination: "battlefield",
    move: "standard",
    addsPermission: true
  });

  const f = fixture({
    cards: [{ id: "vi", cardId: CARD_ID, types: ["unit"], energy: 2, power: ["Fury"], might: 3 }]
  });
  const binder = createEngineStaticBinder(f.engine);
  const handle = binder.bindStatic(gankingAbility, f.kernel.getObject("vi"));
  assert.deepEqual(
    f.engine.layers.registry.list().map((entry) => entry.effect.effect.permission),
    ["battlefield-to-battlefield"]
  );
  const view = movement(f.engine.layers.registry, f.kernel.ref("vi"), f.kernel.getObject("vi"), "A");
  assert.equal(view.canGank, false);
  assert.equal(view.battlefieldToBattlefield, false);
  assert.deepEqual(view.permissions, []);
  handle.unbind();
  assert.deepEqual(f.engine.layers.registry.list(), []);
});

test("ogn-036-298 Vi, Destructive: the continuous.movement primitive normalizes the same permission for the Standard Move rules bridge", async () => {
  // The normalization exists in the primitive: running the expansion's effect
  // through effects/instructions/continuous.movement.ts records
  // permission.routes, which the merged optional rules bridge of
  // zones/movement.ts then consumes for a real Battlefield->Battlefield
  // Standard Move. Only the production static registration still lacks it.
  const { default: movementInstruction } = await import("../../../../engine-core/dist/effects/instructions/continuous.movement.js");
  const { selectDuelBattlefields, createDuelBoard, placeDuelUnit } = await import("../../../../engine-core/dist/duel/battlefields.js");
  const { moveDuelUnitsStandard } = await import("../../../../engine-core/dist/zones/movement.js");

  const kernel = world()
    .unit("vi", { cardId: CARD_ID, location: { type: "battlefield", id: "origin" }, might: 3 })
    .build();
  const [gankingAbility] = gankingKeyword.expand({ host: { canonicalCardId: CARD_ID } });
  const { kind, ...effectArgs } = gankingAbility.effect;
  const registered = runInstruction(
    movementInstruction,
    Object.fromEntries(Object.entries(effectArgs).map(([key, value]) => [key, literal(value)])),
    { world: kernel }
  );
  assert.equal(registered.result.status, "executed");
  assert.deepEqual(kernel.continuousEffects.map((entry) => entry.effect.effect), [
    {
      kind: "movement",
      permission: { routes: ["battlefield-to-battlefield"], source: "battlefield", destination: "battlefield", move: "standard" }
    }
  ]);

  const seats = ["A", "B"].map((playerId) => ({
    playerId,
    battlefields: [1, 2, 3].map((index) => ({ instanceId: `${playerId}-${index}`, cardId: `field-${index}` }))
  }));
  const empty = createDuelBoard(selectDuelBattlefields(seats, () => 0));
  const [origin, destination] = empty.battlefields.map((field) => field.locationId);
  const board = placeDuelUnit(empty, { objectId: "vi", controllerPlayerId: "A", locationId: origin });
  const registry = new ContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  const result = moveDuelUnitsStandard(
    board,
    [{ objectId: "vi", readied: true, hasGanking: false }],
    {
      actor: "A",
      unitUIDs: ["vi"],
      destinationLocationId: destination,
      timing: { phase: "main", stateOpen: true, turnPlayerId: "A", priorityPlayerId: "A" }
    },
    { registry }
  );
  assert.equal(result.board.units.find((unit) => unit.objectId === "vi").locationId, destination);
  assert.equal(result.readiness.find((entry) => entry.objectId === "vi").hasGanking, false);
  assert.equal(result.group.exhaustedCount, 1);
  assert.deepEqual(result.group.events, [
    { objectId: "vi", actor: "A", fromLocationId: origin, toLocationId: destination }
  ]);
});

test.todo(
  "ogn-036-298 Vi, Destructive: pay the 'Recycle 1 from your trash' cost through the card's own static cost " +
    "in production activation Finalize — the placeholder options list cannot name the runtime trash cards, so the " +
    "Finalize-time trash choice must be bound into the plan's pick/choice before buildCostPlan runs."
);

test.todo(
  "ogn-036-298 Vi, Destructive: normalize the Ganking expansion's string permission into the permission.routes " +
    "shape read by layers/rules/query.ts inside the production static registration, then prove Standard Move accepts " +
    "battlefield-to-battlefield movement through that registered route (810.1.c, 144.4.c)."
);

