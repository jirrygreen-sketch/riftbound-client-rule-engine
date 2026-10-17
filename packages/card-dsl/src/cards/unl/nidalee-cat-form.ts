import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Nidalee, Cat Form (unl-114-219) — Unit，能量 3，力量 1，Might 4，领域 Body，
 * 标签 Cat/Ixtal/Nidalee/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-114-219，逐字）:
 *   "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
 *   "When I win a combat, draw 1. (I win if I remain after combat.)"
 *
 * 规则依据（CR v1.5）:
 * - [Ambush]：822 / 822.1.a-d 的被动能力关键词。822.1.b 给出功能等价文本
 *   （"I may be played to a battlefield where you control Units" 且该次打出期间具有
 *   [Reaction]），822.1.c 说明它给 349 的打出流程增加合法位置，822.2 多个实例冗余。
 *   卡文件只声明关键词（契约 3.1/3.7、README 第 5 节），展开归关键词注册表。
 * - "When I win a combat"：战斗结果在 Combat Cleanup 的 Determine Combat Result
 *   步骤判定（468.3）；468.3.a 规定“收到 attacker/defender designation 且该战场只剩
 *   自己一方单位”的玩家获胜，468.3.c 规定战场上的单位继承其控制者的战斗结果，所以
 *   “我获胜”= 本卡的控制者在该战斗获胜且本卡仍在场。封闭时点里对应 combat-result
 *   （events/timing-points.ts：payloadFields combatId/battlefieldId/winnerId/loserId/
 *   unitResults/noResult，ruleRefs 468.3.a-468.3.d/468.4）。
 * - "draw 1"：414.1 / 414.1.a / 414.3，用已合入的 effect.draw；抽牌者缺省为能力
 *   控制者（190.6.d 的隐含 you）。
 * - 提示文字 "(I win if I remain after combat.)" 是提醒文本（135.2.d.3），不产生
 *   额外能力。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。Ambush 的 KeywordDef 已发布
 * play-location-permission 与 continuous.timing 两条声明，CardProgram → TriggerRegistration
 * 适配器也已合入。
 *
 * 仍缺三处（不近似实现）：
 * 1. [Ambush] 的 play-location-permission 展开仍没有 Finalize 的合法位置选择消费方；
 *    continuous.timing 的 Reaction 许可已经由 chain.canAct() 的 timing 查询读取。
 * 2. combat-result 时点没有生产者：docs/rules/timing-point-producers.md 把该时点记为
 *    “待后续——需要胜负/No Result 的权威 Combat cleanup 结果”；combat/flow.ts 仍在
 *    combat-start-transaction 抛出，combat-result 没有发射方。
 * 3. “我获胜”的绑定（468.3.c 的单位继承）需要 combat-result 载荷的 unitResults 与
 *    该战斗参与者的身份判定：合约 EventPattern 词汇没有这个绑定键（封闭枚举里没有
 *    combat-result 事件名，见 events/trigger-spec.ts 的 EVENT_PATTERN_TYPES），
 *    本程序用占位键 result: "win" 保留印刷作用域，不把它当成已可求值。
 * body 的 draw 1（414.3）已合入，golden 用解释器 + 参考内核真实执行。
 * 依赖：play-location-permission/continuous.timing 的 Finalize 与 canAct 消费方、
 * combat 结果事务与 combat-result 事件的封闭词汇。
 */
const abilities: Ability[] = [
  // 822：印刷的 [Ambush] 关键词声明（展开由关键词注册表负责）。
  { kind: "keyword", keyword: "ambush" },
  {
    kind: "triggered",
    trigger: {
      at: "combat-result",
      // 468.3.a / 468.3.c：胜负属于玩家，战场上的单位继承其控制者的结果。
      // filter 里的 result: "win" 是“我获胜”的占位拼写（来源自身 + 本战斗获胜）；
      // 引擎 trigger-spec 词汇尚无该载荷绑定（见文件头第 3 点）。
      filter: { event: "combat-result", filter: { source: "self", result: "win" } }
    },
    optional: false,
    body: [
      {
        id: "nidalee-cat-form.draw-1",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-6c0a37aa2f3f705ccf4e2649f8890740556c17ff53525e6e45bd44c6c16e9bd5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Ambush] 的 KeywordDef 与卡牌程序绑定已合入，但仍有三处缺口，均不近似实现：" +
    "(1) [Ambush]（822.1.b/822.1.c、355.2.b）的 play-location-permission 展开没有 Finalize 的合法位置选择消费方；" +
    "continuous.timing 的 Reaction 许可已经由 chain.canAct() 的 timing 查询读取。" +
    "(2) combat-result 时点（CR 468.3.a-468.3.d；468.3.c 规定单位继承控制者的战斗结果）没有生产者：" +
    "docs/rules/timing-point-producers.md 记为待后续，combat/flow.ts 仍在 combat-start-transaction 抛出。" +
    "(3) “我获胜”的绑定需要该时点载荷的 unitResults/参与者身份，而封闭的 EventPattern 词汇（events/trigger-spec.ts 的 " +
    "EVENT_PATTERN_TYPES）没有 combat-result 事件名也没有该绑定键，本程序用占位键 result: \"win\" 记录印刷作用域。" +
    "draw 1（414.3）已合入并在 golden 中真实执行。",
  abilities,
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "When I win a combat, draw 1. (I win if I remain after combat.)"
} satisfies CardProgram;
