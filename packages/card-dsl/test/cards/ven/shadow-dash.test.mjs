import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/shadow-dash.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
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
  // README §2: the reason names the missing selector/primitive and the owner.
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /143\.2\.a/);
  assert.match(program.judgeReason, /Flow/);
  // The might primitive is merged; the remaining gap is the same-location
  // selector vocabulary, not a missing op.
  assert.match(program.judgeReason, /sameLocationAs 集合选择器/);
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
    controller: "controller",
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
  assert.deepEqual(grantMight.args.appliesTo, {
    kind: "constant",
    value: {
      type: "unit",
      zone: "board",
      controller: "self",
      sameLocationAs: { linked: "shadow-dash.move-enemy-unit" }
    }
  });
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

test("ven-148-166 Shadow Dash golden: the exactly-two condition reads the moved location and gates the grant", () => {
  // `alliesAt` is where the controller's units actually sit; `movedTo` is the
  // location the move receipt records (359.3.e.14). The condition must count the
  // units at the location the enemy unit moved to — not "two units anywhere".
  const conditioned = (allyCount, { alliesAt = "bf-2", movedTo = "bf-2", extra = 0 } = {}) => {
    const builder = world().unit("cast-source", { owner: "A", controller: "A", types: ["spell"], zone: "chain" });
    for (let index = 0; index < allyCount; index++) {
      builder.unit(`ally-${index}`, { owner: "A", controller: "A", location: { type: "battlefield", id: alliesAt } });
    }
    for (let index = 0; index < extra; index++) {
      builder.unit(`elsewhere-${index}`, { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-9" } });
    }
    const kernel = builder.unit("enemy-unit", { owner: "B", controller: "B", location: { type: "battlefield", id: movedTo } }).build();
    const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("cast-source") });
    // The move receipt the production body would have written (359.3.e.14);
    // the enemy unit is present at the destination so the location resolves.
    scoped.link("shadow-dash.move-enemy-unit", {
      count: 1,
      objects: [kernel.ref("enemy-unit")],
      movements: [
        {
          object: kernel.ref("enemy-unit"),
          from: { type: "battlefield", id: "bf-1" },
          to: { type: "battlefield", id: movedTo }
        }
      ]
    });
    const outcome = resolveChainBody(
      [{ id: "shadow-dash.condition-probe", op: "condition.predicate", args: { condition: { kind: "constant", value: grantMight.condition } } }],
      chainKernel(scoped)
    );
    return outcome.linkedValues["shadow-dash.condition-probe.value"];
  };

  assert.equal(conditioned(2), true);
  assert.equal(conditioned(1), false);
  assert.equal(conditioned(3), false);
  // The same-location anchor is not a blanket "you have two units anywhere":
  // two of your units at another battlefield do not satisfy "exactly two units
  // there" at the destination.
  assert.equal(conditioned(2, { alliesAt: "bf-9", movedTo: "bf-2" }), false);
  // The count is location-scoped: two units at the destination plus one more at
  // a different battlefield still satisfies "exactly two units there".
  assert.equal(conditioned(2, { alliesAt: "bf-2", movedTo: "bf-2", extra: 1 }), true);
});

test("ven-148-166 Shadow Dash golden: the merged continuous.might registers a per-object layer from refs", () => {
  // The card's same-location selector is not in the merged primitive's
  // vocabulary (judgeReason gap 2), so this golden runs the merged
  // continuous.might on the ref-array shape it does accept and asserts the
  // layer registration plus the affected receipt. It proves the primitive, not
  // the card's selector.
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

test("ven-148-166 Shadow Dash golden: the same-location filter selector is rejected by the merged primitive", () => {
  // Fail-closed: the card's appliesTo filter with sameLocationAs is not a
  // selector the merged primitive accepts, so feeding it the card's real shape
  // must throw rather than silently apply the grant to the wrong set.
  const kernel = world().unit("friend", { zone: "board" }).build();
  assert.throws(
    () => runInstruction(
      might,
      {
        amount: grantMight.args.amount,
        duration: grantMight.args.duration,
        appliesTo: grantMight.args.appliesTo
      },
      { world: kernel }
    ),
    /continuous\.might appliesTo must evaluate to "self"/
  );
  // The rejected instruction never committed anything (fail closed).
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "Shadow Dash: 'they each get +1 :rb_might: this turn' (143.2.a effective Might, 317.2.c end-of-turn expiry) needs a card-facing " +
    "continuous.might selector for the same-location set; the merged primitive accepts refs/{objects:[refs]} shapes " +
    "(executed above) but rejects the card's sameLocationAs filter anchor, which belongs to the target/location plan"
);

test.todo(
  "Shadow Dash: the printed [Flow] :rb_energy_5::rb_rune_rainbow::rb_rune_rainbow: alternate cost and its then-banish replacement " +
    "(829.1.b/829.1.c) need card-program -> keyword params.cost forwarding plus Flow alternate-cost and replacement consumers"
);
