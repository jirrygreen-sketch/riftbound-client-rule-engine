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
 * - [Hidden]（811）是关键词：811.1.b 允许支付 [A] 把牌面朝下藏在一个你控制的战场，
 *   811.1.d.1 限定隐藏永久物打出到其所在战场，811.6 给出次回合 [Reaction]，
 *   811.1.b 允许忽略基础费用打出。按契约 3.7 只声明 `{ kind: "keyword", keyword: "hidden" }`；
 *   `effects/keywords/Hidden.ts` 已合入，展开为静态 `cost.hidden`。
 * - “When you play me” 是 Play Effect（383.4.a.1 / 383.4.a.2），时点 card-played。
 * - “give me +3 :rb_might: this turn”：143.2.a 区分 Printed / Base / Effective Might，
 *   这是对 Effective Might 的**本回合**算术修正（475 图层）；最小 1 的下限不属于本卡
 *   （122.5.b 的钳制只在真正的减益里出现）。`effect.buff` 的文档明确“临时 Might 修改不属
 *   于 Buff 计数（702），归 layers 的 continuous.might”，所以不能改成放置 buff 计数器。
 *
 * Status: judge-required.
 * The authored self +3 Might instruction runs in the arithmetic layer and
 * expires at end of turn; Buff counters (702) are not a substitute.
 * Hidden expansion and program binding are merged. cost.hidden still has no
 * full Hide/facedown consumer (811.1.b/d), next-turn Reaction/base-cost-ignore
 * play permission (811.6), or card-hidden producer.
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
    "Hidden 的静态 cost.hidden 仍缺 Hide 行动与 Facedown Zone 生命周期消费方（811.1.b/811.1.d）、" +
    "次回合 Reaction/忽略基础费用的打出许可（811.1.b/811.6）及受信 card-hidden 产生方。" +
    "continuous.might 的本回合 self +3 已有真实执行证据，但不能代替 Hidden 的藏牌、失控回收与隐藏打出流程。" +
    "不近似实现。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play me, give me +3 :rb_might: this turn."
} satisfies CardProgram;

export default program;
