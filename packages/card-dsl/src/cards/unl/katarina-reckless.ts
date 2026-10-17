import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Katarina, Reckless (unl-023-219) — Unit, 5 energy, 1 power (Fury), Might 5,
 * Fury, tags Katarina/Noxus/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-023-219，逐字）：
 *   When you hide a card, ready me.
 *   When you play a card from face down, deal 2 to an enemy unit.
 *
 * 规则依据（CR v1.5）：
 * - “When you hide a card”：Hide 是把牌面朝下放到你控制的战场（422.1）的 Discretionary Action，
 *   封闭时点表里的 card-hidden 正是为它定义的观察时点（emittedBy events，ruleRefs 422.1 等）。
 *   trigger 用该时点，事件玩家是本卡控制者（filter.player = self）。
 * - “ready me”（416.1 / 355.10.g / 412.4）：本卡是能力来源，effect.ready 的缺省选择器就是来源，
 *   已就绪的来源不会被再重置（416.1.b/416.1.c）。
 * - “When you play a card from face down”：时点仍是 card-played（359 / 383.4.a / 407），但条件是
 *   “该牌此前在面朝下（Facedown Zone）打出”（811.1.d）——事件载荷必须给出该事实。
 * - “deal 2 to an enemy unit”（418 / 429.6 的 Deal 格式；355.9 / 355.10）：单个对手控制的单位是
 *   选目标，用已合入的 effect.damage（amount 2、target 指向 TargetSpec）。
 *
 * status = judge-required（按 2026-10-16 合入批次复核；缺口不近似实现）：
 * - "When you hide a card" 的订阅仍不可注册：events/timing-points.ts 定义了 card-hidden，但封闭
 *   EVENT_PATTERN_TYPES（events/trigger-spec.ts）没有该拼写，programs/triggers.ts 注册时会抛
 *   invalid-event-type；更根本的是没有任何模块 emit card-hidden（GameAction 封闭集合没有 Hide 动作，
 *   面朝下区域与 cost.hidden 属 RIFT-89 的 Hide 工作，producers/ 也没有对应产生器）。
 * - "When you play a card from face down" 同样不可执行：card-played 载荷与 ObjectSnapshot 都不暴露
 *   "该牌此前面朝下"的特征（811.1.d；与已合入 rad/evelynn-consuming 记录同一缺口），
 *   programs/filters.ts 也不接受 fromFaceDown 过滤键。
 * 已合入并可真实执行的部分：card-played 触发注册（programs/filters.ts + programs/triggers.ts，RIFT-257）
 * 与触发体 effect.ready（ready me）、effect.damage（deal 2 to an enemy unit）；golden 用链适配器 + 参考内核执行。
 * 依赖：Hide 动作与 card-hidden 发射/拼写（RIFT-89 后续）、card-played 的 face-down 出处载荷（RIFT-120 后续）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-hidden",
      // 422.1/422.2：“When you hide a card” 的事件玩家是本卡控制者。
      filter: { event: "card-hidden", player: "self" }
    },
    optional: false,
    body: [
      {
        // “ready me”：缺省选择器即能力来源（355.10.g）。
        id: "katarina-reckless.ready-self",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      // 359/383.4.a：事件是“打出一张牌”；“from face down” 的出处事实见 judgeReason。
      filter: { event: "card-played", filter: { fromFaceDown: true }, player: "self" }
    },
    optional: false,
    body: [
      {
        id: "katarina-reckless.deal-two",
        op: "effect.damage",
        args: {
          amount: { kind: "constant", value: 2 },
          target: { kind: "constant", value: "katarina-reckless.enemy-unit" }
        },
        targets: [
          {
            id: "katarina-reckless.enemy-unit",
            // 355.9 / 355.10：“an enemy unit” 是单个由对手控制的单位目标。
            filter: { type: "unit", controller: "opponent", zone: "board" },
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
  canonicalCardId:
    "card.hash-af09eca4367e2e4b14d75cf96d7b4ae549ed3f338f0f188c50f3e6c83001ffaa",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两条触发都不可执行（已按 2026-10-16 合入批次复核，均不近似实现）：" +
    "(1)「When you hide a card」（422.1 的 Hide 行动）的订阅注册就会失败：封闭 EVENT_PATTERN_TYPES（events/trigger-spec.ts）不含 " +
    "\"card-hidden\"，programs/triggers.ts 注册时抛 invalid-event-type；且没有任何模块 emit card-hidden" +
    "（GameAction 封闭集合里没有 hide，面朝下区域与 Hide/cost.hidden 属 RIFT-89，events/producers/ 也无对应产生器）。" +
    "(2)「When you play a card from face down」需要「该牌此前在面朝下区域」的事实（811.1.d 与 Facedown Zone 口径），" +
    "当前 card-played 事件载荷与 ObjectSnapshot 都不暴露该特征（与已合入 rad/evelynn-consuming 同一缺口），" +
    "programs/filters.ts 也不接受 fromFaceDown 过滤键。" +
    "已合入并可真实执行的部分：card-played 触发注册（programs/filters.ts + programs/triggers.ts，RIFT-257）与触发体 " +
    "effect.ready（ready me）、effect.damage（deal 2 to an enemy unit），golden 用链适配器 + 参考内核覆盖。" +
    "依赖：Hide 动作与 card-hidden 的发射/拼写接线（RIFT-89 后续）、card-played 的 face-down 出处载荷（RIFT-120 后续）。",
  abilities,
  sourceText:
    "When you hide a card, ready me.\n" +
    "When you play a card from face down, deal 2 to an enemy unit."
} satisfies CardProgram;

export default program;
