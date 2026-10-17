import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/vi-destructive.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-bcfd5b90d3252713ccfca0703a0d9aef17711a45ff2065bd68d7dd7822950b51";

test("ogn-036-298 Vi, Destructive: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.match(program.judgeReason, /RIFT-261/);
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

test.todo(
  "ogn-036-298 Vi, Destructive: pay the 'Recycle 1 from your trash' cost through buildCostPlan/payCostPlan " +
    "from the card's own static cost — the printed options placeholder cannot name the runtime trash cards " +
    "(RIFT-261 cost-choice enumeration); the plan itself is golden-backed with the Finalize-time candidates."
);
test.todo(
  "ogn-036-298 Vi, Destructive: the granted [Ganking] movement permission needs a production consumer in " +
    "the Standard Move legality check (duel/movement.ts takes an external deriveGanking callback)."
);
