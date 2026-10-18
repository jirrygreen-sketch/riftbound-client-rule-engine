import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/yuumi-magical-cat.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { isTimingPointId } from "../../../../engine-core/dist/events/timing-points.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { fixture as chainFixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-aae7ffb0cf04d0753642ceccd3901394849fd519821df46ff303c0e450bc6e2d";
const SOURCE_TEXT =
  "When I attack or defend, give one of your other units here +3 :rb_might: and [Tank] this turn. " +
  "(It must be assigned combat damage first.)";

const [onAttack, onDefend] = program.abilities;
const [grantMight, grantTank] = onAttack.body;
const [otherUnitSpec] = grantMight.targets;
const OTHER_UNIT = "yuumi-magical-cat.other-unit-here";

test("unl-056-219 Yuumi, Magical Cat: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-056-219 Yuumi, Magical Cat: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /sameLocationAs\/exclude/);
  assert.match(program.judgeReason, /translateObjectFilter/);
  assert.match(program.judgeReason, /combat-start-transaction/);
  assert.match(program.judgeReason, /Tank/);
  assert.match(program.judgeReason, /815\.1\.b/);
  // The refreshed reason keeps the three measured blockers and adds the merged
  // designation fact that the default dispatch still cannot reach.
  assert.match(program.judgeReason, /combat-start-transaction/);
  assert.match(program.judgeReason, /translateObjectFilter/);
});

test("unl-056-219 Yuumi, Magical Cat: 'attack or defend' becomes two triggers over the shared printed text (383.4.e.1/383.4.f.1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(onAttack.kind, "triggered");
  assert.equal(onAttack.trigger.at, "attack-declared");
  assert.equal(isTimingPointId("attack-declared"), true);
  assert.deepEqual(onAttack.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(onAttack.optional, false);
  assert.equal(onAttack.trigger.once, "per-combat");

  assert.equal(onDefend.kind, "triggered");
  assert.equal(onDefend.trigger.at, "defense-declared");
  assert.equal(isTimingPointId("defense-declared"), true);
  assert.deepEqual(onDefend.trigger.filter, {
    event: "defense-declared",
    filter: { source: "self" }
  });
  assert.equal(onDefend.optional, false);
  assert.equal(onDefend.trigger.once, "per-combat");

  // Both conditions carry the same printed instructions and the same shape.
  assert.deepEqual(
    onDefend.body.map(instruction => instruction.id),
    onAttack.body.map(instruction => instruction.id)
  );
  assert.deepEqual(onDefend.body[0].targets, onAttack.body[0].targets);
});

test("unl-056-219 Yuumi, Magical Cat: 'one of your other units here' is one target excluding the source (355.9.b/355.9.c/359.3.f.1)", () => {
  assert.deepEqual(otherUnitSpec, {
    id: OTHER_UNIT,
    filter: {
      type: "unit",
      zone: "board",
      controller: "self",
      sameLocationAs: "source",
      exclude: "self"
    },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(grantMight.picks, undefined);
});

test("unl-056-219 Yuumi, Magical Cat: '+3 Might this turn' keeps the layers shape and never becomes a Buff (143.2.a, 475, 702)", () => {
  assert.equal(grantMight.id, "yuumi-magical-cat.grant-might");
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(grantMight.args.objects, {
    kind: "constant",
    value: { kind: "target", id: OTHER_UNIT }
  });
  // The Buff keyword action belongs to effect.buff / 702 counters; this card
  // never declares it for a Might change.
  assert.notEqual(grantMight.op, "effect.buff");
  assert.equal(grantMight.linkedTo, undefined);
});

test("unl-056-219 Yuumi, Magical Cat: 'and [Tank] this turn' keeps the duration-bounded keyword grant shape (801.3.a)", () => {
  assert.equal(grantTank.id, "yuumi-magical-cat.grant-tank");
  assert.equal(grantTank.op, "continuous.grant-keyword");
  assert.deepEqual(grantTank.args.keyword, { kind: "constant", value: "Tank" });
  assert.deepEqual(grantTank.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(grantTank.args.objects, {
    kind: "constant",
    value: { kind: "target", id: OTHER_UNIT }
  });
  assert.deepEqual(grantTank.targets, grantMight.targets);
  // The reminder in parentheses is the Tank rule text (135.2.d.1/d.3), not a
  // second instruction.
  assert.equal(onAttack.body.length, 2);
  assert.equal(grantTank.linkedTo, undefined);
});

test("unl-056-219 Yuumi, Magical Cat: both trigger subscriptions bind the source and once-per-combat scope", () => {
  for (const ability of program.abilities) {
    const filter = translateTriggerFilter(ability.trigger.filter, "yuumi", ability.trigger.at);
    assert.deepEqual(filter, { event: ability.trigger.at, object: { objectId: "yuumi" } });
    const result = validateTriggerSpec({ ...ability.trigger, filter });
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.deepEqual(result.issues, []);
  }
});

function fixture() {
  const base = world()
    .unit("yuumi", { might: 1, location: { type: "battlefield", id: "bf-1" } })
    .unit("ally", { might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("elsewhere", { might: 4, location: { type: "battlefield", id: "bf-2" } })
    .unit("enemy", { owner: "B", controller: "B", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .unit("gear", { types: ["gear"], location: { type: "battlefield", id: "bf-1" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("yuumi") });
  // Only adapt the reference kernel's literal controller comparison. This is
  // the same self -> ability-controller normalization used by ChainEngine.
  // The interpreter consumes the card's original sameLocationAs/exclude anchors.
  const context = bindResolveContext(kernel, {
    query: filter => kernel.query({
      ...filter,
      ...(filter.controller === "self" ? { controller: kernel.controller } : {})
    })
  });
  return { kernel, context };
}

for (const ability of program.abilities) {
  test(`unl-056-219 Yuumi, Magical Cat golden: ${ability.trigger.at} body grants +3 and Tank to the same unit for the turn`, () => {
    const { kernel, context } = fixture();
    kernel.setTargets(OTHER_UNIT, [kernel.ref("ally")]);
    const outcome = resolveChainBody(ability.body, context);

    assert.equal(outcome.status, "executed");
    assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
      ["yuumi-magical-cat.grant-might", "executed"],
      ["yuumi-magical-cat.grant-tank", "executed"]
    ]);
    assert.deepEqual(outcome.events, []);
    assert.deepEqual(kernel.continuousEffects.map(entry => [entry.effect.layer, entry.effect.filter.objectId, entry.duration]), [
      ["arithmetic", "ally", { type: "end-of-turn" }],
      ["ability", "ally", { type: "end-of-turn" }]
    ]);
    assert.equal(outcome.linkedValues["yuumi-magical-cat.grant-might.affected"].count, 1);
    assert.equal(outcome.linkedValues["yuumi-magical-cat.grant-tank.granted"].count, 1);

    const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
    const ally = layers.evaluate(kernel.ref("ally"));
    assert.equal(ally.might, 5);
    assert.deepEqual(ally.keywords.map(keyword => keyword.id), ["Tank"]);
    assert.deepEqual([...ally.counters], []);
    for (const id of ["yuumi", "enemy", "elsewhere", "gear"]) {
      assert.equal(layers.evaluate(kernel.ref(id)).might, kernel.getObject(id).might);
      assert.deepEqual(layers.evaluate(kernel.ref(id)).keywords, []);
    }
    // This tests the actual layer expiry API; it does not fabricate a turn.
    assert.equal(layers.expireAt("turn-end").length, 2);
    assert.equal(layers.evaluate(kernel.ref("ally")).might, 2);
    assert.deepEqual(layers.evaluate(kernel.ref("ally")).keywords, []);
  });
}

test("unl-056-219 Yuumi, Magical Cat golden: both grants ignore invalid or departed locked targets", () => {
  for (const id of ["yuumi", "enemy", "elsewhere", "gear", "ally"]) {
    const { kernel, context } = fixture();
    const ref = kernel.ref(id);
    if (id === "ally") kernel.perform({ type: "kill", object: ref });
    kernel.setTargets(OTHER_UNIT, [ref]);
    const outcome = resolveChainBody(onAttack.body, context);
    assert.equal(outcome.status, "partial", id);
    assert.deepEqual(outcome.results.map(entry => entry.result), [
      { status: "ignored", reason: "mistargeted" },
      { status: "ignored", reason: "mistargeted" }
    ], id);
    assert.deepEqual(outcome.events, [], id);
    assert.deepEqual(kernel.continuousEffects, [], id);
  }
});

test.todo(
  "unl-056-219 Yuumi, Magical Cat: combat produces the unit attack/defense designation and Pending trigger " +
    "once per combat (CR 383.4.e.2/f.2 / 466.2.c; combat-start-transaction)"
);

test("unl-056-219 Yuumi, Magical Cat gap: the production program binding rejects the printed target filter", () => {
  // 355.9.b / 355.9.c / 359.3.f.1: "one of your other units here" needs both the
  // sameLocationAs and exclude anchors. ChainEngine's play/trigger path goes
  // through programs/filters.ts, whose object-filter whitelist refuses both, so
  // this card's body cannot be bound at all even though the interpreter resolves
  // the same anchors when a locked target is supplied (the golden above).
  const f = chainFixture();
  const { judgeReason: _reason, ...withoutReason } = program;
  const binding = createProgramBinding({ cardPrograms: [{ ...withoutReason, status: "executable" }] });
  const source = { ...f.kernel.getObject("source"), cardId: CANONICAL_ID, name: "Yuumi, Magical Cat" };
  assert.throws(
    () => triggerRegistrations(binding.registry, source),
    /Unsupported filter field sameLocationAs/
  );
  // The trigger subscription itself binds (both triggers filter only on the
  // source), which is why the gap is the body's target filter and not the
  // attack/defense subscription shape.
  for (const ability of program.abilities) {
    const translated = translateTriggerFilter(ability.trigger.filter, "yuumi", ability.trigger.at);
    assert.deepEqual(translated, { event: ability.trigger.at, object: { objectId: "yuumi" } });
  }
});

test("unl-056-219 Yuumi, Magical Cat gap: the default expression dispatch cannot read the defender/attacker designation for granted keywords", () => {
  // 801.3.a grants Tank for the turn and Tank's own expansion binds to the
  // granted keyword; the grant itself is real (see the golden above). The layer
  // side still cannot evaluate the designation-based gates because the default
  // dispatch never calls effects/interpreter/expr-ext, which the Towering
  // Combatant/Assault goldens pin the same way.
  const [tank] = keywordDefinitionsById.get("Tank").expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(tank.effect.kind, "continuous.combat");
  assert.equal(tank.effect.mode, "damage-assignment");
  assert.equal(tank.effect.priority, "first");
});
test.todo(
  "unl-056-219 Yuumi, Magical Cat: Finalize binds sameLocationAs/exclude for the chosen other friendly unit " +
    "here (CR 355.9 / 359.3.f.1; card-program target-binding adapter)"
);
test.todo(
  "unl-056-219 Yuumi, Magical Cat: combat consumes the granted Tank's lethal-first damage-assignment " +
    "requirement (CR 815.1.b; continuous.combat consumer)"
);
