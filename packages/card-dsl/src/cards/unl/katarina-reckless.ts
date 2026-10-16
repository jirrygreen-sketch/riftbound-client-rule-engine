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
 * status = judge-required（缺口不近似实现）：
 * - “When you hide a card” 不可执行：已合入代码没有任何模块 emit card-hidden（GameAction 封闭集合里
 *   没有 Hide 动作，面朝下区域与 cost.hidden 属 RIFT-89 的 Hide 工作），因此触发无法进链。
 * - “When you play a card from face down” 同样不可执行：card-played 载荷与 ObjectSnapshot 都不暴露
 *   “该牌此前面朝下”的特征（811.1.d；与已合入 rad/evelynn-consuming 记录同一缺口）。
 * - 两条触发都缺 CardProgram → TriggerRegistration 的注册路径（RIFT-120）。
 * 已合入并可真实执行的部分：effect.ready（ready me）与 effect.damage（deal 2 to an enemy unit），
 * golden 用解释器 + 参考内核执行。
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
    "两条触发都不可执行：(1)「When you hide a card」依赖 card-hidden 时点（422.1）真正被发出，" +
    "但合并内核没有 Hide 动作：GameAction 封闭集合里没有 hide，面朝下区域与 Hide/cost.hidden 属 RIFT-89，" +
    "没有任何模块 emit card-hidden，触发无法进链。" +
    "(2)「When you play a card from face down」需要「该牌此前在面朝下区域」的事实（811.1.d 与 Facedown Zone 口径），" +
    "当前 card-played 事件载荷与 ObjectSnapshot 都不暴露该特征（与已合入 rad/evelynn-consuming 记录同一缺口）。" +
    "两条触发还缺 CardProgram → TriggerRegistration 的注册路径（RIFT-120）。" +
    "已合入并可真实执行的部分：effect.ready（ready me）与 effect.damage（deal 2 to an enemy unit），" +
    "golden 用解释器 + 参考内核覆盖。依赖：RIFT-89（Hide/面朝下）、RIFT-120（触发注册）。不近似实现。",
  abilities,
  sourceText:
    "When you hide a card, ready me.\n" +
    "When you play a card from face down, deal 2 to an enemy unit."
} satisfies CardProgram;

export default program;
