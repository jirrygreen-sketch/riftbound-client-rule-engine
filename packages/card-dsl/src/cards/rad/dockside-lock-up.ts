import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * dockside-lock-up — Core Rules v1.5; see judgeReason for the current execution gaps.
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
    trigger: { at: "hold", filter: { event: "hold", here: true, player: "controller" } },
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
    "CR 428.3：缺按来源入区身份持久保存、跨 card-played/hold 结算读取且排除衍生物的放逐牌关联；ctx.link 仅覆盖本次结算。CR 830.1.b/355.5：programs/statics.ts 的 layerFor 未映射 Deploy 的 continuous.location，programs/filters.ts 未绑定 hold 的 here 与目标 sameLocationAs；解释器的位置锚点已支持，但生产触发/Finalize 不可达。CR 204.3/356.1.b.1：kill→linkedTo play 不是费用作用域，negated 的 kill 不会阻止 play；还缺关联牌忽略基础费用的 Finalize 计划适配，不能用常量 finalized 零计划替代。",
  abilities,
  sourceText:
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "When you play this, banish a unit here.\n" +
    "When you hold here, kill this to play the banished card, ignoring its cost. (Tokens aren't cards.)"
} satisfies CardProgram;

export default program;
