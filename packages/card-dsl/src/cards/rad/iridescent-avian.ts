import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Iridescent Avian (rad-027-167) — Unit, 3 energy, no printed Power, 3 Might, Calm.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-027-167）：
 *   :rb_exhaust:: [Buff] a unit. If it's already buffed, give it +2 :rb_might: this turn
 *   instead. (To buff a unit, give it a +1 :rb_might: buff if it doesn't have one.)
 *
 * 规则依据（CR v1.5）：
 * - ":rb_exhaust:" 是启动能力的费用（376 / 377.1；415.3.a / 415.5：横置作为费用必须能
 *   完成），由费用计划支付；单位启动能力默认时机按 145.2（控制者 Main Phase）。
 * - "[Buff] a unit."：427.1 / 427.1.b.1 的 Buff 动作（放置一枚 Buff 标记，702.1）；
 *   427.1.c 明确已有 Buff 的单位仍可被选择，但不会被再次 Buff。“a unit” 选定一个具体对象，
 *   是目标（355.7 / 355.10.a）。
 * - "If it's already buffed"：427.1.b 的 “buffed” 指该单位身上有 Buff 标记，即
 *   ObjectSnapshot.buffs > 0（702.1）。结算开始时先读一次并冻结成链接值
 *   （契约 3.9 的 condition.value），之后的 Buff 放置不会改写这个判定。
 * - "give it +2 :rb_might: this turn instead."：临时 Might 修正属算术图层
 *   （continuous.might，478 / 478.1.a；143.2.a），带 “this turn” 期限（317.2.c 在回合
 *   结束清理时到期）。“instead” 由条件从句表达：契约 3.4 规定 condition 只作用于它所在的
 *   那条指令，因此 +2 只在结算时该单位已带 Buff 时生效；没有 Buff 时 effect.buff 正常放置
 *   一枚 Buff、+2 跳过——两个分支互斥。
 *
 * Status: executable —— 费用（横置自身）、effect.buff、结算时条件读取与 continuous.might
 * 都是已合入的原语/图层路径，golden 用解释器 + 参考内核真实执行两个分支，并核对时长在
 * 回合结束时到期（见 test/cards/rad/iridescent-avian.test.mjs）。
 *
 * 协调侧备注（不是本卡数据缺口）：CardProgram → ChainDraft 的 describePlay 适配器仍属
 * RIFT-257/120 的接线；本卡 IR 只用契约 3.1–3.9 的合法形状，不做断言或占位绕过。
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    // ":rb_exhaust:" — 横置自身作为费用（415.3.a / 415.5）。
    cost: { kind: "activated", payments: [{ kind: "exhaust" }] },
    timing: "action",
    body: [
      {
        // "If it's already buffed" — 结算时读一次目标的 Buff 计数并冻结成链接值。
        id: "iridescent-avian.read-buffed",
        op: "condition.value",
        args: {
          value: {
            kind: "object-attribute",
            object: { target: "iridescent-avian.unit" },
            attribute: "buffs"
          },
          key: { kind: "constant", value: "alreadyBuffed" }
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
        // "[Buff] a unit." — 427.2.a 的受指示 Buff；427.1.c：已有 Buff 的单位不会被
        // 再次 Buff（原语返回 negated/skipped，链接值 buffedCount = 0）。
        id: "iridescent-avian.buff",
        op: "effect.buff",
        linkedTo: "iridescent-avian.read-buffed",
        args: {
          mode: { kind: "constant", value: "buff" },
          target: { kind: "constant", value: "iridescent-avian.unit" }
        }
      },
      {
        // "...give it +2 :rb_might: this turn instead." — 本回合到期的 Might 修正。
        id: "iridescent-avian.plus-2",
        op: "continuous.might",
        linkedTo: "iridescent-avian.buff",
        args: {
          amount: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "end-of-turn" },
          // 选择形状用连续效果指令的 objects 拼写（契约 3.6：objects 求值结果为
          // { kind: "target", id }），与 target: "<id>" 等价但两条解释路径都支持。
          objects: {
            kind: "constant",
            value: { kind: "target", id: "iridescent-avian.unit" }
          }
        },
        // 契约 3.4：条件只作用于本条指令；判据是结算开始时冻结的 Buff 计数。
        condition: {
          kind: "compare",
          left: {
            kind: "linked-value",
            instructionId: "iridescent-avian.read-buffed",
            key: "alreadyBuffed"
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
  status: "executable" as const,
  abilities,
  sourceText:
    ":rb_exhaust:: [Buff] a unit. If it's already buffed, give it +2 :rb_might: this turn instead. " +
    "(To buff a unit, give it a +1 :rb_might: buff if it doesn't have one.)"
} satisfies CardProgram;

export default program;
