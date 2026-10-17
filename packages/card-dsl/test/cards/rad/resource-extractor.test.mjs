import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/resource-extractor.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import tokenDefinition from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-15ed917fed0055c9ae8325c668e501db603af32e4ff58c00dca6ad354739ac93";
const SOURCE_TEXT =
  "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
  "At the end of your turn, if you control this battlefield, play a Gold gear token exhausted. " +
  "(It has \"[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.\")";

const [deploy, turnEndTrigger] = program.abilities;
const [tokenInstruction] = turnEndTrigger.body;
const [selfSpec] = tokenInstruction.targets;

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
  assert.match(program.judgeReason, /invalid-event-type|here:true/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
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
  assert.equal(turnEndTrigger.body.length, 1);
  // 187.5: Gold is the token definition the printed reminder quotes verbatim;
  // the card must name it rather than a plain gear token (no invention).
  assert.equal(tokenInstruction.id, "resource-extractor.play-gold-token");
  assert.equal(tokenInstruction.op, "effect.token");
  assert.deepEqual(tokenInstruction.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(tokenInstruction.args.amount, { kind: "constant", value: 1 });
  // 350.2 / 440.2.c / 185.2.a: "play" means Chain creation followed by the
  // chain's play flow (not a silent board creation).
  assert.deepEqual(tokenInstruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(tokenInstruction.args.target, {
    kind: "constant",
    value: "resource-extractor.self-battlefield"
  });
  assert.deepEqual(tokenInstruction.args.linkKey, { kind: "constant", value: "goldToken" });
  // The printed "exhausted" entry override is fail-closed: no such argument is
  // passed, because effect.token documents that entry overrides are unsupported
  // (143.4 / 185.2.d) and a guess would misreport the entry state.
  assert.equal(tokenInstruction.args.entersExhausted, undefined);
  assert.equal(tokenInstruction.args.location, undefined);

  // The destination is the source object's own Location (this battlefield, 053.3).
  assert.equal(selfSpec.id, "resource-extractor.self-battlefield");
  assert.deepEqual(selfSpec.filter, { source: "self" });
  assert.equal(selfSpec.selection, "one");
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
  scoped.setTargets("resource-extractor.self-battlefield", [kernel.ref("source-gear")]);

  const run = runInstruction(tokenDefinition, tokenInstruction.args, {
    world: scoped,
    targets: { "resource-extractor.self-battlefield": [kernel.ref("source-gear")] }
  });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.goldToken.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(run.linked.goldToken.amount, 0);
  assert.equal(run.world.objects.filter(object => object.isToken).length, 0);
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
  "rad-052-167 Resource Extractor: the merged Deploy KeywordDef (RIFT-267) still needs its " +
    "continuous.location / cleanup-consumer wiring; the merged CardProgram -> TriggerRegistration " +
    "adapter cannot bind Deploy's here:true hold filter or the turn-end EventPattern until the " +
    "location filter and event vocabulary are supported, and the 'you control this battlefield' " +
    "condition needs an evaluated battlefield-control predicate."
);
