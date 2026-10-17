import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/vex-apathetic.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-716820b241f51e2a45c749824d33ddeaa97919c6443d116c499135360b20184c";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "When an opponent plays a unit while I'm at a battlefield, [Stun] it. They can't move it this turn. " +
  "(It doesn't deal combat damage this turn.)";

const [deflectKeyword, opponentPlays] = program.abilities;
const [stunPlayed, forbidMove] = opponentPlays.body;
const stunTarget = stunPlayed.targets[0];

// 参考内核按值比较过滤器（"opponent"/"controller" 是 Finalize 目标管线解析的契约层锚点），
// 因此执行时先由内核锁定目标、再运行同一指令（one-two-punch / facebreaker 同一惯例）。
// 只执行 [Stun] 半段：移动禁止那半段用的 op 尚未注册（见 judgeReason 与下方 TODO）。
const executableStun = { ...stunPlayed };
delete executableStun.targets;

test("unl-150-219 Vex, Apathetic: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-150-219 Vex, Apathetic: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /809\.1\.c/);
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /RIFT-360/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(89|90|91|120|257|259)/);
  assert.match(program.judgeReason, /continuous\.movement/);
});

test("unl-150-219 Vex, Apathetic: [Deflect] is declared and resolves to the merged KeywordDef", () => {
  // 809.1.b.3：省略 X 时视为 Deflect 1，故卡内不写 value，由 KeywordDef 提供默认值。
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(deflectKeyword, { kind: "keyword", keyword: "deflect" });
  assert.equal(deflectKeyword.value, undefined);
  const registered = keywordDefinitionsById.get("Deflect");
  assert.ok(registered, "effects/keywords/Deflect.ts must be in the generated registry");
  assert.equal(deflectKeyword.keyword, registered.keyword.toLowerCase());
  const [expansion] = deflect.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.effect.kind, "target.tax");
  assert.deepEqual(expansion.effect.value, { kind: "constant", value: 1 });
});

test("unl-150-219 Vex, Apathetic: 'when an opponent plays a unit' is a card-played trigger with a battlefield gate", () => {
  assert.equal(opponentPlays.kind, "triggered");
  assert.equal(opponentPlays.optional, false);
  // 420.4.a / 383.4.a.4：“an opponent plays a unit”不是 Play Effect。
  assert.equal(opponentPlays.trigger.at, "card-played");
  assert.deepEqual(opponentPlays.trigger.filter, {
    event: "card-played",
    object: { type: "unit", controller: "opponent" }
  });
  assert.equal(opponentPlays.trigger.once, undefined);
  // 383.2.a.1：“while I'm at a battlefield” 属触发条件，在进链前判定。
  const condition = opponentPlays.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.deepEqual(condition.left.filter, { object: "self", location: "battlefield" });
});

test("unl-150-219 Vex, Apathetic: the stun clause is one instruction on the played unit's referent", () => {
  // 424.1 / 424.1.a.1：Stun 是状态动作；已 Stunned 的单位不会再被 Stun（原语自身覆盖）。
  assert.equal(stunPlayed.id, "vex-apathetic.stun-the-played-unit");
  assert.equal(stunPlayed.op, "effect.stun");
  assert.deepEqual(stunPlayed.args.target, {
    kind: "constant",
    value: "vex-apathetic.played-unit"
  });
  // 355.10.c：“it” 是触发条件引用的对象，不是选目标；此 TargetSpec 只保留指称与过滤维度，
  // 真实绑定必须由触发系统在进链时完成（见 judgeReason）。
  assert.deepEqual(stunTarget, {
    id: "vex-apathetic.played-unit",
    filter: { type: "unit", controller: "opponent", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(stunPlayed.picks, undefined);
  assert.equal(stunPlayed.linkedTo, undefined);
});

test("unl-150-219 Vex, Apathetic: 'they can't move it this turn' is a separate movement prohibition", () => {
  // 054 / 054.1（禁止压过许可）与 449 的 Move；不是“允许移动”，也不是一次性的移动动作。
  assert.equal(forbidMove.id, "vex-apathetic.cant-move-it");
  assert.equal(forbidMove.op, "continuous.movement");
  assert.deepEqual(forbidMove.args.operation, { kind: "constant", value: "move" });
  assert.deepEqual(forbidMove.args.forbidden, { kind: "constant", value: true });
  assert.deepEqual(forbidMove.args.period, { kind: "constant", value: "this-turn" });
  assert.deepEqual(forbidMove.targets, stunPlayed.targets);
  assert.equal(forbidMove.linkedTo, undefined);
});

test("unl-150-219 Vex, Apathetic golden: the [Stun] clause really stuns the finalized unit (CR 424.1)", () => {
  const kernel = world()
    .unit("vex", { might: 4 })
    .unit("played-unit", { owner: "B", might: 2 })
    .build();
  kernel.setTargets("vex-apathetic.played-unit", [kernel.ref("played-unit")]);

  const outcome = runAbilityBody([executableStun], kernel);

  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [["vex-apathetic.stun-the-played-unit", "executed"]]
  );
  assert.equal(kernel.getObject("played-unit").stunned, true);
  assert.equal(kernel.getObject("vex").stunned, false);
  assert.deepEqual(outcome.events.map(event => event.action), ["stun"]);
});

test("unl-150-219 Vex, Apathetic golden: an already-Stunned unit is a legal choice with no second stun (CR 424.1.a.1)", () => {
  const kernel = world()
    .unit("vex", { might: 4 })
    .unit("played-unit", { owner: "B", might: 2, stunned: true })
    .build();
  kernel.setTargets("vex-apathetic.played-unit", [kernel.ref("played-unit")]);

  const outcome = runAbilityBody([executableStun], kernel);

  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("played-unit").stunned, true);
  assert.deepEqual(outcome.events, []);
});

test("unl-150-219 Vex, Apathetic golden: a stale played-unit reference makes the Stun clause ignored (CR 359.3.e.6 / e.7)", () => {
  const kernel = world()
    .unit("vex", { might: 4 })
    .unit("played-unit", { owner: "B", might: 2 })
    .build();
  const stale = kernel.ref("played-unit");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  kernel.setTargets("vex-apathetic.played-unit", [stale]);
  const eventsBefore = kernel.events.length;

  const outcome = runAbilityBody([executableStun], kernel);

  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.events.length, eventsBefore, "an ignored clause emits no events");
});

test.todo(
  "unl-150-219 Vex, Apathetic: an opponent's spell or ability that chooses me costs 1 additional " +
    "Power payable with any Domain as a mandatory additional cost (CR 809.1.c / 809.1.c.1 / 809.1.d) — " +
    "no producer derives the Deflect tax from my target.tax effect (RIFT-360) and the tax is not " +
    "converted into any-domain Power (RIFT-261)"
);
test.todo(
  "unl-150-219 Vex, Apathetic: bind 'it' to the unit played by the opponent and stun it through the " +
    "real trigger pipeline (CR 355.10.c, 383.2.c.3.b / 359.3.f.3) — the frozen ObjectSelector set has " +
    "no triggering-event-object selector (engine batch 4)"
);
test.todo(
  "unl-150-219 Vex, Apathetic: evaluate 'while I'm at a battlefield' before the trigger is queued " +
    "(CR 383.2.a.1, 808.1.d.3 last-known location) — the pipeline requires a host.testTrigger adapter " +
    "that the trigger host still lacks the condition evaluator"
);
test.todo(
  "unl-150-219 Vex, Apathetic: enforce 'they can't move it this turn' against the Move action and " +
    "expire the prohibition with this turn's cleanup (CR 054 / 054.1, 317 / 318, 449) — " +
    "the merged continuous.movement primitive is not consumed by the movement system"
);
