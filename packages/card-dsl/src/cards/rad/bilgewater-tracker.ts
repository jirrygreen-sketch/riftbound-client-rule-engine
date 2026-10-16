import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Bilgewater Tracker (rad-003-167) — Unit, Body, 3 energy / 3 Might.
 *
 * 原文（deck-catalog rad-003-167，逐字）：
 *   "When you play me, deal 1 to each of up to 2 units."
 *
 * 规则依据（CR v1.5）：
 * - "When you play me" 是 Play Effect（383.4.a，打出完成后入链），对应时点 card-played
 *   且 filter 指向自身；
 * - "deal 1 to each of up to 2 units"："up to 2" 是选择上限（355.9.b、355.14），
 *   单个 TargetSpec（min 0 / max 2 / selection up-to）；”each”在这里表示对每个被选
 *   目标各造成 1 点，不是分摊伤害，因此不设 effect.damage 的 divide，也不写动态数额；
 * - 数额固定为 1，交给已合入的 effect.damage 原语（418.1.c：对每个仍合法目标各提交一次
 *   damage 动作）。
 *
 * 依赖检查：effect.damage（已合入）、TargetSpec up-to（已合入）、card-played 时点
 * （events/timing-points.ts 已定义，链/事件管线在契约 3.5 路径上）——整卡无关键词依赖，
 * 因此标记 executable，并在 golden 测试中用真实解释器执行 body。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "bilgewater-tracker.deal-1",
        op: "effect.damage",
        args: {
          amount: { kind: "constant", value: 1 },
          target: { kind: "constant", value: "bilgewater-tracker.units" }
        },
        targets: [
          {
            id: "bilgewater-tracker.units",
            filter: { type: "unit" },
            min: 0,
            max: 2,
            selection: "up-to"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-2d8ce518b0085e019c06636c36fc6b7b008636df61dbc1370855a448825385ff",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities,
  sourceText: "When you play me, deal 1 to each of up to 2 units."
} satisfies CardProgram;

export default program;
