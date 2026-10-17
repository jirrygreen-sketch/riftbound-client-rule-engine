// Execution evidence for keyword expansion is consolidated in ../templates/keyword-only.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/demacian-standard.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

/** Minimal engine so the production static binder can be exercised directly. */
function binderFor(kernel) {
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: (request) => { throw new Error(`Unexpected choice: ${request.id}`); },
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false
  });
  return createEngineStaticBinder(engine);
}

const CARD_ID = "card.hash-480ea79884e6f85ff72527f8deb9eb55bbcacb01a51c7d33332e8d830f2c20fe";
const SOURCE_TEXT =
  "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
  "When one or more friendly units attack here, give one of them +2 :rb_might: this turn.\n" +
  "When you hold here, you may return this to its owner's hand.";
const BATTLEFIELD = { type: "battlefield", id: "bf-1" };

const standardWorld = () => world()
  .player("B")
  .object("demacian-standard", {
    owner: "B",
    controller: "A",
    types: ["gear"],
    tags: ["Device", "Jarvan IV", "Signature"],
    zone: "board",
    location: BATTLEFIELD
  })
  .build();

test("rad-156-167 Demacian Standard: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-358/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /Deploy/);
  // RIFT-357 (runtime locations) is merged and no longer the blocker: the
  // remaining gaps are the here anchor, the trigger-collected attacker choice,
  // and Deploy's missing continuous.location layer mapping.
  assert.match(program.judgeReason, /Unsupported filter field here/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.doesNotMatch(program.judgeReason, /RIFT-357/);
});

test("rad-156-167 Demacian Standard: Deploy + attack-here might body + hold return body", () => {
  assert.equal(program.abilities.length, 3);
  const [deploy, attack, hold] = program.abilities;
  assert.deepEqual(deploy, { kind: "keyword", keyword: "deploy" });

  // “When one or more friendly units attack here”：attack-declared 时点 + here（323.2 / 466.2.c / 383.4.e）。
  assert.equal(attack.kind, "triggered");
  assert.deepEqual(attack.trigger, {
    at: "attack-declared",
    filter: { event: "attack-declared", here: true, player: "controller" }
  });
  assert.equal(attack.optional, false);
  assert.equal(attack.body.length, 1);
  const [might] = attack.body;
  assert.equal(might.id, "demacian-standard.give-might");
  // “+2 Might this turn” 是临时 Might 修改：属于 continuous.might，不写 Buff（703 是独立机制）。
  assert.equal(might.op, "continuous.might");
  assert.deepEqual(might.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(might.args.duration, { kind: "constant", value: "this-turn" });
  // The merged primitive's symbolic selector form (contract 3.6).
  assert.deepEqual(might.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "demacian-standard.attacking-unit" }
  });
  // “one of them” 从该处攻击者中选一个（候选来自触发条件里的攻击者集合）。
  assert.equal(might.targets.length, 1);
  const [spec] = might.targets;
  assert.equal(spec.id, "demacian-standard.attacking-unit");
  assert.deepEqual(spec.filter, {
    type: "unit",
    controller: "controller",
    sameLocationAs: "source"
  });
  assert.equal(spec.selection, "one");

  // “When you hold here, you may return this to its owner's hand”：hold 时点 + choice.optional（315.2.b.2 / 471.2）。
  assert.equal(hold.kind, "triggered");
  assert.deepEqual(hold.trigger, {
    at: "hold",
    filter: { event: "held", here: true, player: "controller" }
  });
  assert.equal(hold.optional, true);
  assert.equal(hold.body.length, 1);
  const [choice] = hold.body;
  assert.equal(choice.id, "demacian-standard.hold-opt-in");
  assert.equal(choice.op, "choice.optional");
  assert.equal(choice.args.body.kind, "constant");
  const [returnInstruction] = choice.args.body.value;
  assert.equal(returnInstruction.id, "demacian-standard.return");
  // “return this” 用契约 3.6 的符号选择器 "source" 声明本卡自身的引用（picks 声明位）。
  assert.equal(returnInstruction.op, "effect.zone");
  assert.deepEqual(returnInstruction.args.pick, {
    kind: "constant",
    value: "demacian-standard.this"
  });
  assert.deepEqual(returnInstruction.args.to, { kind: "constant", value: "hand" });
  assert.equal(returnInstruction.picks.length, 1);
  assert.equal(returnInstruction.picks[0].id, "demacian-standard.this");
  assert.deepEqual(returnInstruction.picks[0].options, [{ kind: "source" }]);
  assert.equal(returnInstruction.picks[0].max, 1);
});

test("rad-156-167 Demacian Standard: accepting the hold return sends the card to its owner's hand", () => {
  const kernel = standardWorld();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("demacian-standard") });
  scoped.setPicks("demacian-standard.this", [scoped.ref("demacian-standard")]);
  scoped.setAnswers({ "demacian-standard.hold-opt-in/optional": true });
  const outcome = resolveChainBody(program.abilities[2].body, scoped);
  assert.equal(outcome.status, "executed", JSON.stringify(outcome.results));
  assert.deepEqual(outcome.results.map((result) => result.id), [
    "demacian-standard.return",
    "demacian-standard.hold-opt-in"
  ]);
  assert.equal(scoped.getObject("demacian-standard").zone, "hand");
  // “its owner's hand”：owner 是 B，控制者 A 的手牌不受影响。
  assert.equal(scoped.zone("B", "hand").length, 1);
  assert.equal(scoped.zone("A", "hand").length, 0);
  assert.deepEqual(outcome.events.map((event) => event.action), ["return-to-hand"]);
});

test("rad-156-167 Demacian Standard: declining the hold return leaves the card on the battlefield", () => {
  const kernel = standardWorld();
  kernel.setAnswers({ "demacian-standard.hold-opt-in/optional": false });
  const outcome = runAbilityBody(program.abilities[2].body, kernel);
  assert.deepEqual(outcome.results.map((result) => result.id), ["demacian-standard.hold-opt-in"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("demacian-standard").zone, "board");
  assert.deepEqual(kernel.events, []);
});

test("rad-156-167 Demacian Standard: a stale self reference ignores the return instruction", () => {
  const kernel = standardWorld();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("demacian-standard") });
  const stale = scoped.ref("demacian-standard");
  // 本卡先离场（不再是同一个区域身份），随后结算 return 指令。
  scoped.perform({ type: "move-zone", object: stale, to: "trash" });
  scoped.setPicks("demacian-standard.this", [stale]);
  scoped.setAnswers({ "demacian-standard.hold-opt-in/optional": true });
  const outcome = resolveChainBody(program.abilities[2].body, scoped);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.equal(scoped.getObject("demacian-standard").zone, "trash");
  assert.deepEqual(scoped.events.map((event) => event.action), ["move-zone"]);
});

test("rad-156-167 Demacian Standard: both here anchors are still rejected, never rebound to a whole board", () => {
  // 466.2.c / 473.2.b: the attack and hold triggers are both scoped "here". The
  // merged translator has no evaluable battlefield anchor, so it refuses each
  // registration rather than subscribing to every battlefield.
  for (const ability of [program.abilities[1], program.abilities[2]]) {
    assert.throws(
      () => translateTriggerFilter(ability.trigger.filter, "demacian-standard", ability.trigger.at),
      /Unsupported filter field here/
    );
  }
});

test("rad-156-167 Demacian Standard: the Deploy expansion still cannot bind to a layer", () => {
  // 830.1.b: Deploy's KeywordDef expands to a continuous.location static
  // ability. The merged program binder maps no layer for that kind, so the
  // expansion is refused outright instead of silently registering nothing.
  const deploy = keywordDefinitionsById.get("Deploy");
  assert.ok(deploy, "the merged Deploy KeywordDef is present");
  const expanded = deploy.expand({} );
  const locationAbility = expanded.find(ability => ability.kind === "static" && ability.effect.kind === "continuous.location");
  assert.ok(locationAbility, "Deploy expands a continuous.location static ability");

  const kernel = world().unit("demacian-standard", { types: ["gear"], location: BATTLEFIELD }).build();
  const source = kernel.getObject("demacian-standard");
  const binder = binderFor(kernel);
  assert.throws(
    () => binder.bindStatic(locationAbility, source),
    /no layer mapping/
  );
});

test.todo(
  "rad-156-167 Demacian Standard: 攻击触发里“one of them”的选择（触发条件收集该处攻击者后由控制者选一）" +
    "依赖触发选择与模式/目标 Finalize 落地（RIFT-358）"
);

test("rad-156-167 Demacian Standard: +2 Might this turn registers an arithmetic-layer modifier through the real interpreter", () => {
  // 478 / 807-style temporary Might: the merged continuous.might primitive
  // (RIFT-258) registers an arithmetic-layer modification with an end-of-turn
  // duration, and the layers engine applies it to the chosen unit only. The
  // Finalize-locked target is supplied by the kernel (the reference kernel
  // compares filter values literally, so the card's TargetSpec stays asserted
  // structurally above) — the same approach as demacian-illuminators.
  const bodyWithoutTargets = program.abilities[1].body.map(({ targets, ...rest }) => rest);
  const kernel = world()
    .unit("attacker", { might: 3, location: BATTLEFIELD })
    .unit("enemy", { owner: "B", might: 5, location: BATTLEFIELD })
    .build();
  kernel.setTargets("demacian-standard.attacking-unit", [kernel.ref("attacker")]);
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("attacker") });

  const outcome = runAbilityBody(bodyWithoutTargets, scoped);

  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.continuousEffects.length, 1);
  const registration = scoped.continuousEffects[0];
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 2);

  const engine = createLayerEngine(kernel.objects, scoped.continuousEffects.map(entry => ({
    effect: entry.effect, duration: entry.duration, timestamp: 1
  })));
  assert.equal(engine.evaluate(kernel.ref("attacker")).might, 5);
  assert.equal(engine.evaluate(kernel.ref("enemy")).might, 5);
  // 317.2.c: the this-turn modifier expires at the end-of-turn timing.
  engine.expireAt("turn-end", "A");
  assert.equal(engine.evaluate(kernel.ref("attacker")).might, 3);
});

test("rad-156-167 Demacian Standard: a stale attacking-unit target ignores the Might grant", () => {
  const bodyWithoutTargets = program.abilities[1].body.map(({ targets, ...rest }) => rest);
  const kernel = world().unit("attacker", { might: 3, location: BATTLEFIELD }).build();
  const stale = kernel.ref("attacker");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("demacian-standard.attacking-unit", [stale]);
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("attacker") });

  const outcome = runAbilityBody(bodyWithoutTargets, scoped);

  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(scoped.continuousEffects.length, 0);
});
