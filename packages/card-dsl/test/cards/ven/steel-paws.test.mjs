import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/steel-paws.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-d1cb46188e07e26d280977537ff04f5a6daa76c60e4a224b15aa5a8c64b3b1aa";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "[Empower] :rb_energy_7: (:rb_energy_7:: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have +7 :rb_might:.";

const [deflectKeyword, empower, might] = program.abilities;

test("ven-043-166 Steel Paws: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-043-166 Steel Paws: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // 809.1.b.3 leaves the omitted Deflect Value at 1; the card must not invent one.
  assert.deepEqual(deflectKeyword, { kind: "keyword", keyword: "deflect" });
  assert.match(program.judgeReason, /809\.1\.c\.1/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /442\.1\.a/);
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /Unsupported cost kind: empower/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-043-166 Steel Paws: [Deflect] expands to the presumed value 1 target tax", () => {
  // 809.1.b.3 / 809.1.c: the merged KeywordDef presumes 1 and declares the tax;
  // nothing merges permanent tax into target selection yet (judgeReason).
  const [expansion] = deflect.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "target.tax");
  assert.deepEqual(expansion.effect.value, { kind: "constant", value: 1 });
});

test("ven-043-166 Steel Paws: [Empower] 7 and the Empowered +7 Might dependent ability", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 7 });
  assert.equal(might.kind, "static");
  assert.deepEqual(might.effect, {
    kind: "continuous.might",
    mode: "add",
    layer: "arithmetic",
    appliesTo: "self",
    amount: { kind: "constant", value: 7 }
  });
  assert.deepEqual(might.condition, {
    kind: "expression",
    value: { kind: "constant", value: "empowered" }
  });
});

test("ven-043-166 Steel Paws gap: the printed 7 Energy never reaches the Empower expansion", () => {
  // Contract 3.1's KeywordAbility only carries keyword/value, and
  // programs/keywords.ts calls def.expand({ value, host }) without params.cost,
  // so the merged KeywordDef falls back to { kind: "empower" }.
  const kernel = world().unit("steel-paws", { cardId: CANONICAL_ID }).build();
  const expanded = expandProgram(program, kernel.getObject("steel-paws"));
  const [empowerAbility] = expanded.expanded.filter(ability => ability.kind === "activated");
  assert.deepEqual(empowerAbility.cost, { kind: "empower" });
  assert.equal(empowerAbility.restriction.kind, "empower");
  assert.throws(
    () => buildCostPlan(kernel, { id: "steel-paws", cost: empowerAbility.cost }),
    /Unsupported cost kind: empower/
  );
});

test("ven-043-166 Steel Paws gap: the merged static binder refuses the Deflect target tax", () => {
  // programs/statics.ts layerFor() has no target.tax mapping, so no producer
  // derives the tax from the permanent (809.1.c/809.1.d).
  const kernel = world().unit("steel-paws", { cardId: CANONICAL_ID }).build();
  const source = kernel.getObject("steel-paws");
  const [expansion] = deflect.expand({ host: { canonicalCardId: CANONICAL_ID } });
  const binder = createEngineStaticBinder({ layers: createLayerEngine([source]) });
  assert.throws(
    () => binder.bindStatic(expansion, source),
    /Static ability kind target\.tax has no layer mapping/
  );
});

test("ven-043-166 Steel Paws gap: the Empowered gate is not enforced by the layer engine", () => {
  // 442.1.a has no predicate: the engine contract's ObjectSnapshot exposes no
  // empowered characteristic (the reference kernel tracks it out of band), and
  // layers/engine.ts conditionMatches treats the descriptive condition as true,
  // so an un-Empowered Steel Paws still evaluates to Might 7.
  const kernel = world().unit("steel-paws", {
    controller: "controller", might: 0, location: { type: "base", player: "controller" }
  }).build();
  const source = kernel.getObject("steel-paws");
  // The frozen engine contract's ObjectSnapshot carries no empowered field
  // (the reference kernel tracks the count out of band), so a card program
  // cannot read 442.1.a through a Condition / characteristic predicate.
  const engine = createLayerEngine([source], [{
    effect: {
      id: "steel-paws.might",
      layer: "arithmetic",
      source: source.ref,
      filter: { objectId: "steel-paws" },
      effect: { kind: "continuous.might", mode: might.effect.mode, amount: might.effect.amount, condition: might.condition }
    },
    duration: { type: "permanent" },
    timestamp: 1,
    sequence: 1
  }]);
  assert.equal(engine.evaluate(source.ref).might, 7);
});
