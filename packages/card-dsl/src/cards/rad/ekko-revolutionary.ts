import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * ekko-revolutionary — Core Rules v1.5; see judgeReason for the current execution gaps.
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    // “I enter ready.” — 被替代事件是本单位横置进场（369.3 / 359.2.c）。
    replaces: { event: "object-enters-board", filter: { source: "self" } },
    with: [
      {
        id: "ekko.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  },
  { kind: "keyword", keyword: "assault" },
  {
    kind: "activated",
    // “[Action][>] Discard 1, :rb_energy_1::rb_rune_fury::”
    timing: "action",
    cost: {
      kind: "activated",
      energy: { kind: "constant", value: 1 },
      power: { kind: "constant", value: ["Fury"] },
      payments: [
        {
          // “Discard 1” — 费用式弃牌（423.3），选项只存在于 Finalize，静态卡程序
          // 写不出精确引用（见 judgeReason）。
          kind: "discard",
          amount: { kind: "constant", value: 1 },
          choice: {
            id: "ekko.discarded-card",
            options: ["card-in-controller-hand"],
            min: 1,
            max: 1,
            selection: "one",
            zone: "hand",
            owner: "controller"
          }
        }
      ]
    },
    body: [
      {
        // “Banish me” — 428.1：从任意区域放入 Banishment；linkKey 供下一条指令读取
        // 被放逐后的新引用（124：跨区后旧引用失效）。
        id: "ekko.banish-self",
        op: "effect.banish",
        args: {
          objects: { kind: "literal", value: "self" },
          linkKey: { kind: "constant", value: "ekko.banished" }
        }
      },
      {
        // “then play me to your base, ignoring my cost.” — 420.3 的游戏效果 Play；
        // 356.1.b.1 只忽略基础能量与力量；下面的零费用是待 Finalize 适配的
        // 占位，不能替代完整费用计划。目的地默认是打出者的基地。
        id: "ekko.play-from-banishment",
        op: "effect.play",
        linkedTo: "ekko.banish-self",
        args: {
          object: {
            kind: "linked",
            instructionId: "ekko.banish-self",
            // effect.play 的 object 必须是求值为单个 ObjectRef 的表达式；
            // banish 的 receipt 里 <linkKey>Object 正是“唯一结果引用”（本卡只放逐自身，
            // 数量恒为 1），数组形式 <linkKey>Objects 不被 effect.play 接受。
            key: "ekko.banishedObject"
          },
          cost: {
            kind: "constant",
            value: { finalized: true, energy: 0, power: [], xp: 0 }
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-8a2cf1027c6f770452bef4d4eacd322301ebafc77620d3a76b855446639089e8",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "CR 423.3/355.10.c：activation 的 Discard 1 仍缺 filter 式非目标费用选择，cost/plan-values.ts 的 choiceObjects 只接受精确 ObjectRef（RIFT-358）。CR 807.1.c/807.1.d.1：Assault 展开读取 designation，但 ObjectSnapshot 实际提供 combatRole；缺关键词条件到该战斗角色的绑定（RIFT-359），不能把 combatRole 缺失或防守误作攻击。CR 356.1.b.1：还需把忽略基础费用的 CostPlan 适配为 effect.play/Chain Finalize 消费的费用形状；现有常量 finalized 零计划只作占位，不能跳过其他费用调整。replacement、activation 和 static 的程序绑定均已合入。",
  abilities,
  sourceText:
    "I enter ready.\n" +
    "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
    "[Action][>] Discard 1, :rb_energy_1::rb_rune_fury:: Banish me, then play me to your base, ignoring my cost."
} satisfies CardProgram;

export default program;
