import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Teemo, Scout (ogn-197-298) — Unit, 2 energy, 1 Might.
 *
 * Printed text:
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   When you play me, give me +3 :rb_might: this turn.
 *
 * 规则依据（CR v1.5）：
 * - [Hidden]（811）是关键词：811.1.d 允许支付 [A] 把牌面朝下藏在一个你控制的战场，
 *   811.1.d.2 限定从 Facedown Zone 与其所在战场打出，811.5 给出后续 [Reaction] 与
 *   0 能量的打出许可。按契约 3.7 只声明 `{ kind: "keyword", keyword: "hidden" }`；
 *   `effects/keywords/Hidden.ts` 已合入，展开为静态 `cost.hidden`。
 * - “When you play me” 是 Play Effect（383.4.a.1 / 383.4.a.2），时点 card-played。
 * - “give me +3 :rb_might: this turn”：143.2.a 区分 Printed / Base / Effective Might，
 *   这是对 Effective Might 的**本回合**算术修正（475 图层）；最小 1 的下限不属于本卡
 *   （122.5.b 的钳制只在真正的减益里出现）。`effect.buff` 的文档明确“临时 Might 修改不属
 *   于 Buff 计数（702），归 layers 的 continuous.might”，所以不能改成放置 buff 计数器。
 *
 * status 判定（README 第 2 节）：judge-required。两处缺口：
 * 1. `continuous.might`（带 end-of-turn 期限的 Might 修正）在 effects/instructions/ 没有
 *    实现文件，也没有 layers 消费方接线；
 * 2. [Hidden] 的展开虽然已合入，但 `cost.hidden` 的运行时消费方缺失（cost/README.md 第 3 条：
 *    zones/actions 不支持 Champion/Facedown 区域与 Hide，需要父任务契约与集成）。
 * 依赖：RIFT-91（layers-continuous / continuous.might 消费方）、RIFT-84（kw-deflect-hidden 的
 * 展开）与 Hide 的面向区域契约。因此本卡不能记 executable。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "hidden"
  },
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "teemo-scout.grant-might",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 3 },
          duration: { kind: "constant", value: "end-of-turn" },
          target: { kind: "constant", value: "teemo-scout.self" }
        },
        targets: [
          {
            id: "teemo-scout.self",
            // “me”：静态 IR 用契约 3.6 的符号选择器表示能力宿主。
            filter: { type: "unit", object: "self" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-cb1f129544dcf370595e85fa0b8df2f0620b5cb3bd0199a5a8700160557bfb5f",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处缺口：(1) “give me +3 :rb_might: this turn” 需要带 end-of-turn 期限的 continuous.might " +
    "（143.2.a / 475 图层的 Effective Might 算术修正），effects/instructions/ 没有该原语文件，" +
    "layers 消费方也未接线；不能改用 effect.buff（Buff 是 702 的计数器，不是 Might 修正）。" +
    "(2) [Hidden] 虽已展开为静态 cost.hidden（RIFT-84），但 Hide 的运行时消费方缺失——" +
    "cost/README.md 第 3 条明确 zones/actions 尚不支持 Champion/Facedown 区域与 Hide，" +
    "需要父任务契约与集成。依赖：RIFT-91（continuous.might 消费方）、RIFT-84（kw-deflect-hidden）。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play me, give me +3 :rb_might: this turn."
} satisfies CardProgram;

export default program;
