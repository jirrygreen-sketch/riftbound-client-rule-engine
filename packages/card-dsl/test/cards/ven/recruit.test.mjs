import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import recruit from "../../../dist/cards/ven/recruit.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-3803d5d84b49f4d89171869c436061efb615d7b53a0c14cab12b663b7f50542b";

test("ven-t04 Recruit: program passes validateCardProgram", () => {
  const result = validateCardProgram(recruit);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-t04 Recruit: no-ability Colorless Recruit unit token", () => {
  assert.equal(recruit.canonicalCardId, CANONICAL_ID);
  assert.equal(recruit.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(recruit.rulesetVersion, "core-1.5");
  assert.equal(recruit.status, "no-ability");
  assert.deepEqual(recruit.abilities, []);
  // no-ability 不是「还没实现」的占位状态（README 第 2 节）。
  assert.equal(recruit.judgeReason, undefined);
});

test("ven-t04 Recruit: sourceText records the empty printed ability text", () => {
  // deck-catalog 的 ability 字段是空字符串；validateCardProgram 要求 sourceText
  // 非空, 因此沿用仓库既有口径写官方「无文本」占位 "[NO TEXT]"
  // （与 ogn/recruit-de、ogn/recruit-nx、ogn/playful-phantom 一致）。
  assert.equal(recruit.sourceText, "[NO TEXT]");
});

test("ven-t04 Recruit: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), recruit);
});
