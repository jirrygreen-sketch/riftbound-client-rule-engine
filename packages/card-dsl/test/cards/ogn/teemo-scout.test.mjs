import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/teemo-scout.js";

const CANONICAL = "card.hash-cb1f129544dcf370595e85fa0b8df2f0620b5cb3bd0199a5a8700160557bfb5f";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "When you play me, give me +3 :rb_might: this turn.";

const [keyword, triggered] = program.abilities;
const [grantMight] = triggered.body;

test("teemo-scout: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("teemo-scout: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("teemo-scout: [Hidden] keyword + play trigger granting +3 Might this turn", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "hidden" });

  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);

  // CR 143.2.a / 475: 这是本回合的 Effective Might 算术修正，不是 702 的 Buff 计数器。
  assert.equal(grantMight.id, "teemo-scout.grant-might");
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.equal(grantMight.linkedTo, undefined);

  // “me”：静态 IR 用契约 3.6 的符号选择器表示能力宿主。
  assert.equal(grantMight.targets.length, 1);
  const [spec] = grantMight.targets;
  assert.equal(spec.id, "teemo-scout.self");
  assert.deepEqual(spec.filter, { type: "unit", object: "self" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
});

test.todo(
  "teemo-scout: apply the +3 Might until end of turn through continuous.might (143.2.a / 475 图层) " +
    "once the layers consumer lands (RIFT-91)"
);

test.todo(
  "teemo-scout: [Hidden] 的藏牌与后续 [Reaction] / 0 能量打出（811.1.d / 811.5）依赖 Hide 的" +
    "面向区域契约（cost.hidden 消费方，RIFT-84 展开已合入）"
);
