import type { CardProgram } from "../../ir/index.js";

/**
 * Moonlight Affliction（unl-066-219）— Spell，7 能量，无印刷力量，领域 Mind。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-066-219，逐字）：
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
 *   "Give a unit -10 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）：
 * - [Reaction]（813）是许可类关键词，按契约 3.7 只声明。
 * - 「Give a unit -10 :rb_might: this turn」："a unit" 按 355.5 / 355.5.a 是 Choice →
 *   Targeted（355.7），写成 TargetSpec（min=max=1、selection "one"）；-10 是带回合期限
 *   的临时 Might 修正（143.2.a 的有效 Might；143.2.c 的“低于 0 只按 0 引用”是求值口径；
 *   到期由 317.2.c 的回合结束清理处理）。
 *
 * status = executable：continuous.might 已通过 ResolveContext.addContinuous 注册 arithmetic
 * layer effect，end-of-turn duration 由 layers/duration.ts 到期清理；Reaction 是卡牌的
 * intrinsic speed keyword，链时机由现有 Reaction 展开处理。effect.buff 只管 702/703
 * Buff 计数器，不能用来近似 Might。
 */
const moonlightAffliction = {
  canonicalCardId: "card.hash-3dfe95c2b5760342ff53da5b907465cf7b0aa40a27553cfdfa36e7a449d7530b",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 7 }
      },
      body: [
        {
          id: "moonlight-affliction.give-minus-10-might",
          // 临时 Might 修正：算术图层的 continuous.might。
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -10 },
            duration: { kind: "constant", value: "this-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "moonlight-affliction.chosen-unit" }
            }
          },
          targets: [
            {
              id: "moonlight-affliction.chosen-unit",
              filter: { type: "unit", zone: "board" },
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
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give a unit -10 :rb_might: this turn."
} satisfies CardProgram;

export default moonlightAffliction;
