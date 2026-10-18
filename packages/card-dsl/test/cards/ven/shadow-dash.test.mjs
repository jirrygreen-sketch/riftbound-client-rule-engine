import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/shadow-dash.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
// Card bodies run through the chain's own interpreter adapter — the production
// entry point that re-wraps Expr arguments for the registered primitives.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-d36d553ad15f3dd8bd9c05be30069fca4730d573292d1f2d05ddc4cc468b099f";
const SOURCE_TEXT =
  "Move an enemy unit to a battlefield where you have units. If you have exactly two units there, " +
  "they each get +1 :rb_might: this turn.\n" +
  "[Flow] :rb_energy_5::rb_rune_rainbow::rb_rune_rainbow: (You may play this from your trash for its Flow cost. Then banish it.)";

const [flowKeyword, play] = program.abilities;
const [moveEnemyUnit, grantMight] = play.body;
const [enemySpec] = moveEnemyUnit.targets;

/**
 * The reference kernel compares "self"/"opponent" filters literally, while the
 * production chain query path (chain/engine.ts) normalizes them against the
 * item's controller. Reproduce that normalization so the card's own query shape
 * is what executes; nothing else about the instruction is rewritten.
 */
function chainKernel(kernel) {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") {
        return (filter) => {
          const normalized = { ...filter };
          const kernelFilter = { ...normalized };
          const opponents = [];
          for (const playerKey of ["controller", "owner"]) {
            if (normalized[playerKey] === "self") {
              kernelFilter[playerKey] = target.controller;
            } else if (normalized[playerKey] === "opponent") {
              delete kernelFilter[playerKey];
              opponents.push(playerKey);
            }
          }
          return target
            .query(kernelFilter)
            .filter((object) => opponents.every((playerKey) => object[playerKey] !== target.controller));
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

test("ven-148-166 Shadow Dash: program passes validateCardProgram as judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-148-166 Shadow Dash: judgeReason names the remaining Might and Flow gaps", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /143\.2\.a/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /unitController/);
  assert.match(program.judgeReason, /317\.2\.c/);
  assert.match(program.judgeReason, /Flow/);
  assert.match(program.judgeReason, /params\.cost/);
});

test("ven-148-166 Shadow Dash: [Flow] is declared as a keyword, not re-implemented", () => {
  // 829.1.c: the printed "Flow [Cost]" line is a keyword; its expansion (and the
  // printed 5 energy + 2 rainbow Power cost) is owned by effects/keywords/Flow.
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(flowKeyword, { kind: "keyword", keyword: "flow" });
  assert.equal(flowKeyword.value, undefined);
});

test("ven-148-166 Shadow Dash: Move targets one enemy Board unit and declares its runtime destination", () => {
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(moveEnemyUnit.id, "shadow-dash.move-enemy-unit");
  assert.equal(moveEnemyUnit.op, "effect.move");
  assert.equal(moveEnemyUnit.linkedTo, undefined);
  assert.equal(moveEnemyUnit.condition, undefined);
  assert.equal(moveEnemyUnit.picks, undefined);
  assert.deepEqual(moveEnemyUnit.args.objects, {
    kind: "constant",
    value: { target: "shadow-dash.enemy-unit" }
  });
  assert.deepEqual(moveEnemyUnit.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(moveEnemyUnit.args.linkKey, { kind: "constant", value: "movedEnemy" });
  // 355.4 / 355.4.a: the destination is chosen at resolution from the legal
  // Battlefield LocationTargetSpec and read by the target-location expression.
  assert.deepEqual(moveEnemyUnit.args.to, {
    kind: "location",
    value: { kind: "target-location", target: "shadow-dash.battlefield" }
  });
  assert.deepEqual(moveEnemyUnit.locations, [{
    id: "shadow-dash.battlefield",
    type: "battlefield",
    unitController: "controller",
    hasUnits: true,
    min: 1,
    max: 1,
    selection: "one"
  }]);
  // 355.7 / 355.9.a.1 / 355.9.b: "an enemy unit" is a chosen Board object.
  assert.equal(moveEnemyUnit.targets.length, 1);
  assert.deepEqual(enemySpec, {
    id: "shadow-dash.enemy-unit",
    filter: { type: "unit", zone: "board", controller: "opponent" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ven-148-166 Shadow Dash: the Might grant is a same-location set gated on exactly two units", () => {
  // "If you have exactly two units there" is the programmatic set of the
  // ability controller's units at the moved unit's location (355.10.d/e). The
  // location comes from the move receipt, i.e. the result reference of
  // 359.3.e.14, via the sameLocationAs anchor.
  assert.equal(grantMight.id, "shadow-dash.grant-might-to-two");
  assert.equal(grantMight.op, "continuous.might");
  assert.equal(grantMight.linkedTo, "shadow-dash.move-enemy-unit");
  assert.equal(grantMight.targets, undefined);
  assert.equal(grantMight.picks, undefined);
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(grantMight.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: {
        type: "unit",
        zone: "board",
        controller: "self",
        sameLocationAs: { linked: "shadow-dash.move-enemy-unit" }
      }
    }
  });
  assert.equal(grantMight.args.appliesTo, undefined);
  assert.equal(grantMight.condition.kind, "compare");
  assert.equal(grantMight.condition.operator, "eq");
  assert.deepEqual(grantMight.condition.right, { kind: "constant", value: 2 });
  assert.equal(grantMight.condition.left.kind, "count");
  assert.deepEqual(grantMight.condition.left.filter, {
    type: "unit",
    zone: "board",
    controller: "self",
    sameLocationAs: { linked: "shadow-dash.move-enemy-unit" }
  });
});

test("ven-148-166 Shadow Dash golden: the declared LocationTargetSpec moves the enemy to the chosen battlefield", () => {
  // 421 / 448-451: an effect Move relocates a permanent between Board spaces and
  // is not a zone change (448.2); no Standard Move exhaust cost or Main-Phase
  // The location answer is supplied through the production interpreter's normal
  // location-choice request, then consumed by target-location.
  const kernel = world()
    .unit("enemy-unit", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("ally-a", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-2" } })
    .unit("ally-b", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-2" } })
    .object("bf-2", { owner: "A", controller: "A", types: ["battlefield"], zone: "board", location: null })
    .build();
  kernel.setTargets(enemySpec.id, [kernel.ref("enemy-unit")]);
  kernel.setAnswers({ "shadow-dash.move-enemy-unit/location%3Ashadow-dash.battlefield": { type: "battlefield", id: "bf-2" } });
  const run = resolveChainBody([moveEnemyUnit], chainKernel(kernel));

  assert.equal(run.status, "executed");
  assert.deepEqual(kernel.getObject("enemy-unit").location, { type: "battlefield", id: "bf-2" });
  assert.deepEqual(run.linkedValues["shadow-dash.move-enemy-unit.movedEnemy"], {
    count: 1,
    objects: [{ id: "enemy-unit", zoneEntryId: 1 }],
    movements: [
      {
        object: { id: "enemy-unit", zoneEntryId: 1 },
        from: { type: "battlefield", id: "bf-1" },
        to: { type: "battlefield", id: "bf-2" }
      }
    ]
  });
  assert.deepEqual(run.events.map((event) => event.action), ["move-location"]);
});

test("ven-148-166 Shadow Dash golden: the original body moves, counts its genuine receipt and grants exactly two allies Might", () => {
  const execute = (allyCount, { elsewhere = 0, extraAllyHere = 0 } = {}) => {
    const builder = world()
      .object("cast-source", { types: ["spell"], zone: "chain" })
      .unit("enemy-unit", { owner: "B", location: { type: "battlefield", id: "bf-1" } })
      .unit("enemy-at-destination", { owner: "B", might: 4, location: { type: "battlefield", id: "bf-2" } })
      .object("bf-2", { owner: "B", types: ["battlefield"], zone: "board", location: null });
    for (let index = 0; index < allyCount + extraAllyHere; index++) {
      builder.unit(`ally-${index}`, { might: 3, location: { type: "battlefield", id: "bf-2" } });
    }
    for (let index = 0; index < elsewhere; index++) {
      builder.unit(`elsewhere-${index}`, { might: 3, location: { type: "battlefield", id: "bf-9" } });
    }
    const base = builder.build();
    const kernel = base.clone({ sourceSnapshot: base.getObject("cast-source") });
    kernel.setTargets(enemySpec.id, [kernel.ref("enemy-unit")]);
    kernel.setAnswers({ "shadow-dash.move-enemy-unit/location%3Ashadow-dash.battlefield": { type: "battlefield", id: "bf-2" } });
    const outcome = resolveChainBody(play.body, chainKernel(kernel));
    const layers = createLayerEngine(kernel.objects, kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 })));
    const qualifies = allyCount + extraAllyHere === 2;
    assert.deepEqual(kernel.getObject("enemy-unit").location, { type: "battlefield", id: "bf-2" });
    assert.deepEqual(outcome.linkedValues[`${moveEnemyUnit.id}.movedEnemy`].objects, [kernel.ref("enemy-unit")]);
    assert.equal(outcome.results[0].result.status, "executed");
    assert.equal(outcome.results[1].result.status, qualifies ? "executed" : "negated");
    if (!qualifies) assert.equal(outcome.results[1].result.reason, "skipped");
    assert.deepEqual(outcome.events.map(event => event.action), ["move-location"], "the Might set creates no extra targets");
    assert.equal(kernel.continuousEffects.length, qualifies ? 2 : 0);
    for (let index = 0; index < allyCount + extraAllyHere; index++) {
      assert.equal(layers.evaluate(kernel.ref(`ally-${index}`)).might, qualifies ? 4 : 3);
    }
    for (let index = 0; index < elsewhere; index++) assert.equal(layers.evaluate(kernel.ref(`elsewhere-${index}`)).might, 3);
    assert.equal(layers.evaluate(kernel.ref("enemy-at-destination")).might, 4);
    if (qualifies) {
      assert.equal(outcome.linkedValues[`${grantMight.id}.affected.count`], 2);
      assert.deepEqual(outcome.linkedValues[`${grantMight.id}.affected.objects`], [kernel.ref("ally-0"), kernel.ref("ally-1")]);
      for (const entry of kernel.continuousEffects) assert.deepEqual(entry.duration, { type: "end-of-turn" });
    }
    return qualifies;
  };
  assert.equal(execute(2), true);
  assert.equal(execute(1), false);
  assert.equal(execute(3), false);
  // Two allies elsewhere plus one here do not satisfy "exactly two there".
  assert.equal(execute(1, { elsewhere: 2 }), false);
  assert.equal(execute(2, { elsewhere: 1 }), true);
});

test("ven-148-166 Shadow Dash golden: the merged continuous.might registers a per-object layer from refs", () => {
  // Keep the earlier explicit-reference coverage alongside the original
  // query-selector body test above. Both use the merged primitive.
  const kernel = world().unit("friend", { zone: "board" }).build();
  const run = runInstruction(
    might,
    {
      amount: grantMight.args.amount,
      duration: grantMight.args.duration,
      objects: { kind: "constant", value: { objects: [kernel.ref("friend")] } }
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.affected, {
    count: 1,
    objects: [kernel.ref("friend")]
  });
  // addContinuous produces no events (contract 3.8); the layer registration is
  // the effect's output.
  assert.deepEqual(run.events, []);
  assert.ok(Object.hasOwn(run.linked, "__continuous.settlement.continuous.might.source.1"));
});

test.todo(
  "Shadow Dash: target/location must enforce unitController against battlefield occupants (355.4/451.1), " +
    "and end-of-turn duration must expire at the 317.2.c Expiration Step; the original query Might body executes above"
);

test.todo(
  "Shadow Dash: the printed [Flow] :rb_energy_5::rb_rune_rainbow::rb_rune_rainbow: alternate cost and its then-banish replacement " +
    "(829.1.b/829.1.c) need card-program -> keyword params.cost forwarding plus Flow alternate-cost and replacement consumers"
);
