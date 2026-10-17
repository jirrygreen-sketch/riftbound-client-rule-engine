import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/resource-extractor.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { translateInstructionTargets, translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import deployKeyword from "../../../../engine-core/dist/effects/keywords/Deploy.js";

const CANONICAL = "card.hash-15ed917fed0055c9ae8325c668e501db603af32e4ff58c00dca6ad354739ac93";
const SOURCE_TEXT =
  "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
  "At the end of your turn, if you control this battlefield, play a Gold gear token exhausted. " +
  "(It has \"[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.\")";

const [deploy, turnEndTrigger] = program.abilities;
const [controllerBase, tokenInstruction] = turnEndTrigger.body;

test("rad-052-167 Resource Extractor: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("rad-052-167 Resource Extractor: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-052-167 Resource Extractor: the judgeReason names the actual merged gaps", () => {
  assert.match(program.judgeReason, /Deploy/);
  assert.match(program.judgeReason, /830\.1\.b/);
  assert.match(program.judgeReason, /Gold gear token/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /entry overrides/);
  assert.match(program.judgeReason, /143\.4/);
  assert.match(program.judgeReason, /TriggerRegistration/);
  assert.match(program.judgeReason, /invalid-event-type/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /here:true/);
  assert.match(program.judgeReason, /ability-controller-base/);
  assert.equal(program.judgeReason.includes("RIFT-267"), false);
  // General predicates are merged; battlefield-control querying is still missing.
  assert.match(program.judgeReason, /condition\.result/);
  assert.match(program.judgeReason, /控制状态查询/);
  assert.equal(/RIFT-\d+/.test(program.judgeReason), false);
});

test("rad-052-167 Resource Extractor: [Deploy] plus the turn-end trigger with its printed condition", () => {
  assert.deepEqual(deploy, { kind: "keyword", keyword: "deploy" });

  // 317.1.a: "At the end of your turn" is the turn-end timing point; "your" is
  // the ability controller's turn (190.6.d / 304).
  assert.equal(turnEndTrigger.kind, "triggered");
  assert.equal(turnEndTrigger.trigger.at, "turn-end");
  assert.deepEqual(turnEndTrigger.trigger.filter, { event: "turn-end", player: "self" });
  assert.equal(turnEndTrigger.optional, false);

  // 364.3 / 355.10.c: "if you control this battlefield" is a condition, not a
  // target choice; no merged Condition kind queries battlefield control, so the
  // pending predicate is recorded instead of being assumed true.
  assert.equal(turnEndTrigger.trigger.condition.kind, "expression");
  assert.deepEqual(turnEndTrigger.trigger.condition.value, {
    kind: "constant",
    value: "controller-controls-source-battlefield"
  });
});

test("rad-052-167 Resource Extractor: the body plays a Gold token, never a substitute definition", () => {
  assert.equal(turnEndTrigger.body.length, 2);
  assert.equal(controllerBase.id, "resource-extractor.controller-base");
  assert.equal(controllerBase.op, "condition.value");
  assert.deepEqual(controllerBase.args.value, { kind: "location", value: "ability-controller-base" });
  // 187.5: Gold is the token definition the printed reminder quotes verbatim;
  // the card must name it rather than a plain gear token (no invention).
  assert.equal(tokenInstruction.id, "resource-extractor.play-gold-token");
  assert.equal(tokenInstruction.op, "effect.token");
  assert.deepEqual(tokenInstruction.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(tokenInstruction.args.amount, { kind: "constant", value: 1 });
  // 350.2 / 440.2.c / 185.2.a: "play" means Chain creation followed by the
  // chain's play flow (not a silent board creation).
  assert.deepEqual(tokenInstruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(tokenInstruction.args.location, {
    kind: "linked-value",
    instructionId: controllerBase.id,
    key: "value"
  });
  assert.deepEqual(tokenInstruction.args.linkKey, { kind: "constant", value: "goldToken" });
  // The printed "exhausted" entry override is fail-closed: no such argument is
  // passed, because effect.token documents that entry overrides are unsupported
  // (143.4 / 185.2.d) and a guess would misreport the entry state.
  assert.equal(tokenInstruction.args.entersExhausted, undefined);
  // Ordinary Gear enters its controller's base (359.2.d); the battlefield
  // belongs to the control condition, never to a target selection for Gold.
  assert.equal(tokenInstruction.args.target, undefined);
  assert.equal(tokenInstruction.targets, undefined);
});

test("rad-052-167 Resource Extractor: the Gold definition is blocked in the merged token table", () => {
  // This is why the card is judge-required: the merged effect.token primitive
  // deliberately excludes token definitions with their own abilities (187.5),
  // and reports it instead of creating a wrong object. Executed through the
  // real primitive with the card's own arguments.
  const kernel = world()
    .unit("source-gear", {
      types: ["gear"],
      energy: 1,
      power: null,
      zone: "board",
      location: { type: "battlefield", id: "bf1" }
    })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("source-gear") });
  const outcome = resolveChainBody(turnEndTrigger.body, scoped);
  const result = outcome.results.find(entry => entry.id === tokenInstruction.id).result;
  assert.equal(result.status, "negated");
  assert.equal(result.reason, "impossible");
  const receipt = outcome.linkedValues[`${tokenInstruction.id}.goldToken`];
  assert.equal(receipt.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(receipt.amount, 0);
  assert.equal(scoped.objects.filter(object => object.isToken).length, 0);
});

for (const controller of ["A", "B"]) test(`rad-052-167 Resource Extractor regression: a ${controller}-controlled source computes its controller's base for Gold`, () => {
  const kernel = world().player("A").player("B")
    .unit("extractor", { types: ["gear"], owner: "A", controller,
      location: { type: "battlefield", id: "bf1" } }).build();
  const scoped = kernel.clone({ controller, sourceSnapshot: kernel.getObject("extractor") });
  const outcome = resolveChainBody(turnEndTrigger.body, scoped);
  assert.equal(outcome.results[0].id, controllerBase.id);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.linkedValues[`${controllerBase.id}.value`], { type: "base", player: controller });
  assert.equal(outcome.linkedValues[`${tokenInstruction.id}.goldToken`].blockedReason, "token-definition-or-abilities-judge-required");
  assert.deepEqual(outcome.events, []);
});

test.todo(
  "rad-052-167 Resource Extractor: adding the Gold gear token definition (CR 187.5, with its own " +
    "\"[Reaction][>] Kill this, [E]: [Add] [A]\" ability) to the effect.token definition table."
);

test.todo(
  "rad-052-167 Resource Extractor: the printed 'exhausted' entry override (143.4 / 185.2.d) needs an " +
    "entry-state path on Chain creation/play; a later effect.exhaust is a separate exhaust action and " +
    "is not a substitute."
);

test.todo(
  "rad-052-167 Resource Extractor: the merged Deploy KeywordDef still needs its " +
    "continuous.location / cleanup-consumer wiring; the merged CardProgram -> TriggerRegistration " +
    "adapter cannot bind Deploy's here:true hold filter or the turn-end EventPattern until the " +
    "location filter and event vocabulary are supported, and the 'you control this battlefield' " +
    "condition needs an evaluated battlefield-control predicate."
);

test("rad-052-167 Resource Extractor: the merged Deploy expansion has no consumer for either half", () => {
  // CR 830.1.b: RIFT-267 merged Deploy.ts, but continuous.location is unmapped in
  // programs/statics.ts layerFor and the hold trigger's here:true is rejected by
  // the merged filter translator.
  const expansion = deployKeyword.expand({ host: { canonicalCardId: CANONICAL } });
  assert.deepEqual(expansion.map(ability => ability.kind), ["static", "triggered"]);
  assert.equal(expansion[0].effect.kind, "continuous.location");

  const kernel = world()
    .unit("extractor", {
      types: ["gear"],
      zone: "board",
      location: { type: "battlefield", id: "bf1" }
    })
    .build();
  const source = kernel.getObject("extractor");
  const binder = createEngineStaticBinder({
    layers: { addContinuous() {}, removeContinuous() {}, currentTimingPoint: "cleanup-start" }
  });
  assert.throws(
    () => binder.bindStatic(expansion[0], source),
    (error) => error.code === "judge-required" &&
      /Static ability kind continuous\.location has no layer mapping/.test(error.message)
  );
  assert.throws(
    () => translateTriggerFilter(expansion[1].trigger.filter, source.ref.id, "hold"),
    (error) => error.code === "judge-required" && /Unsupported filter field here/.test(error.message)
  );
});

test("rad-052-167 Resource Extractor: the turn-end trigger and its body cannot reach the chain", () => {
  // CR 317.1.a / 364.3: the timing point exists and turn/flow.ts emits it, but
  // EVENT_PATTERN_TYPES has no "turn-end". The body now resolves a base
  // without the obsolete source:self TargetSpec.
  assert.equal(validateTriggerSpec(turnEndTrigger.trigger).ok, false);
  assert.deepEqual(
    validateTriggerSpec(turnEndTrigger.trigger).issues.map(issue => issue.code),
    ["invalid-event-type"]
  );
  // The translated pattern itself is well-formed; only the vocabulary is missing.
  assert.deepEqual(translateTriggerFilter(turnEndTrigger.trigger.filter, "gear", "turn-end"), {
    event: "turn-end",
    player: "self"
  });
  assert.deepEqual(translateInstructionTargets(turnEndTrigger.body), turnEndTrigger.body);
});
