import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/resource-extractor.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { translateInstructionTargets, translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import deployKeyword from "../../../../engine-core/dist/effects/keywords/Deploy.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

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
  assert.match(program.judgeReason, /entersExhausted/);
  assert.match(program.judgeReason, /143\.4/);
  assert.match(program.judgeReason, /invalid-event-type/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /here: true/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /recall-action/);
  assert.match(program.judgeReason, /TriggerRegistration/);
  assert.match(program.judgeReason, /condition\.result/);
  assert.match(program.judgeReason, /ability-controller-base/);
  assert.equal(program.judgeReason.includes("RIFT-267"), false);
  // General predicates are merged; battlefield-control querying is still missing.
  assert.match(program.judgeReason, /condition\.value/);
  assert.match(program.judgeReason, /战场控制状态/);
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

test("rad-052-167 Resource Extractor: the Gold definition creates and plays at the controller's Base", () => {
  // 187.5: Gold is a canonical token whose ability travels through the bound
  // card program. Exercise the card's own arguments through the real chain.
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
  const tokenResult = outcome.results.find(entry => entry.id === tokenInstruction.id).result;
  assert.equal(tokenResult.status, "executed");
  const receipt = outcome.linkedValues[`${tokenInstruction.id}.goldToken`];
  assert.equal(receipt.blockedReason, undefined);
  assert.equal(receipt.amount, 1);
  assert.equal(receipt.createdAmount, 1);
  const result = outcome.results.find(entry => entry.id === tokenInstruction.id).result;
  assert.equal(result.status, "executed");
  const golds = scoped.objects.filter(object => object.isToken);
  assert.equal(golds.length, 1);
  assert.equal(golds[0].name, "Gold");
  assert.deepEqual(golds[0].types, ["gear"]);
  assert.equal(golds[0].zone, "board");
  assert.deepEqual(golds[0].location, { type: "base", player: "A" });
  assert.equal(golds[0].energy, null);
  assert.equal(golds[0].power, null);
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
  const receipt = outcome.linkedValues[`${tokenInstruction.id}.goldToken`];
  assert.equal(receipt.blockedReason, undefined);
  assert.equal(receipt.amount, 1);
  assert.equal(receipt.createdAmount, 1);
  const golds = scoped.objects.filter(object => object.isToken);
  assert.equal(golds.length, 1);
  assert.equal(golds[0].name, "Gold");
  assert.deepEqual(golds[0].types, ["gear"]);
  assert.equal(golds[0].zone, "board");
  assert.deepEqual(golds[0].location, { type: "base", player: controller });
  assert.deepEqual(outcome.events.map(event => [event.action, event.timingPoint]), [
    ["create-token", "chain-item-pending"],
    ["play", "card-played"]
  ]);
});

test.todo(
  "rad-052-167 Resource Extractor: play the authored exhausted Gold token through the production " +
    "turn-end trigger and Chain lifecycle (CR 187.5 / 184.1 / 185.2.d / 440.2.c / 185.2.a)."
);

test.todo(
  "rad-052-167 Resource Extractor: bind the controller-Base value produced in the card body to the " +
    "production chain lifecycle without substituting a fixture destination."
);

test.todo(
  "rad-052-167 Resource Extractor: the merged Deploy KeywordDef still needs its " +
    "continuous.location / cleanup-consumer wiring; the merged CardProgram -> TriggerRegistration " +
    "adapter cannot bind Deploy's here:true hold filter or the turn-end EventPattern until the " +
    "location filter and event vocabulary are supported, and the 'you control this battlefield' " +
    "condition needs an evaluated battlefield-control predicate."
);

test("rad-052-167 Resource Extractor: both halves of the Deploy expansion cross production binding", () => {
  const expansion = deployKeyword.expand({ host: { canonicalCardId: CANONICAL } });
  assert.deepEqual(expansion.map(ability => ability.kind), ["static", "triggered"]);
  assert.equal(expansion[0].effect.kind, "continuous.location");

  const f = fixture({ cards: [{ id: "extractor", cardId: CANONICAL, types: ["gear"], might: null, energy: 1, power: null }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("extractor"), to: "board", location: { type: "battlefield", id: "bf1" } });
  const source = f.kernel.getObject("extractor");
  const handle = createEngineStaticBinder(f.engine).bindStatic(expansion[0], source);
  assert.equal(typeof handle.unbind, "function");
  handle.unbind();
  assert.deepEqual(translateTriggerFilter(expansion[1].trigger.filter, source.ref.id, "hold"), {
    event: "hold",
    here: true,
    player: "opponent"
  });
});

test("rad-052-167 Resource Extractor: the merged cleanup really exempts a Deploy Gear (830.1.b.3 is no longer a gap)", () => {
  // CR 830.1.b.3: a non-Unit Gear with Deploy is not recalled by the Cleanup
  // step. turn/flow.ts keys that exemption off the printed keyword, so this runs
  // the real driver: the Deploy Gear stays put, while an otherwise identical
  // Gear without the keyword still reaches the not-yet-merged Recall action.
  const cleanupFor = keywords => {
    const kernel = world().player("A").player("B")
      .base("source", { might: 4 })
      .base("enemy", { owner: "B", might: 4 })
      .object("gear", {
        types: ["gear"], zone: "board", controller: "A",
        location: { type: "battlefield", id: "bf1" }, keywords, energy: 1, power: []
      })
      .build();
    const host = createActionPipelineHost({
      checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
      restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
      objects: () => kernel.objects,
      perform: action => kernel.perform(action),
      choose: request => { throw new Error(`Unexpected choice: ${request.id}`); },
      context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
    });
    const flow = new TurnFlow({
      host, player: id => kernel.player(id), turnOrder: ["A", "B"],
      battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: null }]
    });
    return { kernel, flow };
  };

  const deployed = cleanupFor([{ id: "Deploy" }]);
  deployed.flow.cleanup(deployed.flow.chain);
  assert.equal(deployed.kernel.getObject("gear").zone, "board");
  assert.deepEqual(deployed.kernel.getObject("gear").location, { type: "battlefield", id: "bf1" });

  const plain = cleanupFor([]);
  assert.throws(
    () => plain.flow.cleanup(plain.flow.chain),
    (error) => error.status === "blocked" && error.code === "recall-action"
  );
});

test("rad-052-167 Resource Extractor: the turn-end trigger validates and translates through production", () => {
  // CR 317.1.a / 364.3: turn-end and its controller predicate are in the
  // closed event vocabulary. The battlefield-control condition remains an
  // explicit judge-required gate rather than being assumed true.
  const validation = validateTriggerSpec(turnEndTrigger.trigger);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.issues, []);
  assert.deepEqual(translateTriggerFilter(turnEndTrigger.trigger.filter, "gear", "turn-end"), {
    event: "turn-end",
    player: "self"
  });
  assert.deepEqual(translateInstructionTargets(turnEndTrigger.body), turnEndTrigger.body);
});
