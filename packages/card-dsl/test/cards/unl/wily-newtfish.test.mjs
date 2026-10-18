// Golden test for Wily Newtfish (unl-108-219).
//
// Execution evidence (a real XP gain through the merged chain, the no-XP and
// opponent-XP boundaries and the host-only Might/keyword grants) lives in the
// RIFT-675 parameterized template golden:
// test/cards/templates/static-static-675.test.mjs.
// Existing per-card behavior and structure assertions are retained here;
// the template suite supplies additional execution evidence.
// Additional pending scenario rows live in
// test/cards/templates/static-static-651.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/wily-newtfish.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-55487ff54a21b4f984b21e9ef2babc80760bd74a2128eac7bd6665ff81432f9e";
const SOURCE_TEXT =
  "If you've gained XP this turn, I have +1 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)";

const [mightAbility, gankingAbility] = program.abilities;

test("unl-108-219 Wily Newtfish: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-108-219 Wily Newtfish: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /364\.3/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /144\.4\.c/);
});

test("unl-108-219 Wily Newtfish: the conditional passive ability keeps its XP-of-this-turn gate shape", () => {
  assert.equal(program.abilities.length, 2);
  // 364.3: the whole card text is one conditional passive ability; the two
  // granted pieces are modelled as one static ability each.
  assert.equal(mightAbility.kind, "static");
  for (const ability of program.abilities) {
    assert.equal(ability.condition.kind, "compare");
    assert.equal(ability.condition.operator, "gte");
    assert.deepEqual(ability.condition.right, { kind: "constant", value: 1 });
    assert.equal(ability.condition.left.kind, "count");
    assert.equal(ability.condition.left.subject, "controller-xp-gained-this-turn");
    assert.deepEqual(ability.condition.left.filter, { player: "controller" });
  }
});

test("unl-108-219 Wily Newtfish: the first half is +1 Might for the host, never a Buff counter", () => {
  // 143.2.a: an undurationed Might change is an arithmetic-layer continuous
  // effect; 702 Buffs are counters and are not used here.
  assert.equal(mightAbility.effect.kind, "continuous.might");
  assert.equal(mightAbility.effect.mode, "add");
  assert.equal(mightAbility.effect.layer, "arithmetic");
  assert.deepEqual(mightAbility.effect.amount, { kind: "constant", value: 1 });
  assert.deepEqual(mightAbility.effect.filter, { object: "self" });
});

test("unl-108-219 Wily Newtfish: the second half grants [Ganking] to the host", () => {
  // 810.1 / 810.1.b: Ganking adds the Battlefield→Battlefield Standard Move
  // permission; the card only declares the grant (contract 3.7).
  assert.equal(gankingAbility.effect.kind, "continuous.grant-keyword");
  assert.equal(gankingAbility.effect.keyword, "Ganking");
  assert.deepEqual(gankingAbility.effect.filter, { object: "self" });
});

test("unl-108-219 Wily Newtfish: the merged keyword registry knows Ganking", async () => {
  const { keywordDefinitionsById } = await import(
    "../../../../engine-core/dist/effects/keywords/registry.generated.js"
  );
  assert.equal(keywordDefinitionsById.has("Ganking"), true);
});

/**
 * Bind the card's two static abilities through the real production binder and
 * return the live layer registry plus the kernel. The published program stays
 * judge-required; the probe only swaps the metadata status, exactly as the
 * scenario harness does, so every ability, filter and condition stays the card's
 * own text.
 */
function productionStaticBinding() {
  const ID = program.canonicalCardId;
  const view = { ...program, status: "executable", judgeReason: undefined };
  const f = fixture({ cards: [{ id: "newtfish", cardId: ID, types: ["unit"], might: 4 }] });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("newtfish"),
    to: "battlefield",
    location: { type: "battlefield", id: "bf-1" },
  });
  f.engine.advance();
  const source = f.kernel.getObject("newtfish");
  const binding = createProgramBinding({ cardPrograms: [view] });
  const binder = createEngineStaticBinder(f.engine);
  for (const ability of binding.inspect(source).abilities) {
    if (ability.kind === "static") binder.bindStatic(ability, source);
  }
  return { f, source };
}

test("unl-108-219 Wily Newtfish gap: the production binder grants the bonus at 0 XP", () => {
  // 364.3's gate must not be true with no XP gained this turn. Measured through
  // the real static binder: condition.left is a `count` over a live set query,
  // and filter: { player: "controller" } is not read, so the descriptive subject
  // falls back to the host itself and the print is granted.
  const { f, source } = productionStaticBinding();
  assert.equal(f.kernel.player("A").xp, 0);
  const evaluated = f.engine.layers.evaluate(source.ref);
  assert.equal(evaluated.printed.might, 4);
  assert.equal(evaluated.might, 5, "the +1 is granted with 0 XP (measured gap, 364.3)");
  assert.deepEqual(evaluated.keywords.map(keyword => keyword.id), ["Ganking"]);
  // The declared condition is compiled to a per-object predicate; both entries
  // really evaluate to true today, which is exactly the missing turn-history
  // consumer rather than a structure problem.
  for (const entry of f.engine.layers.registry.list()) {
    assert.equal(typeof entry.effect.effect.condition, "function");
    assert.equal(entry.effect.effect.condition(source), true);
    assert.equal(entry.effect.filter.objectId, source.ref.id);
  }
});

test("unl-108-219 Wily Newtfish gap: a granted Ganking keyword does not become a movement permission", () => {
  // 810.1.c / 144.4.c: the granted keyword must add the Battlefield->Battlefield
  // Standard Move option. Measured: the layer snapshot carries Ganking, but the
  // rule query only consumes continuous.movement permission.routes, so canGank
  // stays false and the Standard Move readiness has no production evaluator.
  const { f, source } = productionStaticBinding();
  const evaluated = f.engine.layers.evaluate(source.ref);
  assert.deepEqual(evaluated.keywords.map(keyword => keyword.id), ["Ganking"]);
  assert.equal(evaluated.movement.canGank, false);
  const queried = movement(f.engine.layers.registry, source.ref, source, source.controller);
  assert.equal(queried.canGank, false, "the granted keyword is not read as a movement permission");
  assert.equal(queried.battlefieldToBattlefield, false);
  assert.deepEqual(queried.permissions, []);
});

test("unl-108-219 Wily Newtfish golden: the declared +1 Might really applies to the host alone", () => {
  // The merged continuous.might resolves the declared { object: "self" } selector
  // (interpreter selectors: queryObjects consumes object anchors) and the
  // arithmetic layer applies +1 Might to the host only.
  const base = world()
    .unit("newtfish", { owner: "A", controller: "A", might: 4 })
    .unit("ally", { owner: "A", controller: "A", might: 2 })
    .unit("enemy", { owner: "B", controller: "B", might: 2 })
    .build();
  const kernel = bindResolveContext(base, { source: base.getObject("newtfish"), controller: "A" });
  const outcome = runAbilityBody([
    {
      id: "newtfish.plus-1",
      op: "continuous.might",
      args: {
        amount: mightAbility.effect.amount,
        mode: { kind: "constant", value: mightAbility.effect.mode },
        // The declared filter is static IR metadata, so it travels in a constant
        // expression envelope; the primitive validates it after evaluation.
        filter: { kind: "constant", value: mightAbility.effect.filter }
      }
    },
    {
      id: "newtfish.grant-ganking",
      op: "continuous.grant-keyword",
      args: {
        keyword: { kind: "constant", value: gankingAbility.effect.keyword },
        filter: { kind: "constant", value: gankingAbility.effect.filter }
      }
    }
  ], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.linkedValues["newtfish.plus-1.affected.objects"], [base.ref("newtfish")]);
  assert.deepEqual(outcome.linkedValues["newtfish.grant-ganking.granted.objects"], [base.ref("newtfish")]);
  assert.equal(base.continuousEffects.length, 2);

  const layers = createLayerEngine(base.objects, base.continuousEffects);
  assert.equal(layers.evaluate(base.ref("newtfish")).might, 5);
  assert.equal(layers.evaluate(base.ref("ally")).might, 2);
  assert.equal(layers.evaluate(base.ref("enemy")).might, 2);
  assert.deepEqual(layers.evaluate(base.ref("newtfish")).keywords.map(keyword => keyword.id), ["Ganking"]);
  assert.deepEqual(layers.evaluate(base.ref("ally")).keywords, []);
  assert.deepEqual(layers.evaluate(base.ref("enemy")).keywords, []);
});

test.todo(
  "unl-108-219 Wily Newtfish: the movement system must consume the granted [Ganking] permission " +
    "(810.1.c / 144.4.c) — layers/rules/query.ts#movement reads only continuous.movement's permission.routes, " +
    "not a granted Ganking keyword (measured: canGank stays false while the layered host carries Ganking), and " +
    "the Standard Move has no production assembly for its trusted Ganking evaluator / DuelMovementRuleContext " +
    "(moveDuelUnitsWithMetadata has no caller outside tests)"
);

test.todo(
  "unl-108-219 Wily Newtfish: evaluate 'you've gained XP this turn' (364.3 / 730.1) for a static ability — " +
    "the merged Condition algebra has no history node, the interpreter's count runs a live set query that ignores " +
    "filter.player, and nothing consumes controller-xp-gained-this-turn turn history"
);
test.todo(
  "unl-108-219 Wily Newtfish: make the production static binder honour the XP gate — " +
    "programs/statics.ts and attachProgramLifecycle compile the declared Condition into a per-object predicate, " +
    "but the count half counts the host itself at 0 XP, so the effect activates unconditionally (measured)"
);
