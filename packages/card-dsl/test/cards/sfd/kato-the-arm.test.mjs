import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/kato-the-arm.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-5c42b9538a43758dced9b213312dffeb6ebdd4fa21de3590ccf10cb802f80cd0";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "When I move to a battlefield, give a friendly unit my keywords and +:rb_might: equal to my Might this turn.";

const [deflectKeyword, moveAbility] = program.abilities;
const [grantKeywords, grantMight] = moveAbility.body;
const [unitSpec] = grantKeywords.targets;

test("sfd-112-221 Kato the Arm: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-112-221 Kato the Arm: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-112-221 Kato the Arm: judgeReason names the current gaps", () => {
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /KeywordGrantLayerEngine/);
  assert.match(program.judgeReason, /两段体/);
  assert.match(program.judgeReason, /registerTrigger/);
  assert.match(program.judgeReason, /invalid-event-type/);
  assert.match(program.judgeReason, /KeywordGrantLayerEngine/);
  assert.match(program.judgeReason, /target Finalize/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-112-221 Kato the Arm: [Deflect] is declared without a value (809.1.b.3)", () => {
  assert.deepEqual(deflectKeyword, { kind: "keyword", keyword: "deflect" });
  assert.equal(deflectKeyword.value, undefined);
  // The registered KeywordDef expands to the merged target.tax static effect;
  // its production consumer is still pending.
  const definition = keywordDefinitionsById.get("Deflect");
  assert.equal(definition, deflect);
  const expansion = definition.expand({ host: { canonicalCardId: CARD_ID } });
  assert.deepEqual(expansion, [
    { kind: "static", effect: { kind: "target.tax", value: { kind: "constant", value: 1 } } }
  ]);
});

test("sfd-112-221 Kato the Arm: 'When I move to a battlefield' subscribes to object-moved", () => {
  // 421.1 / 449.1 / 449.2: a Move changes Board locations; 458/458.1 keep Recall
  // out. The battlefield destination is the toZone payload match, matching the
  // merged sfd/ribbon-dancer and sfd/corinna-veraza programs.
  assert.equal(moveAbility.kind, "triggered");
  assert.equal(moveAbility.trigger.at, "object-moved");
  assert.deepEqual(moveAbility.trigger.filter, {
    event: "object-moved",
    toZone: "battlefield",
    filter: { source: "self" }
  });
  assert.equal(moveAbility.trigger.condition, undefined);
  assert.equal(moveAbility.trigger.once, undefined);
  assert.equal(moveAbility.optional, false);
});

test("sfd-112-221 Kato the Arm: one friendly-unit target serves both printed clauses", () => {
  // The English sentence names "a friendly unit" once and gives it two results,
  // so a single TargetSpec locks the choice and the second instruction reuses
  // that same spec id instead of making a second choice (355.5, 355.7).
  assert.equal(moveAbility.body.length, 2);
  assert.deepEqual(moveAbility.body.map(instruction => instruction.id), [
    "kato-the-arm.grant-keywords",
    "kato-the-arm.grant-might"
  ]);
  assert.deepEqual(unitSpec, {
    id: "kato-the-arm.friendly-unit",
    filter: { type: "unit", zone: "board", controller: "controller" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(grantMight.targets, undefined);
  assert.equal(grantMight.linkedTo, "kato-the-arm.grant-keywords");
});

test("sfd-112-221 Kato the Arm: 'my keywords' is read from the source, not restated", () => {
  // 364.2 / 756-757.1: the granted set is whatever keywords the source has; the
  // program must not enumerate them (that would freeze a moment-in-time list).
  assert.equal(grantKeywords.op, "continuous.grant-keyword");
  // The grant reuses the one locked "a friendly unit" TargetSpec; without the
  // target argument the primitive would fall back to the source itself.
  assert.deepEqual(grantKeywords.args.target, {
    kind: "constant",
    value: "kato-the-arm.friendly-unit"
  });
  assert.deepEqual(grantKeywords.args.keywords, {
    kind: "object-property",
    object: "source",
    property: "keywords"
  });
  assert.deepEqual(grantKeywords.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(grantKeywords.picks, undefined);
  assert.equal(grantKeywords.linkedTo, undefined);
});

test("sfd-112-221 Kato the Arm: the Might grant reads the source's Might at resolution (143.2.a)", () => {
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.target, {
    kind: "constant",
    value: "kato-the-arm.friendly-unit"
  });
  assert.deepEqual(grantMight.args.amount, {
    kind: "object-property",
    object: "source",
    property: "might"
  });
  assert.deepEqual(grantMight.args.mode, { kind: "constant", value: "add" });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "this-turn" });
});

/**
 * Production query path, reproduced for the reference kernel: the binding
 * translates the card's `controller: "controller"` spelling to "self"
 * (programs/filters.ts normalizePlayer), then chain/engine.ts normalizes "self"
 * to the item's controller and matches through layers/filter.ts.
 */
function chainQueryContext(kernel) {
  return bindResolveContext(kernel, {
    query: (filter) => {
      const normalized = { ...filter };
      for (const key of ["controller", "owner"]) {
        if (normalized[key] === "controller" || normalized[key] === "self") normalized[key] = kernel.controller;
      }
      return kernel.objects.filter((object) => {
        for (const key of ["controller", "owner"]) {
          if (normalized[key] === "opponent" && object[key] === kernel.controller) return false;
        }
        return matchesObjectFilter({
          ...normalized,
          ...(normalized.controller === "opponent" ? { controller: "any" } : {})
        }, object);
      });
    }
  });
}

test("sfd-112-221 Kato the Arm golden: both grants execute and read the source's live values", () => {
  // 143.2.a / 478: the Might amount reads the source's effective Might at
  // resolution; "my keywords" grants exactly the keywords the source has
  // (364.2 / 756-757.1 — never a frozen list). Both halves run through the real
  // interpreter and register ability/arithmetic layer effects with the printed
  // this-turn lifetime (317.1.a / 468.7.c).
  const kernel = world()
    .player("A", { energy: 20 })
    .unit("kato", {
      cardId: CARD_ID,
      types: ["unit"],
      keywords: [{ id: "Deflect" }, { id: "Assault", value: 2 }],
      might: 3,
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("ally", {
      might: 2,
      keywords: [{ id: "Reaction" }],
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  const context = kernel.clone({ source: kernel.ref("kato"), sourceSnapshot: kernel.getObject("kato"), controller: "A" });
  context.setTargets("kato-the-arm.friendly-unit", [context.ref("ally")]);

  const outcome = runAbilityBody(moveAbility.body, chainQueryContext(context));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["kato-the-arm.grant-keywords", "executed"],
    ["kato-the-arm.grant-might", "executed"]
  ]);
  // 317.1.a / 468.7.c: every registered half carries the printed this-turn
  // lifetime (the grant plus one arithmetic companion per valued keyword).
  assert.ok(context.continuousEffects.length >= 2);
  assert.ok(context.continuousEffects.every((entry) => entry.duration.type === "end-of-turn"));

  const layers = createLayerEngine(
    context.objects,
    context.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  const ally = layers.evaluate(context.ref("ally"));
  // "my keywords" is exactly the source's set, and the +Might equals its Might.
  assert.deepEqual(ally.keywords.map((keyword) => [keyword.id, keyword.value]), [
    ["Reaction", undefined],
    ["Deflect", undefined],
    ["Assault", 2]
  ]);
  assert.equal(ally.might, 5);
  assert.equal(layers.evaluate(context.ref("kato")).might, 3);
});

test("sfd-112-221 Kato the Arm golden: a source with different Might/keywords changes both results", () => {
  for (const [sourceMight, expectedMight] of [[3, 5], [5, 7], [1, 3]]) {
    const kernel = world()
      .player("A", { energy: 20 })
      .unit("kato", { cardId: CARD_ID, types: ["unit"], keywords: [{ id: "Deflect" }], might: sourceMight })
      .unit("ally", { might: 2, keywords: [{ id: "Reaction" }] })
      .build();
    const context = kernel.clone({ source: kernel.ref("kato"), sourceSnapshot: kernel.getObject("kato"), controller: "A" });
    context.setTargets("kato-the-arm.friendly-unit", [context.ref("ally")]);
    const outcome = runAbilityBody(moveAbility.body, chainQueryContext(context));
    assert.equal(outcome.status, "executed");
    const layers = createLayerEngine(
      context.objects,
      context.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
    );
    assert.equal(layers.evaluate(context.ref("ally")).might, expectedMight, "source Might " + sourceMight);
    assert.deepEqual(layers.evaluate(context.ref("ally")).keywords.map((keyword) => keyword.id), ["Reaction", "Deflect"]);
  }
});

test.todo(
  "sfd-112-221 Kato the Arm: the object-moved trigger must register and deliver to the chain — " +
    "events/trigger-spec.ts EVENT_PATTERN_TYPES has no \"object-moved\" entry so assertTriggerSpec rejects the card's " +
    "subscription with invalid-event-type; the event must also carry toKind/toZone and expose the moved object (421.1, 449.1/449.2)"
);

test.todo(
  "sfd-112-221 Kato the Arm: [Deflect]'s target.tax expansion (809.1.c/809.1.d) must append the Power tax " +
    "when an opponent's spell or ability chooses this unit through the production binder and target Finalize"
);
