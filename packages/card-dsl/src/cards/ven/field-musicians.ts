import type { CardProgram } from "../../ir/index.js";

/**
 * Field Musicians (ven-026-166) — Unit, 4 Energy（无印刷 Power），3 Might,
 * Calm, Ionia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-026-166，逐字）：
 *   When you play me, give a unit +3 :rb_might: this turn.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a / 383.4.a.1 / 420.4.a：“When you play me” 是 Play Effect，在打出完成后进链，
 *   时点为封闭的 "card-played"，filter 用契约 3.6 的符号选择器 { source: "self" } 指向自身。
 * - 355.5 / 355.7 / 355.9.a.1 / 355.10：“a unit” 是控制者在 Finalize 选择的一个具体对象
 *   （未特别说明时指 Board 上的单位），因此是 TargetSpec，不是 pick。
 * - 143.2.a / 475–477：“+3 Might this turn” 是带回合期限的临时 Might 修正，属算术图层的
 *   持续效果（continuous.might），本回合结束时到期（315.4 / 317 的清理流程）。
 * - 702 / 703：Buff 是计数器（各 +1 Might、每单位一个），与本卡的 +3 临时修正不是同一机制——
 *   effect.buff 文件头也明确“临时 Might 修改归 continuous.might，不属于本原语”，因此不写成 Buff。
 *
 * status = executable：card-played 触发、目标选择、continuous.might 原语和本回合结束期限
 * 都已有生产解释器/图层执行路径；golden 通过真实 body 结算并检查目标与期限。
 */
export default {
  canonicalCardId: "card.hash-08498917b444057f23afae275c8776d4bff33d47135466ce826cff2b935cea29",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          id: "field-musicians.give-plus-3-might",
          // 临时 Might +3（算术图层，本回合结束到期）。
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "end-of-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "field-musicians.unit" }
            }
          },
          targets: [
            {
              // “a unit”：控制者选择的一个 Board 单位（355.9.a.1、355.10）。
              id: "field-musicians.unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When you play me, give a unit +3 :rb_might: this turn."
} satisfies CardProgram;
