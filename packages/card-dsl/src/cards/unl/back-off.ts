import type { CardProgram } from "../../ir/index.js";

/**
 * Back Off — CR v1.5 811 (Hidden), 806 (Action), 424.1 (Stun),
 * 356.1/356.2 (play origin).
 *
 * 复核后的真实缺口（均不近似实现）：
 * 1. 「If you played this from your hand」：RIFT-359 已合入 condition 谓词
 *    played-from-hand / played-from-zone（读取结算事件携带的来源区域事实，取代不存在的
 *    ObjectSnapshot 特征），本程序已改用该谓词；但 chain/engine.ts 的 Resolve 只对
 *    触发项注入 item.trigger.event（conditionInputs 在 item.trigger?.event 为 undefined
 *    时为空），383.4.a 的卡牌自身 play.body 结算时不带该载荷，谓词按 fail-closed 记
 *    ignored。不能用当前位置或无条件抽牌代替。
 * 2. Hidden：Hidden KeywordDef 与 cost/kinds/hidden.ts（buildHiddenCostPlan /
 *    payHiddenCostPlan）已合入，但没有消费方把 811 的 Hide 动作、面朝下打出许可与
 *    免基础费用路径接到 card program；faceDown 仍只在 turn/flow.ts 的 cleanup 抛
 *    TurnCombatBlockedError('hidden-cleanup-state')。
 * 3. chain/interpreter-adapter.ts 的 LITERAL_FIELDS 仍不含 effect.stun：卡牌 IR 的
 *    target 保持 Expr 包装，原始 body 经生产适配器时被冻结 schema 拒绝
 *    （实测 TypeError: effect.stun target must be a spec id string）。解释器直接执行
 *    Stun 本体的证据不能代替该接线。
 */
const backOff = {
  canonicalCardId: "card.hash-8976907cb3568b5c00ce51faf4a35f8342adffe884444d535f12324bb4ae3778",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5）：(1)「If you played this from your hand」（356.1/356.2）的打出来源事实尚不可求值：" +
    "RIFT-359 已合入 condition 谓词 played-from-hand / played-from-zone（按来源角色读取结算事件携带的 " +
    "fromZone/playedFromZone 等事实），本程序已改用 { kind: \"played-from-hand\", object: \"source\" }；" +
    "但 chain/engine.ts 的 Resolve 在 item.trigger?.event 为 undefined 时传入空 conditionInputs，" +
    "383.4.a 的卡牌自身 play.body 结算不带该事件载荷，谓词读不到来源区域并按 fail-closed 记 ignored；" +
    "ObjectSnapshot 也没有 playedFromHand 字段，不能用当前位置或无条件抽牌代替。" +
    "(2) Hidden 的 KeywordDef 已合入，展开仅声明 cost.hidden；cost/kinds/hidden.ts（buildHiddenCostPlan / " +
    "payHiddenCostPlan）虽已合入，但没有消费方把 811 的 Hide 动作、面朝下打出许可与免基础费用路径接到 " +
    "card program，faceDown 也只在 turn/flow.ts 的 cleanup 里被当作未实现状态抛出" +
    "（TurnCombatBlockedError 'hidden-cleanup-state'）。cost.pay/cost.modify 与 Action 的链时机判断已合入，不再列为缺失原语；" +
    "(3) chain/interpreter-adapter.ts 的 LITERAL_FIELDS 仍不含 effect.stun：卡牌 IR 的 target 保持 Expr 包装，" +
    "原始 body 经生产适配器时被冻结 schema 拒绝（实测 TypeError: effect.stun target must be a spec id string），" +
    "解释器直接执行 Stun 本体的证据不能代替该接线。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "back-off.stun-unit",
          op: "effect.stun",
          args: { target: { kind: "constant", value: "back-off.stunned-unit" } },
          targets: [
            {
              id: "back-off.stunned-unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "back-off.draw-if-from-hand",
          // 「If you played this from your hand」：RIFT-359 已合入的 played-from-hand
          // 谓词读取结算事件携带的来源区域事实（356.1/356.2），取代原先不存在的
          // ObjectSnapshot 特征；本条卡牌自身 play.body 的结算仍拿不到该事件载荷
          // （见 judgeReason 第 1 点），故整卡保持 judge-required。
          // 不含 linkedTo：抽牌不引用 Stun 的动作结果（055 / 359.3.e.11）。
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } },
          condition: { kind: "played-from-hand", object: "source" }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "[Stun] a unit. (It doesn't deal combat damage this turn.)\n" +
    "If you played this from your hand, draw 1."
} satisfies CardProgram;

export default backOff;
