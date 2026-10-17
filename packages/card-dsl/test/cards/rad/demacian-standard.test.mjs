import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/demacian-standard.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /RIFT-357/);
  assert.match(program.judgeReason, /RIFT-358/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /Deploy/);
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

test.todo(
  "rad-156-167 Demacian Standard: 攻击触发里“one of them”的选择（触发条件收集该处攻击者后由控制者选一）" +
    "依赖触发选择与模式/目标 Finalize 落地（RIFT-358）"
);
test.todo(
  "rad-156-167 Demacian Standard: [Deploy] 的 KeywordDef 已合入（keywords/Deploy.ts，RIFT-267，830.1.b），" +
    "缺地点限制、清理豁免与 Hold 的 here 消费方（RIFT-357）"
);
test.todo(
  "rad-156-167 Demacian Standard: hold / attack-declared 触发端到端订阅（315.2.b.2 / 471.2 / 473.2.b / 466.2.c）：" +
    "hold 已由 turn/flow.ts 随 Score 波发出，但 here 锚点不在 EventPattern 词表（RIFT-357）"
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
