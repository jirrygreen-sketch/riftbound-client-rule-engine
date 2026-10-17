import type { CardProgram } from "../../ir/index.js";

/**
 * Downstage Dramatics（unl-061-219）— Spell，2 能量，无印刷力量，领域 Mind。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-061-219，逐字）：
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
 *   "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
 *   "Draw 1."
 *
 * 规则依据（CR v1.5）：
 * - [Reaction]（813）是许可类关键词，按契约 3.7 只声明。
 * - [Repeat] :rb_energy_2:（820.1 / 820.1.c.1）是打出时可选的追加费用：820.1.d.1 规定
 *   支付后本牌的效果在结算时额外执行一次，820.2 / 820.2.a 要求重新做选择。
 *   追加费用按契约 3.1 声明在 play 的 CostSpec 上（与已合入 sfd/danger-zone 的写法一致）；
 *   印刷基础费用 2 能量由费用管线从 catalog 绑定（356.1.c）。
 * - 「Draw 1」是 414.3 的固定抽牌：效果指示的抽牌（414.2.b），抽牌者是能力控制者
 *   （190.6.d 的隐含 “you”），以已合入的 effect.draw 执行；414.4 的牌库不足 Burn Out
 *   由内核处理。
 *
 * status = judge-required（README 第 2 节）：正文指令（effect.draw）本身已合入并可真实执行，
 * 但整卡依赖 [Repeat] 的追加费用收取与「已付费实例数 → 额外执行一次」的接线：
 * effects/keywords/Repeat.ts 已声明 repeat.cost，cost-plan 也有 optionalAdditional 与已付实例
 * 的数据结构；但 programs/play.ts::translateCost 仍拒绝 additional/additional-cost，且打出后的
 * paid-instance count 尚未传给结算端。按 README 第 2 节，仅结构校验通过或 IR 可表达不算可执行，
 * 故保持 judge-required；不把「额外执行」近似成写死的第二次 draw。Reaction 的关键词展开和
 * continuous.timing 原语已有独立执行路径，不再作为本卡缺口。
 */
const downstageDramatics = {
  canonicalCardId: "card.hash-4d7df9f6e2c06a81e7fa39857ec0cf86cac9681d94b0fd33a777ff235214dee2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Repeat] :rb_energy_2: 的接线未合入：820.1.c.1 的追加费用收取与 820.1.d.1 的「已付费实例数 → 结算时额外执行一次」" +
    "需要 programs/play.ts::translateCost 把 additional/additional-cost 翻译为 cost-plan 的 optionalAdditional，" +
    "并由打出/结算管线把 paid-instance count 交给 Repeat 的额外执行；当前两段接线都不存在，因此整卡不能宣称可执行。" +
    "正文「Draw 1」（414.3，控制者抽牌）只用已合入的 effect.draw，golden 用参考内核真实执行；" +
    "不把额外执行近似成写死的第二次 draw。Reaction（813）已由 KeywordDef、continuous.timing 与 chain.canAct 支持。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      // [Repeat] 的追加费用（820.1.c.1）：与已合入 sfd/danger-zone 同一形状，待费用
      // 计划消费方接管；印刷基础费用 2 能量由 catalog 绑定（356.1.c）。
      cost: {
        kind: "additional-cost",
        keyword: "repeat",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "downstage-dramatics.draw-one",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Draw 1."
} satisfies CardProgram;

export default downstageDramatics;
