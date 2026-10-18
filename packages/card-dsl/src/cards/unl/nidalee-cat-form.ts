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
 * 2026-10-18 复核：仍为 judge-required，当前缺口见 judgeReason。
 * 已有原语、关键词定义或通用适配器不代表本卡完整生产路径可执行。
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
    "两处当前缺口（2026-10-18 实测，均不近似实现）：" +
    "(1) [Ambush]（822.1.b/822.1.c/822.3）的展开进不了生产路径：programs/statics.ts 的 layerFor 拒绝 " +
    "\"Static ability kind play-location-permission has no layer mapping\"，随后的 continuous.timing 也因 " +
    "\"Unsupported static appliesTo [\\\"card\\\"]\" 被拒，两个 registration 都没有进入图层（实测 registry.list() 为空、" +
    "playLocations() 的 permissions 为空）；chain/engine.ts 的 playDestinationIsLegal 只读 continuous.location 的 " +
    "base/battlefield 类别，822.3 的“该战场还有你的单位”复核也没有消费方。" +
    "(2) “When I win a combat”（468.3.a–468.3.c）没有生产者与订阅：events/trigger-spec.ts 的封闭 " +
    "EVENT_PATTERN_TYPES 不含 combat-result（实测 translateTriggerFilter 之后仍以 invalid-event-type 被拒），" +
    "combat/flow.ts 仍在 combat-start-transaction 阻塞，所以 result: win 只是声明形状。",
  abilities,
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "When I win a combat, draw 1. (I win if I remain after combat.)"
} satisfies CardProgram;
