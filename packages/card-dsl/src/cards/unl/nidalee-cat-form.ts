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
 * status 判定（cards/README.md 第 2 节）：judge-required。四处缺口，均不近似实现：
 * 1. [Ambush]（822）没有已合入的 KeywordDef：合法打出位置许可（822.1.b/822.1.c、
 *    355.2.b）与“被 Ambush 打出期间具有 [Reaction]”的时机改写都没有消费方
 *    （effects/keywords/ 下没有 Ambush 文件，chain.canAct() 也不读图层许可）。
 * 2. combat-result 时点没有生产者：docs/rules/timing-point-producers.md 把该时点记为
 *    “待后续——需要胜负/No Result 的权威 Combat cleanup 结果”，combat/ 未接入唯一
 *    事件管线（契约 §7.2 批 5，RIFT-33/RIFT-120）。
 * 3. “我获胜”的绑定（468.3.c 的单位继承）需要 combat-result 载荷的 unitResults 与
 *    该战斗参与者的身份判定；已合入的 EventPattern/ObjectFilter 词汇没有这个绑定键，
 *    本程序用占位键 result: "win" 保留印刷作用域，不把它当成已可求值。
 * 4. 缺 CardProgram → TriggerRegistration 适配器（RIFT-120 后续），触发能力没有注册路径。
 * body 的 draw 1（414.3）已合入，golden 用解释器 + 参考内核真实执行。
 */
const abilities: Ability[] = [
  // 822：印刷的 [Ambush] 关键词声明（展开依赖未合入的 Ambush 关键词任务）。
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
    "[Ambush]（822）没有已合入的 KeywordDef：合法打出位置许可（822.1.b/822.1.c、355.2.b）与“以此法打出期间具有 [Reaction]”" +
    "的时机改写都无消费方（effects/keywords/ 下没有 Ambush 文件，chain 的时机许可不读图层），依赖 RIFT-266。" +
    "“When I win a combat”还缺触发侧路径：combat-result 时点（CR 468.3.a-468.3.d；468.3.c 规定单位继承控制者的战斗结果）" +
    "没有生产者——docs/rules/timing-point-producers.md 记为待后续，combat/ 未接入唯一事件管线（RIFT-33/RIFT-120）；" +
    "“我获胜”的绑定需要该时点载荷的 unitResults/参与者身份，已合入的 EventPattern/ObjectFilter 词汇没有这个键，" +
    "本程序用占位键 result: \"win\" 记录印刷作用域；另外缺 CardProgram → TriggerRegistration 适配器（RIFT-120）。" +
    "draw 1（414.3）已合入并在 golden 中真实执行。不近似实现。",
  abilities,
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "When I win a combat, draw 1. (I win if I remain after combat.)"
} satisfies CardProgram;
