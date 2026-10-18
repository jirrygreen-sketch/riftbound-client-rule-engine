// Golden test for Master Yi, Tempered (unl-113-219).
//
// Execution evidence (the real printed 4 Energy payment, the registered
// [Level 6] grants with their unresolved XP gate, the fail-closed Hunt trigger
// registration and the blocked printed expectations) lives in the RIFT-673
// parameterized template golden:
// test/cards/templates/keyword-static-static-673.test.mjs.
// Original behavior and structure assertions remain in this file; the
// template adds execution evidence without replacing these checks.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/master-yi-tempered.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";

const CANONICAL_ID =
  "card.hash-c32a0493f88b4c947cb3f7806d8ba125b166dd6478a848bb39f1da87aed3ae92";
const SOURCE_TEXT =
  "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
  "[Level 6][>] I have [Deflect] and [Ganking]. (While you have 6+ XP, opponents must pay :rb_rune_rainbow: to choose me with a spell or ability and I can move from battlefield to battlefield.)";

const [hunt, deflectGrant, gankingGrant] = program.abilities;

test("unl-113-219 Master Yi, Tempered: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-113-219 Master Yi, Tempered: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /823\.1\.c\.1/);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /Deflect/);
  assert.match(program.judgeReason, /Ganking/);
  // The merged keyword definitions are named as such; the remaining gaps are
  // the trigger spelling/object payload, the XP predicate and the target-tax
  // consumer.
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /controller-xp/);
  // The authored Level gate is explicitly blocked; the engine still has no
  // player XP evaluator or layer mapping for Level's own predicate. Granted
  // Ganking shape does not satisfy the movement query.
  assert.match(program.judgeReason, /TriggerSpecValidationError/);
  assert.match(program.judgeReason, /condition\.predicate/);
  assert.match(program.judgeReason, /permission\.routes/);
  assert.match(program.judgeReason, /KeywordGrantLayerEngine/);
  assert.doesNotMatch(program.judgeReason, /未识别条件按 true/);
});

test("unl-113-219 Master Yi, Tempered: [Hunt 2] carries its printed Hunt Value", () => {
  assert.equal(program.abilities.length, 3);
  // 823.1.c.3: X is the Hunt Value; this printing prints 2.
  assert.deepEqual(hunt, { kind: "keyword", keyword: "hunt", value: 2 });
});

test("unl-113-219 Master Yi, Tempered: [Level 6][>] gates both grants on 6 or more XP", () => {
  for (const ability of [deflectGrant, gankingGrant]) {
    assert.equal(ability.kind, "static");
    assert.equal(ability.condition.kind, "all");
    assert.deepEqual(ability.condition.conditions[0], { kind: "never" });
    const pending = ability.condition.conditions[1];
    assert.equal(pending.kind, "compare");
    assert.equal(pending.operator, "gte");
    assert.deepEqual(pending.right, { kind: "constant", value: 6 });
    // 824.1.c / 824.1.c.1 / 824.1.d: the gate is the controller's XP and must
    // re-evaluate as it changes; the shape is retained, not evaluated.
    assert.equal(pending.left.kind, "count");
    assert.equal(pending.left.subject, "controller-xp");
    assert.deepEqual(pending.left.filter, { player: "controller" });
  }
});

test("unl-113-219 Master Yi, Tempered: Deflect is granted with the presumed value 1 (809.1.b.3)", () => {
  assert.equal(deflectGrant.effect.kind, "continuous.grant-keyword");
  assert.equal(deflectGrant.effect.keyword, "Deflect");
  assert.deepEqual(deflectGrant.effect.value, { kind: "constant", value: 1 });
  assert.deepEqual(deflectGrant.effect.filter, { object: "self" });
});

test("unl-113-219 Master Yi, Tempered: Ganking is granted to the host", () => {
  assert.equal(gankingGrant.effect.kind, "continuous.grant-keyword");
  assert.equal(gankingGrant.effect.keyword, "Ganking");
  assert.equal(gankingGrant.effect.value, undefined);
  assert.deepEqual(gankingGrant.effect.filter, { object: "self" });
});

test("unl-113-219 Master Yi, Tempered: the merged keyword registry now provides Hunt and Level", async () => {
  const { keywordDefinitionsById } = await import(
    "../../../../engine-core/dist/effects/keywords/registry.generated.js"
  );
  // RIFT-265 and RIFT-268 merged these definitions, so the card's remaining
  // gaps are the subscription spelling/object payload and the unevaluated XP
  // predicate, not the missing KeywordDefs.
  assert.equal(keywordDefinitionsById.has("Hunt"), true);
  assert.equal(keywordDefinitionsById.has("Level"), true);
  assert.equal(keywordDefinitionsById.has("Deflect"), true);
  assert.equal(keywordDefinitionsById.has("Ganking"), true);
});

test("unl-113-219 Master Yi, Tempered: Hunt 2 expands to the conquer/hold XP triggers (823.1.c.1)", async () => {
  const { default: hunt } = await import("../../../../engine-core/dist/effects/keywords/Hunt.js");
  const expansion = hunt.expand({ value: hunt.value ?? program.abilities[0].value, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.length, 2);
  assert.deepEqual(expansion.map(ability => ability.trigger.at), ["conquer", "hold"]);
  assert.deepEqual(expansion.map(ability => ability.body[0].op), ["effect.xp", "effect.xp"]);
  // 823.2: the printed Hunt Value 2 flows through the keyword's own expansion,
  // so the card does not restate the XP gain.
  assert.deepEqual(expansion.map(ability => ability.body[0].args.amount), [
    { kind: "constant", value: 2 },
    { kind: "constant", value: 2 }
  ]);
});

test("unl-113-219 Master Yi, Tempered golden: either Hunt body really credits 2 XP to its controller", async () => {
  const { default: huntDefinition } = await import("../../../../engine-core/dist/effects/keywords/Hunt.js");
  for (const ability of huntDefinition.expand({ value: hunt.value, host: { canonicalCardId: CANONICAL_ID } })) {
    const kernel = world()
      .player("A", { xp: 1 })
      .player("B", { xp: 4 })
      .unit("yi", { owner: "A", controller: "B", might: 4 })
      .build();
    const context = kernel.clone({ sourceSnapshot: kernel.getObject("yi"), controller: "B" });
    const result = resolveChainBody(ability.body, context);
    assert.equal(result.status, "executed");
    assert.equal(result.results[0].result.linkedValues.gained, 2);
    assert.equal(result.results[0].result.linkedValues.gainedTo, "B");
    assert.equal(context.player("A").xp, 1);
    assert.equal(context.player("B").xp, 6);
    assert.deepEqual(context.events.map(event => event.action), ["gain-xp"]);
  }
});

test("unl-113-219 Master Yi, Tempered golden: the opt-in adapter expands the Ganking grant into movement rules", () => {
  // Exercise only the supported grant primitive and adapter. The original
  // Level condition remains blocked; this does not install the Level ability.
  const kernel = world().unit("yi", { might: 4, location: { type: "battlefield", id: "bf-1" } }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("yi") });
  const result = resolveChainBody([{
    id: "yi.ganking-grant-primitive", op: gankingGrant.effect.kind,
    args: {
      keyword: { kind: "constant", value: gankingGrant.effect.keyword },
      appliesTo: { kind: "constant", value: "self" }
    }
  }], context);
  assert.equal(result.status, "executed");
  const layers = new KeywordGrantLayerEngine(context.objects, {
    context: source => context.clone({ sourceSnapshot: source, controller: source.controller })
  });
  for (const entry of context.continuousEffects) layers.addContinuous(entry.effect, entry.duration);
  const current = layers.evaluate(context.ref("yi"));
  assert.deepEqual(current.keywords, [{ id: "Ganking" }]);
  assert.equal(current.movement.canGank, true);
  const rules = movement(layers.registry, current.ref, current, "A");
  assert.equal(rules.canGank, true);
  assert.equal(rules.battlefieldToBattlefield, true);
  assert.deepEqual(layers.keywordAbilities(current.ref).map(ability => ability.effect.permission), ["battlefield-to-battlefield"]);
});

test("unl-113-219 Master Yi, Tempered: the Level expansion publishes the 6+ XP predicate for the layers pipeline", async () => {
  const { default: level } = await import("../../../../engine-core/dist/effects/keywords/Level.js");
  const [predicate] = level.expand({ value: 6, host: { canonicalCardId: CANONICAL_ID } });
  // 824.1.a / 824.1.b.1: [Level 6][>] publishes the threshold predicate that
  // makes the dependent ability text Active while the controller has 6+ XP.
  assert.equal(predicate.kind, "static");
  assert.equal(predicate.effect.kind, "condition.predicate");
  assert.deepEqual(predicate.effect.threshold, { kind: "constant", value: 6 });
  assert.equal(predicate.effect.operator, "gte");
  assert.equal(predicate.effect.controller, "controller");
  assert.equal(predicate.effect.link, "active");
});

test("unl-113-219 Master Yi, Tempered: the card's own grants are registered as static declarations", () => {
  // The two static abilities are the card's [Level 6][>] grants. They are
  // authored per contract 3.7; installing them into layers is the recorded gap.
  assert.deepEqual(program.abilities.filter(ability => ability.kind === "static").map(ability => [
    ability.effect.kind,
    ability.effect.keyword,
    ability.condition.conditions[1].right.value
  ]), [
    ["continuous.grant-keyword", "Deflect", 6],
    ["continuous.grant-keyword", "Ganking", 6]
  ]);
});

test("unl-113-219 Master Yi, Tempered: the Deflect expansion is a target tax the merged target plan can bill", async () => {
  // 809.1.c / 809.1.d: the granted Deflect is a mandatory additional Power cost
  // for each time an opponent chooses this unit. The KeywordDef exists and the
  // target plan charges the tax it declares, but nothing registers the card's
  // Level-gated grant (see judgeReason).
  const { default: deflectDefinition } = await import(
    "../../../../engine-core/dist/effects/keywords/Deflect.js"
  );
  const [expansion] = deflectDefinition.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "target.tax");
  // 809.1.b.3: the omitted Deflect Value is presumed 1.
  assert.deepEqual(expansion.effect.value, { kind: "constant", value: 1 });
});

test.todo(
  "unl-113-219 Master Yi, Tempered: subscribe Hunt's conquer/hold expansion to the emitted conquered/held events and bind the conquering unit object (CR 823.1.c.1/823.2; current event spellings and score payload do not match)"
);
test.todo(
  "unl-113-219 Master Yi, Tempered: derive Deflect's target tax from the active granted keyword and let the movement workflow consume Ganking's layered permission (CR 809.1.c/810.1.c; target-tax and movement consumers remain open)"
);

test("unl-113-219 Master Yi, Tempered: Hunt's conquer/hold spelling is rejected by the closed event vocabulary (CR 823.1.c.1)", async () => {
  const { default: hunt } = await import("../../../../engine-core/dist/effects/keywords/Hunt.js");
  const [conquer] = hunt.expand({ value: 2, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(conquer.trigger.at, "conquer");
  assert.throws(
    () => assertTriggerSpec({
      at: conquer.trigger.at,
      filter: { event: "conquer", filter: { source: "self" } }
    }),
    (error) => error.name === "TriggerSpecValidationError" &&
      error.issues.some((issue) => issue.code === "invalid-event-type")
  );
  // The check is specifically on the event spelling inside the filter: the
  // closed event vocabulary accepts "conquered", so the same registration shape
  // passes once the word is past-tense.
  assert.doesNotThrow(() => assertTriggerSpec({
    at: "conquer",
    filter: { event: "conquered", object: { type: "unit" } }
  }));
});

test("unl-113-219 Master Yi, Tempered: the unresolved [Level 6][>] query stays blocked rather than counting objects as XP (CR 824.1.c.1/824.1.d)", () => {
  // The old count expression read objects, granting Level at zero XP. The
  // authored never guard blocks that unsupported read until player XP is wired.
  for (const xp of [0, 5, 6, 10]) {
    const f = fixture({
      cards: [{ id: "yi", cardId: CANONICAL_ID, types: ["unit"], energy: 4, power: ["Body"], might: 4 }]
    });
    f.kernel.addPlayer("A", { xp });
    f.engine.commit({
      type: "move-zone",
      object: f.kernel.ref("yi"),
      to: "board",
      location: { type: "battlefield", id: "bf-1" }
    });
    const source = f.kernel.getObject("yi");
    const binder = createEngineStaticBinder(f.engine);
    const deflect = binder.bindStatic(program.abilities[1], source);
    const ganking = binder.bindStatic(program.abilities[2], source);
    assert.equal(f.kernel.player("A").xp, xp);
    assert.deepEqual(
      f.engine.layers.evaluate(source.ref).keywords.map((keyword) => keyword.id),
      [],
      `XP ${xp}: unresolved player query must remain explicitly blocked`
    );
    ganking.unbind();
    deflect.unbind();
  }
});

test("unl-113-219 Master Yi, Tempered: Level's own predicate and Deflect's target tax have no layer mapping (CR 824.1.b / 809.1.c)", async () => {
  const { default: level } = await import("../../../../engine-core/dist/effects/keywords/Level.js");
  const { default: deflect } = await import("../../../../engine-core/dist/effects/keywords/Deflect.js");
  const f = fixture({
    cards: [{ id: "yi", cardId: CANONICAL_ID, types: ["unit"], energy: 4, power: ["Body"], might: 4 }]
  });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("yi"),
    to: "board",
    location: { type: "battlefield", id: "bf-1" }
  });
  const source = f.kernel.getObject("yi");
  const binder = createEngineStaticBinder(f.engine);
  const [predicate] = level.expand({ value: 6, host: { canonicalCardId: CANONICAL_ID } });
  assert.throws(
    () => binder.bindStatic(predicate, source),
    (error) => error.name === "ProgramBindingError" && /no layer mapping/.test(error.message)
  );
  const [tax] = deflect.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(tax.effect.kind, "target.tax");
  assert.throws(
    () => binder.bindStatic(tax, source),
    (error) => error.name === "ProgramBindingError" && /no layer mapping/.test(error.message)
  );
});

test("unl-113-219 Master Yi, Tempered: the granted Ganking registration does not satisfy the movement query (CR 810.1.c)", async () => {
  const { default: ganking } = await import("../../../../engine-core/dist/effects/keywords/Ganking.js");
  const [ability] = ganking.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(ability.effect.permission, "battlefield-to-battlefield");
  const f = fixture({
    cards: [{ id: "yi", cardId: CANONICAL_ID, types: ["unit"], energy: 4, power: ["Body"], might: 4 }]
  });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("yi"),
    to: "board",
    location: { type: "battlefield", id: "bf-1" }
  });
  const source = f.kernel.getObject("yi");
  const handle = createEngineStaticBinder(f.engine).bindStatic(ability, source);
  // The-shaped permission is registered, but the query reads permission.routes
  // and therefore still reports no Ganking route.
  assert.deepEqual(
    f.engine.layers.registry.list().map((entry) => entry.effect.effect.permission),
    ["battlefield-to-battlefield"]
  );
  const view = movement(f.engine.layers.registry, source.ref, f.engine.layers.evaluate(source.ref), "A");
  assert.equal(view.canGank, false);
  assert.equal(view.battlefieldToBattlefield, false);
  handle.unbind();
});
