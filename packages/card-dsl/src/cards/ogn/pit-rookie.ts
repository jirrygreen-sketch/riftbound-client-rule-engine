import type { CardProgram } from "../../ir/index.js";

/**
 * Pit Rookie (ogn-136-298) — Unit, fiora-sfd (M1).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-136-298):
 *   When you play me, buff another friendly unit. (If it doesn't have a buff,
 *   it gets a +1 :rb_might: buff.)
 *
 * “When you play me” 对应 card-played 时点（359/383.4.a），filter 指向自身；
 * “buff another friendly unit” 是强制目标选择（other + friendly + unit，
 * 355.10），指令体用已合入的 effect.buff 原语（mode buff，目标为所选项）。
 * 目标过滤里 "controller"/"other" 是契约层占位语义（契约 3.2 的 TargetSpec
 * filter 允许扩展键）：实际的选择管线在 Finalize 解析这些占位符（"controller"
 * 指能力控制者、"other" 排除来源对象）。参考内核按值比较，故 golden 执行
 * 测试在目标集里显式锁定合法对象，验证指令体行为。
 */
const pitRookie = {
  canonicalCardId: "card.hash-e2638655ff5ed3a1e60a501be3c23d74e46ef7f1900bed31b436f1a579b316ed",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { role: "self" } },
      optional: false,
      body: [
        {
          id: "buff-other",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "other-unit" }
          },
          targets: [
            {
              id: "other-unit",
              filter: { type: "unit", controller: "controller", other: true },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "When you play me, buff another friendly unit. (If it doesn't have a buff, it gets a +1 :rb_might: buff.)"
} satisfies CardProgram;

export default pitRookie;
