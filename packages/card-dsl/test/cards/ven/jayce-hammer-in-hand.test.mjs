import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/jayce-hammer-in-hand.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { ChainContractBlockedError } from "../../../../engine-core/dist/chain/engine.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import assault from "../../../../engine-core/dist/effects/keywords/Assault.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import ganking from "../../../../engine-core/dist/effects/keywords/Ganking.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL =
  "card.hash-cb3b4ba5c7faf7ff8048c29675e218c4b9fa878972899ec9a88ecfb730c74cf2";
const SOURCE_TEXT =
  "When I become ready, choose one to give me this turn \u2014\n" +
  "[Assault 2] (+2 :rb_might: while I'm an attacker.)" +
  "[Deflect 2] (Opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or ability.)" +
  "[Ganking] (I can move from battlefield to battlefield.)";

const [ability] = program.abilities;
const [modeChoice] = ability.body;
const modes = modeChoice.args.modes.value;
const [assault2, deflect2, gankingMode] = modes;

test("ven-088-166 Jayce, Hammer in Hand: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-088-166 Jayce: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /object-readied/);
  // Merged capabilities must no longer be cited as gaps (RIFT-89/90/91/120/257/258/87).
  assert.ok(!/RIFT-(89|90|91|120|257|258|87)/.test(program.judgeReason),
    "the reason names only current gaps: " + program.judgeReason);
  // Real gap 1: the chain adapter rejects mode choices at Finalize.
  assert.match(program.judgeReason, /choice\.mode|Finalize\/Resolve choice-plan/);
  // Real gap 2: keyword consumers (Deflect tax pipeline is work in progress).
  assert.match(program.judgeReason, /RIFT-360/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-088-166 Jayce: 'When I become ready' is a self-scoped object-readied trigger (416.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-readied");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-readied",
    filter: { source: "self" }
  });
  // 印文没有 “you may”：触发是强制的；模式选择属 355.3 的常规选择。
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
});

test("ven-088-166 Jayce: 'choose one' is a frozen choice.mode with three keyword-grant modes (355.3, 3.9)", () => {
  assert.equal(modeChoice.id, "jayce-hammer-in-hand.choose-one");
  assert.equal(modeChoice.op, "choice.mode");
  assert.deepEqual(modeChoice.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(modeChoice.args.different, { kind: "constant", value: true });
  assert.deepEqual(modes.map((entry) => entry.id), ["assault-2", "deflect-2", "ganking"]);
});

test("ven-088-166 Jayce: each mode grants exactly its printed keyword for this turn", () => {
  const grants = modes.map((entry) => entry.body[0]);
  assert.deepEqual(grants.map((instruction) => instruction.op), [
    "continuous.grant-keyword",
    "continuous.grant-keyword",
    "continuous.grant-keyword"
  ]);
  // 807.1.b / 809.1.b.2：Assault 与 Deflect 带印刷数值；810：Ganking 无数值。
  assert.deepEqual(grants.map((instruction) => instruction.args.keyword.value), [
    "Assault",
    "Deflect",
    "Ganking"
  ]);
  assert.deepEqual(grants.map((instruction) => instruction.args.value?.value), [2, 2, undefined]);
  // “this turn” 的到期期限（315.4 / 317.2.c 的回合结束清理）。
  for (const grant of grants) {
    assert.deepEqual(grant.args.duration, { kind: "constant", value: "this-turn" });
    // “give me” 是自我指代（355.10.d/g，按特征程序化选中，不是目标选择）：
    // continuous.grant-keyword 只接受 appliesTo:"self" / objects / filter 等形状，
    // 字面 appliesTo:"self" 被解析为能力来源；裸 object 选择器会被指令拒绝。
    assert.deepEqual(grant.args.appliesTo, { kind: "constant", value: "self" });
    assert.equal(grant.args.object, undefined);
    assert.equal(grant.targets, undefined);
    assert.equal(grant.picks, undefined);
  }
  // 关键词 id 必须对齐已注册的 KeywordDef（契约 3.7 / README 第 5 节）。
  assert.equal(keywordDefinitionsById.get("Assault"), assault);
  assert.equal(keywordDefinitionsById.get("Deflect"), deflect);
  assert.equal(keywordDefinitionsById.get("Ganking"), ganking);
  assert.deepEqual(assault2.body[0].args.keyword, { kind: "constant", value: "Assault" });
  assert.deepEqual(deflect2.body[0].args.keyword, { kind: "constant", value: "Deflect" });
  assert.deepEqual(gankingMode.body[0].args.keyword, { kind: "constant", value: "Ganking" });
});

test("ven-088-166 Jayce golden: the merged grant primitive registers the ability layer and layers expose Assault 2", () => {
  // The primitive is registered and executable; the IR now uses the accepted
  // appliesTo:"self" selector shape (see the structural test above).
  assert.equal(typeof instructionDefinitionsById.get("continuous.grant-keyword")?.execute, "function");
  const base = world().unit("hammer", { zone: "board", might: 5 }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("hammer") });

  const outcome = runAbilityBody([assault2.body[0]], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1, "exactly one ability-layer continuous effect");
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.deepEqual(layers.evaluate(base.ref("hammer")).keywords, [
    { id: "Assault", value: 2 }
  ]);
});

function probeProgram(abilities) {
  return { ...program, status: "executable", judgeReason: undefined, abilities };
}

test("ven-088-166 probe: the ready trigger enters the chain, then mode choice stops at the Finalize adapter", () => {
  const binding = createProgramBinding({ cardPrograms: [probeProgram([ability])] });
  const errors = [];
  const requests = [];
  const f = fixture({
    cards: [{ id: "hammer", cardId: CANONICAL, types: ["unit"], energy: 4, might: 5 }],
    describePlay: binding.describePlay,
    choose: request => {
      requests.push(request);
      return true;
    }
  });
  binding.attachLifecycle(f.engine, error => errors.push(error));

  // Playing the unit registers the trigger (board entry); 416.1 does not ready
  // it, so the printed trigger needs the explicit ready event.
  f.engine.commit({ type: "play", object: f.kernel.ref("hammer"), player: "A" });
  f.engine.advance();
  resolveAll(f.engine);
  f.engine.commit({ type: "ready", object: f.kernel.ref("hammer"), player: "A" });

  assert.deepEqual(errors, [], "the object-readied trigger binds without errors");
  const pending = f.engine.trace.filter(
    event => event.step === "pending" && String(event.item).startsWith("trigger:")
  );
  assert.equal(pending.length, 1, "the ready trigger enters the chain");

  // Real gap 1: the chain adapter cannot finalize mode choices yet.
  assert.throws(() => f.engine.advance(), error =>
    error instanceof ChainContractBlockedError &&
    /Mode choices require a Finalize\/Resolve choice-plan adapter/.test(error.message));

  // The failed advance is atomic: the trigger stays pending instead of being
  // consumed, no mode request leaks to the client, and nothing is granted.
  assert.ok(
    (f.engine.items ?? []).some(item => item.id === "trigger:1" && item.status === "pending"),
    "the trigger stays pending after the rolled-back advance"
  );
  assert.deepEqual(requests, []);
  assert.deepEqual(f.kernel.getObject("hammer").keywords, []);
});

test.todo(
  "ven-088-166 Jayce: the granted keywords cannot take effect until their consumers exist — Assault's " +
    "combat bonus needs the 807.1.d.1 attacker designation, Ganking needs the 810.1.c battlefield movement " +
    "consumer, and Deflect's target-tax pipeline is in progress (RIFT-360)"
);
