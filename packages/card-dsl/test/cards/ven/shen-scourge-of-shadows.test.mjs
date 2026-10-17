import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/shen-scourge-of-shadows.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-bc2ea9de6b5b9ec4e65b44cd9a1410db1ee6b06013dbd81fb1d1b5daa675f1af";
const SOURCE_TEXT =
  "When I hold, if there is exactly one other unit you control here, draw 1.";

const BATTLEFIELD = { type: "battlefield", id: "bf-1" };
const OTHER_BATTLEFIELD = { type: "battlefield", id: "bf-2" };

const [ability] = program.abilities;
const [draw] = ability.body;

/**
 * The production chain binds the controller/owner placeholders and delegates to
 * the layers filter (chain/engine.ts); the reference kernel does neither, so the
 * goldens bind them here rather than editing the card data (the merged
 * sfd/janna-savior test does the same). The contract 3.6 sameLocationAs / exclude
 * anchors stay real: the interpreter resolves them before the scalar part reaches
 * this query.
 */
const productionContext = (kernel) =>
  bindResolveContext(kernel, {
    query: filter => {
      const normalized = { ...filter };
      for (const key of ["controller", "owner"]) {
        if (normalized[key] === "self" || normalized[key] === "controller") normalized[key] = kernel.controller;
      }
      return kernel.objects.filter(object => {
        for (const key of ["controller", "owner"]) {
          if (normalized[key] === "opponent" && object[key] === kernel.controller) return false;
        }
        const resolved = { ...normalized };
        if (resolved.controller === "opponent") resolved.controller = "any";
        if (resolved.owner === "opponent") resolved.owner = "any";
        return matchesObjectFilter(resolved, object);
      });
    }
  });

/** Shen plus 0/1/2 other friendly units here, or one friendly unit elsewhere. */
const shenWorld = (companion) => {
  const builder = world().unit("shen", { might: 6, location: BATTLEFIELD });
  if (companion === "here") builder.unit("ally-here", { location: BATTLEFIELD });
  else if (companion === "second") {
    builder
      .unit("ally-here", { location: BATTLEFIELD })
      .unit("ally-second", { location: BATTLEFIELD });
  } else if (companion === "elsewhere") {
    builder.unit("ally-elsewhere", { location: OTHER_BATTLEFIELD });
  }
  const kernel = builder.deck("drawn-card").build();
  return productionContext(
    kernel.clone({ source: kernel.ref("shen"), sourceSnapshot: kernel.getObject("shen") })
  );
};

test("ven-042-166 Shen, Scourge of Shadows: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-042-166 Shen, Scourge of Shadows: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /383\.4\.d\.2\.a/);
  assert.match(program.judgeReason, /objectId|pattern\.object/);
  assert.match(program.judgeReason, /controller/);
  assert.match(program.judgeReason, /053\.3/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.doesNotMatch(program.judgeReason, /依赖：.*host\.testTrigger/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257 尚未/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-042-166 Shen, Scourge of Shadows: 'When I hold' is a Hold Effect on the closed hold timing point", () => {
  // 383.4.d / 383.4.d.1 / 383.4.d.2.a: a unit's Hold Effect enters the chain after
  // the unit is present at a Battlefield when its controller maintains control
  // and gains a point during the Beginning phase.
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "hold");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
  // The EVENT_PATTERN_TYPES discriminant for that timing point is "held"
  // (pipeline-match maps held -> hold); the inner anchor keeps the printed "I".
  assert.deepEqual(ability.trigger.filter, {
    event: "held",
    filter: { source: "self" }
  });
});

test("ven-042-166 Shen, Scourge of Shadows: the exactly-one-other-unit-here gate is a trigger condition", () => {
  // 383.2.a.1: the "if …" clause immediately follows the trigger condition, so it
  // belongs to the Trigger Condition (the CR's Sona example has this shape).
  const { condition } = ability.trigger;
  assert.equal(condition.kind, "all");
  assert.equal(condition.conditions.length, 1);
  const [count] = condition.conditions;
  assert.equal(count.kind, "compare");
  assert.equal(count.operator, "eq");
  assert.deepEqual(count.right, { kind: "constant", value: 1 });
  assert.equal(count.left.kind, "count");
  assert.equal(count.left.subject, "other-friendly-units-here");
  // "here" is the contract 3.6 sameLocationAs anchor; "other" excludes the host
  // and "you control" pins the controller (143.1 / 143.1.b, 053.3).
  assert.deepEqual(count.left.filter, {
    type: "unit",
    zone: "board",
    controller: "controller",
    sameLocationAs: "self",
    exclude: "self"
  });
});

test("ven-042-166 Shen, Scourge of Shadows: the body draws exactly one card for the controller", () => {
  // 414.1 / 414.3 / 190.6.d: the implicit "you" is the ability's controller;
  // omitting player/target/pick is what selects ctx.controller.
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "shen-scourge-of-shadows.draw-one"
  ]);
  assert.equal(draw.op, "effect.draw");
  assert.deepEqual(draw.args.amount, { kind: "constant", value: 1 });
  assert.equal(draw.args.player, undefined);
  assert.equal(draw.args.target, undefined);
  assert.equal(draw.args.pick, undefined);
  assert.equal(draw.targets, undefined);
  assert.equal(draw.linkedTo, undefined);
});

test("ven-042-166 Shen, Scourge of Shadows: the event filter keeps the printed 'I hold' identity", () => {
  // The closed EventPattern matches the hold timing point through its "held"
  // discriminant; a Hold that involves another unit of the same controller does
  // not by itself satisfy the printed identity anchor.
  const pattern = ability.trigger.filter;
  const held = {
    kind: "held",
    timingPoint: "hold",
    player: "A",
    details: { battlefieldId: "bf-1" }
  };
  assert.equal(matchesTriggerEvent(pattern, held, "A"), true);
  assert.equal(matchesTriggerEvent(pattern, { ...held, timingPoint: "conquer", kind: "conquered" }, "A"), false);
});

test("ven-042-166 Shen, Scourge of Shadows golden: exactly one other friendly unit here draws one card", () => {
  const kernel = shenWorld("here");
  // The card's own instruction and args, resolved through the production chain
  // adapter (the merged convention for effect.draw).
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["shen-scourge-of-shadows.draw-one", "executed"]
  ]);
  assert.deepEqual(outcome.events.map(event => event.action), ["draw"]);
  assert.equal(kernel.getObject("drawn-card").zone, "hand");
});

test("ven-042-166 Shen, Scourge of Shadows golden: the printed count gate counts only other friendly units here", () => {
  // The gate is evaluated against the real board through the merged count/
  // sameLocationAs/exclude anchors, so the printed "exactly one" case is a real
  // check rather than a hard-coded expectation.
  const evaluate = (kernel) => {
    const body = [
      {
        id: "gate",
        op: "condition.predicate",
        args: { condition: { kind: "constant", value: ability.trigger.condition } }
      }
    ];
    const outcome = resolveChainBody(body, kernel);
    // Linked values are qualified by the execution path (interpreter contract).
    return outcome.linkedValues["gate.gate.value"] ?? outcome.linkedValues["gate.value"];
  };
  assert.equal(evaluate(shenWorld("here")), true);
  assert.equal(evaluate(shenWorld("none")), false);
  assert.equal(evaluate(shenWorld("second")), false);
  assert.equal(evaluate(shenWorld("elsewhere")), false);
});

test("ven-042-166 Shen, Scourge of Shadows gap: the translated 'I hold' filter rejects the real hold payload", () => {
  // programs/filters.ts resolves the inner source: "self" anchor into
  // pattern.object = { objectId }; turn/flow.ts emits hold with only
  // player + details.battlefieldId. The identity anchor therefore never matches.
  const pattern = translateTriggerFilter(ability.trigger.filter, "shen-instance", "hold");
  const holdEvent = {
    kind: "held",
    timingPoint: "hold",
    player: "A",
    details: { battlefieldId: "bf-1" }
  };
  assert.deepEqual(pattern, { event: "held", object: { objectId: "shen-instance" } });
  assert.equal(matchesTriggerEvent(pattern, holdEvent, "A"), false);
  assert.equal(
    matchesTriggerEvent(pattern, { ...holdEvent, object: { ref: { id: "shen-instance", zoneEntryId: 1 } } }, "A"),
    true
  );
});

test("ven-042-166 Shen, Scourge of Shadows gap: the trigger condition needs a bound relative controller", () => {
  // pipeline.ts's evaluateTriggerCondition queries through host.context(...).query.
  // The game-side host compares placeholders by value, so controller:
  // "controller" never matches and the count is 0; chain/engine.ts binds it.
  const base = world()
    .unit("shen", { owner: "A", controller: "A", location: BATTLEFIELD })
    .unit("ally", { owner: "A", controller: "A", location: BATTLEFIELD })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("shen"), controller: "A" });
  const environment = {
    context: kernel,
    query: filter => kernel.query(filter),
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  };
  assert.equal(evaluateCondition(ability.trigger.condition, environment), false);

  const bound = {
    ...environment,
    query: filter => kernel.query(filter.controller === "controller" ? { ...filter, controller: "A" } : filter)
  };
  assert.equal(evaluateCondition(ability.trigger.condition, bound), true);
});
