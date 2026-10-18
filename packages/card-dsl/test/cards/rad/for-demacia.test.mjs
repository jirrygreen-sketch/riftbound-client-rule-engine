// Golden test for For Demacia! (rad-117-167) — layers 1 and 2 of cards/README §4
// (validation/identity and structure).
//
// Execution evidence (the real play through the generic card scenario harness:
// 3 Energy payment, battlefield target, sameLocationAs-scoped friendly set, the
// ability-layer Shield 2 registration and the empty-set boundary) lives in the
// RIFT-681 parameterized template golden:
// test/cards/templates/keyword-play-continuous-grant-keyword-681.test.mjs.

import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/for-demacia.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { expandEffectiveKeywords, KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";

const CANONICAL = "card.hash-88b2b6a8fd884959d1de40824d4d5035cc609570087e598ecc6e808b8b3cc790";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose a battlefield. Give friendly units there [Shield 2] this turn. " +
  "(+2 :rb_might: while they're defenders.)";

const [keyword, play] = program.abilities;
const [grantInstruction] = play.body;

const unit = (id, values = {}) => ({
  ref: { id, zoneEntryId: 1 },
  cardId: "card:" + id,
  name: id,
  types: ["unit"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "board",
  location: { type: "battlefield", id: "bf-1" },
  might: 2,
  energy: null,
  power: null,
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false,
  ...values
});

test("For Demacia! program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("For Demacia! identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /designation/);
  // The merged grant op must no longer be described as unregistered.
  assert.doesNotMatch(program.judgeReason, /该原语未注册/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("For Demacia! structure: [Reaction], printed cost, battlefield target plus Shield 2 grant", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(keyword.value, undefined);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 }
  });
  assert.equal(play.body.length, 1);

  // 814.1.c: "[Shield 2] this turn" is an end-of-turn keyword grant of Shield 2.
  assert.equal(grantInstruction.id, "for-demacia.grant-shield");
  assert.equal(grantInstruction.op, "continuous.grant-keyword");
  assert.deepEqual(grantInstruction.args.keyword, { kind: "constant", value: "Shield" });
  assert.deepEqual(grantInstruction.args.value, { kind: "constant", value: 2 });
  assert.deepEqual(grantInstruction.args.duration, { kind: "constant", value: "end-of-turn" });

  // 170 / 170.7 / 355.10.a.1: the chosen battlefield is a target.
  assert.deepEqual(grantInstruction.targets, [
    {
      id: "for-demacia.battlefield",
      filter: { type: "battlefield" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  // 355.10.d: "friendly units there" is a criteria-based set, not a target. The
  // set is carried by the objects query so the interpreter resolves the "here"
  // anchor at resolution time (053.3), and no unit TargetSpec is declared.
  assert.equal(grantInstruction.targets.length, 1);
  assert.deepEqual(grantInstruction.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: {
        type: "unit",
        controller: "self",
        zone: "board",
        sameLocationAs: { target: "for-demacia.battlefield" }
      }
    }
  });
  assert.equal(grantInstruction.picks, undefined);
});

test("For Demacia! golden: only friendly units at the chosen battlefield receive [Shield 2]", () => {
  const kernel = world()
    .unit("bf", { types: ["battlefield"], location: { type: "battlefield", id: "bf-9" } })
    .unit("allyHere", { location: { type: "battlefield", id: "bf-9" } })
    .unit("allyElsewhere", { location: { type: "battlefield", id: "bf-1" } })
    .unit("foeHere", { owner: "B", controller: "B", might: 5, location: { type: "battlefield", id: "bf-9" } })
    .build();
  // The chain context resolves the selector spelling and the "here" anchor
  // (src/chain/engine.ts overrides query for controller self/opponent and the
  // interpreter resolves sameLocationAs); this stub mirrors that one override.
  const raw = kernel.query.bind(kernel);
  kernel.query = filter => raw({
    ...filter,
    ...(filter.controller === "self" ? { controller: "A" } : {}),
    ...(filter.controller === "opponent" ? { controller: "B" } : {})
  });
  // Finalize locked the printed battlefield target; the card's own instruction
  // then resolves its own set through the interpreter's anchor resolution.
  kernel.setTargets("for-demacia.battlefield", [kernel.ref("bf")]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [["for-demacia.grant-shield", "executed"]]
  );
  // Exactly one object-scoped ability-layer grant, for the friendly unit at the
  // chosen battlefield.
  assert.deepEqual(kernel.snapshot().continuous.map(entry => entry.effect.filter), [
    { objectId: "allyHere", zone: "board", zoneEntryId: 1 }
  ]);
  // The ability-layer payload names the granted keyword and its value; the
  // registration (not the card) decides the remaining bookkeeping fields.
  assert.equal(kernel.snapshot().continuous[0].effect.effect.kind, "continuous.grant-keyword");
  assert.equal(kernel.snapshot().continuous[0].effect.effect.keyword, "Shield");
  assert.equal(kernel.snapshot().continuous[0].effect.effect.keywordValue, 2);
  // CR 317.2.c: "this turn" is the end-of-turn duration.
  assert.deepEqual(kernel.snapshot().continuous.map(entry => entry.duration), [
    { type: "end-of-turn" }
  ]);
});

test("For Demacia! golden: the granted Shield really lands in the ability layer and the printed Might keyword", () => {
  const kernel = world()
    .unit("bf", { types: ["battlefield"], location: { type: "battlefield", id: "bf-9" } })
    .unit("allyHere", { location: { type: "battlefield", id: "bf-9" } })
    .build();
  const raw = kernel.query.bind(kernel);
  kernel.query = filter => raw({
    ...filter,
    ...(filter.controller === "self" ? { controller: "A" } : {})
  });
  kernel.setTargets("for-demacia.battlefield", [kernel.ref("bf")]);
  resolveChainBody(play.body, kernel);

  // The merged layers engine applies the registered ability-layer grant: the
  // unit really gains Shield 2 as a keyword characteristic (814.3).
  const engine = createLayerEngine(
    kernel.query({}),
    kernel.snapshot().continuous.map(entry => ({ effect: entry.effect, duration: entry.duration }))
  );
  assert.deepEqual(
    engine.evaluate(kernel.ref("allyHere")).keywords,
    [{ id: "Shield", value: 2 }]
  );
});

test("For Demacia! golden: the default layer engine ignores the Shield designation condition", () => {
  // Shield's merged expansion (effects/keywords/Shield.ts) is a
  // continuous.might static ability gated on `designation === "defender"`.
  // layers/engine.ts conditionMatches only implements
  // always/never/type/has-tag/has-keyword and returns true for any other
  // condition, so the +2 Might lands for every combat role. This pins the
  // actual current behaviour instead of assuming the gate holds.
  const [shieldMight] = keywordDefinitionsById.get("Shield").expand({
    value: 2,
    host: { canonicalCardId: CANONICAL }
  });
  assert.deepEqual(shieldMight.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "designation" },
    operator: "eq",
    right: { kind: "constant", value: "defender" }
  });

  for (const combatRole of ["defender", "attacker", null]) {
    const shielded = unit("allyHere", { keywords: [{ id: "Shield", value: 2 }], might: 2, combatRole });
    const spec = {
      id: "shield",
      layer: "arithmetic",
      source: shielded.ref,
      filter: { objectId: "allyHere" },
      effect: {
        ...shieldMight.effect,
        amount: shieldMight.effect.amount.value,
        condition: shieldMight.condition
      }
    };
    const engine = createLayerEngine([shielded], [{ effect: spec, duration: { type: "permanent" } }]);
    // The condition is never evaluated, so the +2 lands even without the
    // Defender designation — the reason the card stays judge-required.
    assert.equal(engine.evaluate(shielded.ref).might, 4, "combatRole=" + combatRole);
  }
});

/**
 * The card's own play body, resolved against a real board with the concrete
 * controller substituted for the one relative-player spelling the reference
 * kernel compares literally (the production chain context does this in
 * chain/engine.ts; the fixtures above already rely on the same override).
 */
function grantedShieldBoard(combatRole) {
  const kernel = world()
    .unit("bf", { types: ["battlefield"], location: { type: "battlefield", id: "bf-9" } })
    .unit("allyHere", { might: 2, location: { type: "battlefield", id: "bf-9" }, ...(combatRole === undefined ? {} : { combatRole }) })
    .unit("allyElsewhere", { might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("foeHere", { owner: "B", controller: "B", might: 5, location: { type: "battlefield", id: "bf-9" } })
    .build();
  const raw = kernel.query.bind(kernel);
  kernel.query = filter => raw({
    ...filter,
    ...(filter.controller === "self" ? { controller: "A" } : {}),
    ...(filter.controller === "opponent" ? { controller: "B" } : {})
  });
  kernel.setTargets("for-demacia.battlefield", [kernel.ref("bf")]);
  return kernel;
}

test("For Demacia! re-sweep: the production engine never expands the granted Shield, so the +2 never lands", () => {
  // The grant itself executes on the merged primitive: the keyword reaches the
  // ally's keyword list with its value. But the production LayerEngine performs
  // no KeywordDef expansion, so Shield's functional text (814.1.c) never
  // becomes an arithmetic effect and the Might stays printed.
  const kernel = grantedShieldBoard("defender");
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "executed");

  const entries = kernel.snapshot().continuous.map(entry => ({ effect: entry.effect, duration: entry.duration }));
  assert.equal(entries.length, 1);
  const engine = createLayerEngine(kernel.query({}), entries);
  const ally = engine.evaluate(kernel.ref("allyHere"));
  assert.deepEqual(ally.keywords, [{ id: "Shield", value: 2 }]);
  assert.equal(ally.might, 2);
  // The unit is a defender and still gets nothing back from a fresh evaluation.
  assert.deepEqual(expandEffectiveKeywords(kernel.getObject("allyHere")).abilities, []);
});

test("For Demacia! re-sweep: the merged re-expansion engine honours the defender gate, but is not the production engine", () => {
  // RIFT-710's KeywordGrantLayerEngine expands the granted Shield and evaluates
  // its designation condition against combatRole: a defender gains +2, an
  // attacker and a unit outside combat do not. Production is not wired to that
  // engine (ChainEngine constructs the plain LayerEngine; programs/lifecycle.ts
  // binds statics to it), and combatRole still has no combat producer.
  for (const [combatRole, expected] of [["defender", 2], ["attacker", 0], [null, 0]]) {
    const kernel = grantedShieldBoard(combatRole);
    assert.equal(resolveChainBody(play.body, kernel).status, "executed");
    assert.deepEqual(kernel.snapshot().continuous.map(entry => entry.effect.filter), [
      { objectId: "allyHere", zone: "board", zoneEntryId: 1 }
    ]);

    const context = source => bindResolveContext(kernel, { source, controller: source.controller });
    const layers = new KeywordGrantLayerEngine(kernel.query({}), { context });
    for (const entry of kernel.snapshot().continuous) layers.addContinuous(entry.effect, entry.duration);

    const ally = layers.evaluate(kernel.ref("allyHere"));
    assert.deepEqual(ally.keywords, [{ id: "Shield", value: 2 }]);
    assert.equal(ally.might - 2, expected, "combatRole=" + combatRole);
    // The battlefield by-stander and the opponent never qualify.
    assert.equal(layers.evaluate(kernel.ref("allyElsewhere")).might, 2);
    assert.equal(layers.evaluate(kernel.ref("foeHere")).might, 5);
    assert.deepEqual(layers.evaluate(kernel.ref("foeHere")).keywords, []);
  }
});

test.todo(
  "For Demacia!: the granted [Shield 2] may only add Might while the unit is a defender (CR 814.1.c/814.1.d); " +
    "the merged arithmetic layer ignores the Shield expansion's designation condition, so the effect cannot be " +
    "honoured — the defender designation characteristic and combat designation wiring are still unmerged " +
    "(contract 3.8 combatRole exists but no producer sets it)"
);

test.todo(
  "For Demacia!: resolve the printed play body through the production target/chain path, including locking the " +
    "chosen battlefield before the friendly-unit set is evaluated; current golden coverage invokes the body with " +
    "that battlefield target already locked"
);
