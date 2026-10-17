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
 * status 判定（README 第 2 节）：judge-required。
 * - “give me +3 :rb_might: this turn” 半段已可执行：RIFT-258 合入的 continuous.might 以
 *   `appliesTo: self` 在 arithmetic 层对宿主注册 +3、end-of-turn 到期；golden 用真实解释器 +
 *   图层引擎执行并断言（702 的 Buff 计数不能替代 Might 修正）。
 * - [Hidden] 半段仍不可执行：keywords/Hidden.ts 已展开为静态 `cost.hidden`，但没有消费方
 *   ——封闭 GameAction 集合没有 Hide 行动、ZoneId 没有 Facedown Zone，`card-hidden` 时点也
 *   没有产生方（docs/rules/timing-point-producers.md 记为待后续，需受信 Hide action/result）。
 *   依赖：RIFT-257（CardProgram → 关键词展开注册）与 Hide/facedown 的区域与行动契约集成。
 *   因此整卡保持 judge-required。
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
          // “me”：appliesTo self 让原语把修改注册在能力宿主（来源）上，
          // 与已合入的连续效果写法一致（contract 3.6 的 source/self）。
          appliesTo: { kind: "constant", value: "self" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-cb1f129544dcf370595e85fa0b8df2f0620b5cb3bd0199a5a8700160557bfb5f",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "“give me +3 :rb_might: this turn” 半段已可执行（continuous.might + appliesTo self，" +
    "143.2.a/475 的 arithmetic 层修正、end-of-turn 到期，golden 已执行并断言；effect.buff 是 702 的计数器，不能替代）。" +
    "整卡仍不可执行：[Hidden] 已展开为静态 cost.hidden（RIFT-84），但没有消费方——封闭 GameAction 集合没有 Hide 行动、" +
    "ZoneId 没有 Facedown Zone，`card-hidden` 时点也没有产生方（docs/rules/timing-point-producers.md：需受信 Hide action/result）。" +
    "依赖：RIFT-257（CardProgram → 关键词展开注册）与 Hide/facedown 的区域与行动契约集成。不近似实现。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play me, give me +3 :rb_might: this turn."
} satisfies CardProgram;

export default program;
