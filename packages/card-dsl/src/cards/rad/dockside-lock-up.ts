import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Dockside Lock-Up (rad-136-167) — Unit, Order, 6 energy / 2 power / 无印刷 Might，
 * 标签 Device。
 *
 * sourceText (packages/card-data/data/deck-catalog.json, rad-136-167):
 *   "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill
 *    this.)
 *    When you play this, banish a unit here.
 *    When you hold here, kill this to play the banished card, ignoring its cost.
 *    (Tokens aren't cards.)"
 *
 * 规则依据（CR v1.5）：
 * - [Deploy]（830）：被动兼触发关键词，830.1.b 为 "This may be played or created
 *   to any battlefield"、"Play or create this only to a battlefield"、"When an
 *   opponent holds here, kill this" 的合写；830.2 多重冗余、830.3 是可引用特征。
 *   按契约 3.1 声明 keyword 能力，展开由 effects/keywords/Deploy.ts 负责（不存在）。
 * - "When you play this"：card-played 时点（420.4.a）。
 * - "banish a unit here"：Banish 是独立动作（428.1/428.2.a "Banish is not a subset
 *   of Kill"），对应 effect.banish；"a unit" 用 TargetSpec（355.10 的选目标），
 *   "here" 是同位置（本卡打出到战场后其当前位置）。
 * - "When you hold here"：Hold 触发（时点 hold；315.2.b.2 回合 Beginning 的计分步骤
 *   由回合玩家固守，471.2/473.2.b）。
 * - "kill this to play the banished card, ignoring its cost"："[do X] to [do Y]" 的
 *   指令内费用（204.3/204.3.a，355.10.c.1 "[do X] to [do Y]" 里的 X 是费用），
 *   不是可选：X 是 kill this（effect.kill 的 self 形式，429.6 的 "Kill this" 结构），
 *   Y 是 play（356.1.b.1 "ignoring its cost" 把基础能量与力量费用设为 0，356.5.a 同理）。
 *   "the banished card"：428.3 的"由同一对象放逐的牌"引用；"(Tokens aren't cards.)"
 *   是 185 "Tokens are not cards" 的提示，因此被放逐的衍生物不能被这样打出。
 *
 * 无法执行的依赖（保持 judge-required）：
 * - effects/keywords/Deploy.ts 未合入：830.1.b 的 "only to a battlefield" 限制、
 *   "not recalled in cleanups"（830.1.b.3）与"对手固守则消灭"的触发都缺实现，
 *   参考内核的 create/play 也不校验打出位置。
 * - 428.3 的"同一对象放逐的牌"引用是持久化的链接值：契约 3.6 的 ctx.link 是单次
 *   结算作用域，没有跨结算/跨触发的持久链接；程序只能用占位键
 *   （dockside-lock-up.banishedCard）标出该引用，不能被当作运行时值。
 * - "kill this to play ..." 的指令内费用（204.3）与 effect.play 需要的
 *   FinalizedCostPlan（356.5.a 的忽略全部费用）没有已注册指令/管线：cost.pay 未合入，
 *   卡牌程序无法构造最终费用计划。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deploy" },
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "dockside-lock-up.banish-unit-here",
        op: "effect.banish",
        args: {
          objects: { kind: "constant", value: { target: "dockside-lock-up.unit-here" } },
          linkKey: { kind: "constant", value: "dockside-lock-up.banishedCard" }
        },
        targets: [
          {
            id: "dockside-lock-up.unit-here",
            filter: { type: "unit", zone: "board", sameLocationAs: "self" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  },
  {
    kind: "triggered",
    trigger: { at: "hold", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "dockside-lock-up.kill-this",
        op: "effect.kill",
        args: { self: { kind: "constant", value: true } }
      },
      {
        id: "dockside-lock-up.play-banished-card",
        op: "effect.play",
        linkedTo: "dockside-lock-up.kill-this",
        args: {
          // 428.3 的"同一对象放逐的牌"是跨结算的持久引用，契约 3.6 的 ctx.link 只在
          // 单次结算作用域内；此处用 PickSpec 命名该引用的来源（同 minefield 的占位
          // 写法），不得写入运行时引用或跨能力 linked-value。
          pick: { kind: "constant", value: "dockside-lock-up.banished-card" },
          cost: { kind: "constant", value: { finalized: true, energy: 0, power: [], xp: 0 } }
        },
        picks: [
          {
            id: "dockside-lock-up.banished-card",
            options: ["the-card-this-unit-banished-with-its-play-ability"],
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
  canonicalCardId: "card.hash-165ba67b417b4ce0d002e23f14e303dcf239f2e29ae79669b7f663ffb9cfba17",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 effects/keywords/Deploy.ts（830.1.b 的 \"Play this only to a battlefield\"、" +
    "830.1.b.3 的不被召回、\"When an opponent holds here, kill this\" 都无实现）；缺" +
    "428.3 的持久化\"同一对象放逐的牌\"引用——契约 3.6 的 ctx.link 只在单次结算作用域内，" +
    "程序里用 PickSpec 命名该引用的来源作为占位（跨结算不可读）；缺 204.3 指令内费用与 356.5.a" +
    "\"ignoring its cost\" 的最终费用计划构造（cost.pay 未合入，effect.play 只接受已定案" +
    "费用）。effect.banish/effect.kill/effect.play 原语本身已合入，黄金测试按其声明形状做" +
    "隔离执行。依赖：关键词工作流（Deploy 830）、RIFT-89（费用计划）、批 4（持久链接）。",
  abilities,
  sourceText:
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "When you play this, banish a unit here.\n" +
    "When you hold here, kill this to play the banished card, ignoring its cost. (Tokens aren't cards.)"
} satisfies CardProgram;

export default program;
