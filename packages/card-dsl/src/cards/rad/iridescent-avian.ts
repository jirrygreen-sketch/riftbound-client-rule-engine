import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Iridescent Avian (rad-027-167) — Unit, 3 energy, no printed Power, 3 Might, Calm.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-027-167）：
 *   :rb_exhaust:: [Buff] a unit. If it's already buffed, give it +2 :rb_might: this turn
 *   instead. (To buff a unit, give it a +1 :rb_might: buff if it doesn't have one.)
 *
 * 规则依据（CR v1.5）：
 * - “:rb_exhaust::” 是启动能力的费用（376 / 377.1；415.3.a / 415.5：横置作为费用必须能完成），
 *   由费用计划支付；单位启动能力默认时机按 145.2（控制者 Main Phase）。
 * - “[Buff] a unit.”：427.1 / 427.1.b / 427.1.b.1 的 Buff 动作；单位是否已有 Buff 计数
 *   决定它是否真的被 Buff（427.1.c 明确“已有 Buff 的单位仍可被选择，但不会被 Buff”）。
 * - “If it's already buffed, give it +2 :rb_might: this turn instead.”：临时 Might 修正是
 *   continuous.might（调研表第 4 节；effect.buff 的文件头明确临时 Might 修改不属于 Buff
 *   原语），带“this turn”期限（317.2.c 同时到期）。两个分支互斥（instead）。
 *
 * status = judge-required（见 judgeReason）：
 * - Buff 分支可用已合入的 effect.buff 真实执行（含 427.1.c 的“已有 Buff 不放置”）；
 * - “already buffed → +2 Might this turn” 需要临时 Might 修正原语（continuous.might / 图层），
 *   契约 3.6 的封闭 GameAction 集合没有 might 修改动作，effect.buff 文档明确把它交给
 *   layers 的 continuous.might（同 Stupefy ogn-095-298 / Frigid Touch sfd-xxx 的判定）；
 * - “instead” 要求两分支二选一，需要以当前 Buff 状态为条件的运行时分支；IR 的条件从句
 *   （契约 3.4）只作用于它所在的那条指令，可用的选择形状是 choice.mode，而 chain 的
 *   assertFinalizationSurface 明确阻断 choice.mode（“Mode choices require a
 *   Finalize/Resolve choice-plan adapter”），故不写成会被拒绝的形状，也不近似。
 * 依赖：RIFT-83/84（临时 Might 原语/图层）、RIFT-89/90（条件分支/选择计划接线）、RIFT-91。
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    // “:rb_exhaust:” — 横置自身作为费用（415.3.a / 415.5）。
    cost: { kind: "activated", payments: [{ kind: "exhaust" }] },
    timing: "action",
    body: [
      {
        // “[Buff] a unit.” — 427.2.a 的受指示 Buff；选择单位是目标（355.7/355.10.a）。
        // 427.1.c：已有 Buff 的单位仍可被选择，但不会真的被 Buff。
        id: "iridescent-avian.buff",
        op: "effect.buff",
        args: {
          mode: { kind: "constant", value: "buff" },
          target: { kind: "constant", value: "iridescent-avian.unit" }
        },
        targets: [
          {
            id: "iridescent-avian.unit",
            filter: { type: "unit", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        // “If it's already buffed, give it +2 :rb_might: this turn instead.” —
        // 临时 Might 修正（continuous.might；契约 3.6 无 might 修改动作，见 judgeReason）。
        // 条件从句只作用于本条指令（契约 3.4）：buffs 计数 > 0 即“已被 buff”。
        id: "iridescent-avian.plus-2",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "end-of-turn" },
          target: { kind: "constant", value: "iridescent-avian.unit" }
        },
        linkedTo: "iridescent-avian.buff",
        condition: {
          kind: "compare",
          left: {
            kind: "object-attribute",
            object: { target: "iridescent-avian.unit" },
            attribute: "buffs"
          },
          operator: "gt",
          right: { kind: "constant", value: 0 }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-8dc527406dd2ec53dd9af597138cb888f1548f0de5158dc5477e8c34b25afda8",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺临时 Might 修正原语与二选一分支接线：(1)「If it's already buffed, give it +2 :rb_might: this turn instead」需要 continuous.might 的临时 Might 修正在本回合到期" +
    "（effect.buff 文件头明确临时 Might 修改不属于 Buff 原语；契约 3.6 的封闭 GameAction 集合没有 might 修改动作，同 Stupefy / Frigid Touch 的判定），依赖 RIFT-83/84 + RIFT-91。" +
    "(2)「instead」要求按当前 Buff 状态在“Buff 一个单位”与“+2 Might”之间二选一：契约 3.4 的条件从句只作用于所在的那条指令，可用的选择形状 choice.mode 被 chain/engine.ts 的" +
    "assertFinalizationSurface 显式阻断（Mode choices require a Finalize/Resolve choice-plan adapter），因此没有已合入的运行时分支路径（RIFT-89/90）。" +
    "可执行部分：费用（横置自身，415.3.a/415.5）与 effect.buff 分支（含 427.1.c 已有 Buff 不放置）已真实执行，见 golden；不近似实现 +2 Might。",
  abilities,
  sourceText:
    ":rb_exhaust:: [Buff] a unit. If it's already buffed, give it +2 :rb_might: this turn instead. " +
    "(To buff a unit, give it a +1 :rb_might: buff if it doesn't have one.)"
} satisfies CardProgram;

export default program;
