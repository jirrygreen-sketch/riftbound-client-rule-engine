import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/akali-brash.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";

const FIRST_MOVE = "akali-brash.add-first-move";
const SECOND_MOVE_BANISH = "akali-brash.banish-top";
const SECOND_MOVE_PERMISSION = "akali-brash.grant-play";

test("rad-015-167 Akali, Brash: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason.includes("The second time I move each turn"));
  assert.ok(program.judgeReason.includes("move-location"));
  assert.equal(
    program.canonicalCardId,
    "card.hash-299400fea6fee0793728ed914b84549455937a2ee92f40540aa04c765818548e"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "The first time I move each turn, [Add] :rb_energy_1::rb_rune_rainbow:.\n" +
      "The second time I move each turn, banish the top card of your Main Deck. Until your next Ending Phase, you may play that card. (You still pay its costs.)"
  );
  assert.match(program.judgeReason, /Universal Power/);
  assert.match(program.judgeReason, /condition\.history/);
  assert.match(program.judgeReason, /effect\.play-permission/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /TriggerSpecValidationError/);
  assert.match(program.judgeReason, /Unsupported condition/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(257|261)/);
});

test("rad-015-167 Akali, Brash: the two move triggers really cannot register (421.1 / 449.1)", () => {
  // The production registration path validates trigger.filter.event against the
  // closed EVENT_PATTERN_TYPES vocabulary, and object-moved is not in it, so a
  // program that declares these triggers cannot be bound at all.
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  const kernel = world().unit("akali", { cardId: program.canonicalCardId, types: ["unit"], zone: "board" }).build();
  const registrations = triggerRegistrations(registry, kernel.getObject("akali"));
  assert.equal(registrations.length, 2);
  const f = fixture({ cards: [] });
  assert.throws(
    () => f.engine.pipeline.registerTrigger(registrations[0]),
    error => error.name === "TriggerSpecValidationError" &&
      /trigger\.filter\.event/.test(error.message)
  );
});

test("rad-015-167 Akali, Brash: the second-move ordinal history has no evaluable Condition", () => {
  // 383.1: "the second time I move each turn" needs host-scoped move history.
  // The trigger condition's count falls through to the object query (the subject
  // is ignored and a bare object count is truthy), and there is no history
  // Condition kind to replace it with.
  const kernel = world().unit("akali", { types: ["unit"], zone: "board" }).build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("akali") });
  const environment = {
    context: ctx,
    host: ctx.ref("akali"),
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false,
    query: () => kernel.objects
  };
  // The authored condition keeps its fail-closed placeholder filter, so the
  // count is 0 and the ordinal gate is never satisfied today.
  assert.equal(evaluateCondition(program.abilities[1].trigger.condition, environment), false);
  const bare = { kind: "compare", left: { kind: "count", subject: "self-moves-this-turn" }, operator: "gte", right: { kind: "constant", value: 2 } };
  assert.equal(evaluateCondition(bare, environment), false, "only the object count is read");
  assert.throws(() => evaluateCondition({ kind: "history" }, environment), /Unsupported condition: history/);
});

test("rad-015-167 Akali, Brash: [Add] :rb_rune_rainbow: still has no Universal Power representation", () => {
  // 135.2.e.5 / 163.2.b: the printed symbol is Power of any Domain. The merged
  // primitive accepts only the closed six-domain list, so the declaration fails
  // closed instead of being approximated by one domain.
  const kernel = world().player("A", { energy: 0 }).build();
  const [gain] = program.abilities[0].body;
  const outcome = resolveChainBody([gain], kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(kernel.player("A").energy, 0, "no partial Energy is granted when [A] is unexpressible");
  assert.equal(kernel.player("A").power.length, 0);
});

test("rad-015-167: first-move resource trigger and second-move banish trigger", () => {
  assert.equal(program.abilities.length, 2);
  const [firstMove, secondMove] = program.abilities;

  assert.equal(firstMove.kind, "triggered");
  assert.equal(firstMove.trigger.at, "object-moved");
  assert.deepEqual(firstMove.trigger.filter, { self: true });
  // “The first time … each turn” = once per-turn（与 sfd-113-221 同一写法）。
  assert.equal(firstMove.trigger.once, "per-turn");
  assert.equal(firstMove.optional, false);
  assert.equal(firstMove.body.length, 1);
  const [gain] = firstMove.body;
  assert.equal(gain.id, FIRST_MOVE);
  assert.equal(gain.op, "effect.resources");
  assert.deepEqual(gain.args.energy, { kind: "constant", value: 1 });
  // [A] = Power of any Domain（135.2.e.5 / 163.2.b）：保留印刷写法供审查；
  // effect.resources 的六域封闭枚举不支持 [A]，不近似成任一域。
  assert.deepEqual(gain.args.power, { kind: "constant", value: ["rainbow"] });

  assert.equal(secondMove.kind, "triggered");
  assert.equal(secondMove.trigger.at, "object-moved");
  assert.deepEqual(secondMove.trigger.filter, { self: true });
  assert.equal(secondMove.trigger.once, undefined);
  assert.equal(secondMove.trigger.condition.kind, "compare");
  assert.deepEqual(secondMove.trigger.condition.left, {
    kind: "count",
    subject: "self-moves-this-turn",
    filter: { zone: "history-record" }
  });
  assert.equal(secondMove.trigger.condition.operator, "eq");
  assert.deepEqual(secondMove.trigger.condition.right, { kind: "constant", value: 2 });
  assert.deepEqual(secondMove.body.map(instruction => instruction.id), [
    SECOND_MOVE_BANISH,
    SECOND_MOVE_PERMISSION
  ]);
  assert.equal(secondMove.body[0].op, "effect.banish");
  assert.deepEqual(secondMove.body[0].args.objects, {
    kind: "constant",
    value: { zone: "deck", from: "top" }
  });
  assert.equal(secondMove.body[1].op, "effect.play-permission");
  assert.equal(secondMove.body[1].linkedTo, SECOND_MOVE_BANISH);
});

test("rad-015-167: [Add] gains 1 Energy through the real effect.resources primitive", () => {
  const kernel = world().player("A", { energy: 0 }).build();
  const [gain] = program.abilities[0].body;
  // 只执行六域可表达的能量部分；[A] 的 Universal Power 表示缺口记在 judgeReason 与
  // 下面的 TODO 里，不锁定合并原语对 [A] 的否定结果（依赖落地后断言会失效）。
  const energyOnly = resolveChainBody([{ ...gain, args: { energy: gain.args.energy } }], kernel);
  assert.equal(energyOnly.status, "executed");
  assert.equal(energyOnly.results[0].result.status, "executed");
  assert.equal(kernel.player("A").energy, 1);
  assert.equal(energyOnly.linkedValues[`${FIRST_MOVE}.resources`].energy, 1);
  assert.deepEqual(energyOnly.linkedValues[`${FIRST_MOVE}.resources`].power, []);
});

test("rad-015-167: the second-move body banishes the deck top through real effect.banish", () => {
  const kernel = world().deck(["top", "second"], { owner: "A" }).build();
  const banish = program.abilities[1].body[0];
  const outcome = resolveChainBody([banish], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("top").zone, "banishment");
  assert.equal(kernel.getObject("second").zone, "deck");
  assert.equal(outcome.linkedValues[`${SECOND_MOVE_BANISH}.akaliBanishCount`], 1);
});

test.todo(
  "rad-015-167 Akali, Brash: “Until your next Ending Phase, you may play that card.” 的期限化" +
    "打出许可原语 effect.play-permission 缺失（未注册）"
);
