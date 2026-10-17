// Execution evidence for this card lives in ../templates/keyword-static-671.test.mjs (README 4.1); this
// card stays judge-required for the gaps asserted below.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/tianna-crownguard.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import restrict from "../../../../engine-core/dist/effects/instructions/continuous.restrict.js";
import { restrictions } from "../../../../engine-core/dist/layers/rules/query.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-d4d3c7fbd236daf76867733cea0af3151a9d91e178cb072e3bbb88c4391fef22";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "While I'm at a battlefield, opponents can't score points.";

const [deflectAbility, restriction] = program.abilities;

test("sfd-060-221 Tianna Crownguard: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-060-221 Tianna Crownguard: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /470/);
  assert.match(program.judgeReason, /restrictions\(\)/);
  assert.match(program.judgeReason, /at a battlefield/);
  assert.match(program.judgeReason, /ObjectSnapshot/);
  assert.match(program.judgeReason, /任意域 Power/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-060-221 Tianna Crownguard: [Deflect] keyword plus a conditionally active anti-score restriction", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(deflectAbility, { kind: "keyword", keyword: "deflect" });

  assert.equal(restriction.kind, "static");
  assert.equal(restriction.effect.kind, "continuous.restrict");
  // 470/470.1: this forbids the Scoring process (471.1/471.2), it does not undo
  // points already gained and is not a damage/prevention effect.
  assert.equal(restriction.effect.operation, "score");
  assert.equal(restriction.effect.forbidden, true);
  assert.equal(restriction.effect.appliesTo, "opponents");
  // 363.2.a: the continuous effect applies only while its condition holds —
  // "While I'm at a battlefield".
  assert.equal(restriction.condition.kind, "expression");
  assert.deepEqual(restriction.condition.value, {
    kind: "object-property",
    object: "self",
    property: "at-battlefield"
  });
});

test("sfd-060-221 Tianna Crownguard: the Deflect keyword definition is merged and stacks by sum (809.2)", () => {
  assert.equal(deflect.keyword, "Deflect");
  assert.equal(deflect.stacking, "sum");
  const [tax] = deflect.expand({ value: undefined, host: { canonicalCardId: CARD_ID } });
  assert.equal(tax.kind, "static");
  assert.equal(tax.effect.kind, "target.tax");
  // 809.1.b.3: the omitted Deflect value is presumed 1.
  assert.deepEqual(tax.effect.value, { kind: "constant", value: 1 });
});

test("sfd-060-221 Tianna Crownguard: the merged continuous.restrict primitive really registers the prohibition", () => {
  // The merged primitive writes the restriction into the layer registry;
  // production scoring still needs to consume that registry entry.
  const kernel = world().unit("tianna", { might: 4 }).build();
  const run = runInstruction(restrict, {
    mode: { kind: "constant", value: "prohibit" },
    action: { kind: "constant", value: "score" },
    appliesTo: { kind: "constant", value: { type: "unit" } }
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.deepEqual(kernel.continuousEffects[0].effect.effect, {
    kind: "restriction",
    actions: ["score"]
  });
});

test("sfd-060-221 Tianna Crownguard: the query side reads the registered prohibition, but the scoring flow never asks", () => {
  // restrictions() 能返回 score 禁止项（查询侧已存在）；缺口是没有任何生产方调用它。
  const registry = new ContinuousEffectRegistry();
  registry.register({
    id: "tianna:restrict",
    layer: "ability",
    source: { id: "tianna", zoneEntryId: 1 },
    filter: { type: "unit" },
    effect: { kind: "restriction", actions: ["score"] }
  }, { type: "permanent" });
  assert.deepEqual(restrictions(registry, "score").map((entry) => entry.actions), [["score"]]);
  assert.deepEqual(restrictions(registry, "move"), []);
});

test.todo(
  "sfd-060-221 Tianna Crownguard: 'opponents can't score points' needs a scoring-side consumer of the registered " +
    "restrictions and the 363.2.a 'at-battlefield' condition predicate from ObjectSnapshot."
);

test.todo(
  "sfd-060-221 Tianna Crownguard: [Deflect]'s target tax must be collected when an opponent chooses this unit " +
    "and paid as any-domain Power (809.1.c.1) instead of the Energy-shaped tax the chain builds today."
);
