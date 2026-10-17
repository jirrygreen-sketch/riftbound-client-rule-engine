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
 * status = judge-required（README 第 2 节，2026-10-17 复核）。已合入并可执行：Reaction 的
 * 关键词展开（continuous.timing 授权 showdown/closed-state，abilitySpeed 得出 reaction）与
 * 正文 Draw 1（414.3，golden 真实执行、含空牌库边界）。仍缺 [Repeat] 的两段接线：
 * (1) 追加费用声明无法进入 Finalize：programs/play.ts::translateCost 直接拒绝 additional-cost
 * （实测 "Unsupported play cost field keyword"），而 effects/keywords/Repeat.ts 展开的 static
 * repeat.cost 也被 programs/statics.ts 的 layerFor 拒绝（"no layer mapping"），因此费用计划里
 * 不会出现该可选组件，也不会被收取；(2) 已付费实例数没有传到结算端，解释器内建 repeat 指令的
 * 「支付一次多执行一次」（CR 820.1.d.1/820.2.a）无从触发。按 README 第 2 节，仅结构校验或
 * cost-plan 数据结构存在不算可执行，故保持 judge-required；不把额外执行近似成写死的第二次 draw。
 */
const downstageDramatics = {
  canonicalCardId: "card.hash-4d7df9f6e2c06a81e7fa39857ec0cf86cac9681d94b0fd33a777ff235214dee2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 [Repeat] :rb_energy_2: 的两段接线（2026-10-17 复核，均不近似实现）：" +
    "(1) 追加费用进入 Finalize（CR 820.1.c.1）：programs/play.ts::translateCost 仍拒绝 additional-cost 声明" +
    "（实测 \"Unsupported play cost field keyword\"），effects/keywords/Repeat.ts 展开的 static repeat.cost 也被 " +
    "programs/statics.ts 的 layerFor 拒绝（\"Static ability kind repeat.cost has no layer mapping\"），" +
    "费用计划因此不会包含该可选组件，也不会收取；已有 cost-plan 的 optionalAdditional/回执只是调用方输入，不能代替卡牌声明绑定；" +
    "(2) 已付费实例数 → 结算端额外执行（CR 820.1.d.1/820.2.a）：没有任何路径把 paid-instance count 交给解释器内建 repeat 指令，" +
    "\"pay once, execute once more\" 无法触发。" +
    "已合入并可执行：Reaction 展开（continuous.timing + abilitySpeed）与正文 Draw 1（414.3，golden 含空牌库边界）；" +
    "不把额外执行近似成写死的第二次 draw。",
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
