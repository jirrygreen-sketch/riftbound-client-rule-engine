// RIFT-662: execution evidence for this card lives in
// ../templates/activated-activated-continuous-grant-key-662.test.mjs.
// This file keeps the README §4.1 layer 1 (validation and identity) and layer 2
// (structure) checks; the card stays judge-required for the gaps recorded in
// its judgeReason.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/temporal-portal.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-bb98faffa9506df8c98b1086bec2cbd71a7dd9f4c677d8e31dc335ebfa6e61d5";
const ALL_SIX_DOMAINS = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];
const EXPECTED_SOURCE =
  ":rb_rune_rainbow:, :rb_exhaust:: Give the next spell you play this turn [Repeat] " +
  "equal to its cost. (You may pay the additional cost to repeat the spell's effect.)";

const [ability] = program.abilities;
const [grantRepeat] = ability.body;

test("sfd-078-221 Temporal Portal: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  // The refreshed reason keeps the three measured gaps (rejected printed shape,
  // missing one-shot next-spell window, missing dynamic Repeat cost read).
  assert.match(program.judgeReason, /amount/);
  assert.match(program.judgeReason, /one-shot next-spell|下一个法术/);
  assert.match(program.judgeReason, /820\.1\.c\.1/);
});

test("sfd-078-221 Temporal Portal: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("sfd-078-221 Temporal Portal: one action-speed activated ability with the printed rainbow + exhaust cost", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 151.2：Gear 启动式能力在控制者 Main Phase 执行。
  assert.equal(ability.timing, "action");
  // 135.2.e.5.a / 163.2.b：:rb_rune_rainbow: 是任意域 Power [A]，用六域
  // allowedDomains 表达；415.4/415.5 的 :rb_exhaust: 是横置自身费用。
  assert.deepEqual(ability.cost.payments, [
    { kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ALL_SIX_DOMAINS },
    { kind: "exhaust", object: "self" }
  ]);
});

test("sfd-078-221 Temporal Portal: the body keeps the printed one-shot Repeat grant markers", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(grantRepeat.id, "temporal-portal.grant-repeat");
  assert.equal(grantRepeat.op, "continuous.grant-keyword");
  // 820.1.c：授予对象与费用都是「那张未来法术」自身，不是固定数值；IR 只能用
  // 描述性标记表达，直到 one-shot 窗口与动态费用读取落地（见 judgeReason）。
  assert.deepEqual(grantRepeat.args, {
    keyword: { kind: "constant", value: "Repeat" },
    amount: { kind: "constant", value: "equal-to-its-cost" },
    appliesTo: { kind: "constant", value: "next-spell-you-play" },
    duration: { kind: "constant", value: "end-of-turn" }
  });
  assert.equal(grantRepeat.targets, undefined);
  assert.equal(grantRepeat.linkedTo, undefined);
});

test("sfd-078-221 Temporal Portal: the printed grant shape is rejected at the merged primitive boundary", async () => {
  // 2026-10-17 实测：argsSchema 不接受 amount；appliesTo 求值后只接受 "self"。
  const grantKeyword = (await import("../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js")).default;
  const { runInstruction } = await import("../../../../engine-core/dist/effects/testing/index.js");
  const withAmount = grantKeyword.argsSchema.safeParse(grantRepeat.args);
  assert.equal(withAmount.success, false);
  assert.match(String(withAmount.error), /Invalid continuous\.grant-keyword argument: amount/);
  const { amount: _amount, ...withoutAmount } = grantRepeat.args;
  assert.throws(
    () => runInstruction(grantKeyword, withoutAmount, { world: world().build() }),
    /continuous\.grant-keyword appliesTo must evaluate to "self"/
  );
});

test.todo(
  "sfd-078-221 Temporal Portal: install the printed Repeat instance on the next spell you play this turn " +
    "(CR 820.1.b / 820.1.c, 355.5) — needs a one-shot next-spell window; no ObjectSelector, ObjectFilter or " +
    "Duration can express it (same gap as ogn/raging-firebrand, unl/the-academy, rad/firelights-hideout)"
);

test.todo(
  "sfd-078-221 Temporal Portal: build the granted Repeat's optional additional cost from that later spell's own " +
    "printed cost (CR 206, 820.1.c.1) — no merged consumer reads a not-yet-played spell's base cost at Finalize"
);
