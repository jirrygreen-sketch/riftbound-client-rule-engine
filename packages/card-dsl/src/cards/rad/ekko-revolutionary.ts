import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ekko, Revolutionary (rad-021-167) — Unit, 5 energy, 1 power (Fury), 4 Might,
 * tags Ekko/Zaun/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-021-167）：
 *   I enter ready.
 *   [Assault] (+1 :rb_might: while I'm an attacker.)
 *   [Action][>] Discard 1, :rb_energy_1::rb_rune_fury:: Banish me, then play me to your
 *   base, ignoring my cost.
 *
 * 规则依据（CR v1.5）：
 * - “I enter ready.”：入场状态改写（369.3 的官方示例 “Master Yi, Honed reads ‘I enter
 *   ready.’” 即把横置进场事件替换为就绪进场；单位默认横置进场见 359.2.c / 143.4）。
 *   effect.ready 的文档明确本原语不能模拟它（不是先横置再就绪，不经 “becomes ready”），
 *   所以这里用入场替代 + 规划的 replacement.enter 原语描述，不拿 effect.ready 近似。
 * - [Assault]：807.1.b.3 省略数值按 1 处理、807.1.c “while I'm an attacker”；展开由
 *   effects/keywords/Assault.ts 负责。
 * - [Action][>]（806.1.a / 813.1.d 的能力格式）：“Discard 1, :rb_energy_1::rb_rune_fury:”
 *   是启动能力的费用（423.3 弃牌作为费用必须能完成、415.3.a/415.5 横置不是本卡费用、
 *   163.1 能量、Power 用 Fury）；“Banish me, then play me to your base, ignoring my cost”
 *   是本卡自己的启动能力效果：先 banish（428.1），再把被放逐的那张牌打到基地，费用被忽略
 *   （356.1.b.1：ignoring its cost 把基础能量与基础力量费用置 0）。
 *
 * status = judge-required（见 judgeReason）：
 * 1. "I enter ready" 用的入场替代已合入（RIFT-260 的 src/replacement/ + bindReplacement，
 *    含 forms 1/2 的 static replaces 与 replacement.enter），但缺卡牌侧注册路径（RIFT-257）；
 *    effect.ready 本身只能重置已在场对象，不能模拟（359.2.c / 369.3）。
 * 2. 费用的 “Discard 1” 需要不选目标的 filter 式费用选择；CostSpec 的 choice 目前只接受
 *    逐项列出的精确 ObjectRef（cost/plan-values.ts 的 choiceObjects，实测静态占位
 *    `card-in-controller-hand` 会抛 “Cost requires an exact object reference”）；
 *    cost.pay / cost.modify 属仍在进行的 RIFT-261。
 * 3. [Assault] 展开已合入（RIFT-81），但卡牌 keyword 能力 → 展开 → 图层注册的生产方仍缺
 *    （RIFT-91），Attacker designation 也还不是 ObjectSnapshot 特征。
 * “Banish me, then play me to your base, ignoring my cost” 两段本身可用已合入的
 * effect.banish + effect.play（ignoring-cost 以 finalized 零费用计划表达，356.1.b.1）
 * 真实执行，见 golden；chain 的 Finalize 接线仍属共享工作。
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
        // 356.1.b.1 把基础能量与基础力量费用置 0（finalized 零费用计划），
        // 目的地是“your base”（打出者的基地）。
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
          location: { kind: "constant", value: { type: "base", player: "controller" } },
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
    "三处当前缺口：(1)「I enter ready」的入场替代管线已合入（RIFT-260：src/replacement/ 的 bindReplacement 支持 static replaces 与 " +
    "replacement.enter 两种入场改写，含 CR 369.3 / 359.2.c 的默认横置→就绪；golden 已用真实绑定 + ChainEngine 验证），" +
    "缺的是把 CardProgram 的 replacement 能力接进生产注册（RIFT-257）；effect.ready 本身只重置已在场对象、不能模拟 enter ready。" +
    "(2) 费用的「Discard 1」需要不选目标的 filter 式费用选择：CostSpec 的 choice 只接受逐项列出的精确 ObjectRef" +
    "（cost/plan-values.ts choiceObjects，实测静态占位会抛 “Cost requires an exact object reference”）；" +
    "cost.pay / cost.modify 属仍在进行的 RIFT-261 费用批次。(3)[Assault] 的 KeywordDef 展开已合入（RIFT-81），" +
    "但缺卡牌 keyword 能力 → 展开 → 图层注册的生产方（RIFT-257/RIFT-91），807.1.d 的 Attacker designation " +
    "也还不是 ObjectSnapshot 特征（契约 3.8 combatRole）。" +
    "可执行部分：「Banish me, then play me to your base, ignoring my cost」用已合入的 effect.banish + effect.play" +
    "（356.1.b.1 的 ignoring-cost 以 finalized 零费用计划表达）真实执行；整卡仍因上述三项保持 judge-required。",
  abilities,
  sourceText:
    "I enter ready.\n" +
    "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
    "[Action][>] Discard 1, :rb_energy_1::rb_rune_fury:: Banish me, then play me to your base, ignoring my cost."
} satisfies CardProgram;

export default program;
