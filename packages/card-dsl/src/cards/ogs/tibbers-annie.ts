import type { CardProgram } from "../../ir/index.js";

/**
 * Tibbers, Annie (ogs-018-024) — Unit, 8 energy / 2 power (Fury/Chaos), Might 7.
 *
 * sourceText (deck-catalog.json, ogs-018-024, verbatim):
 *   "When you play me, deal 3 to all units at battlefields."
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a："When you play me" 是 Play Effect（打出完成后进链，420.4.a）；时点用
 *   card-played，filter 指向本卡。
 * - 355.10.d：按特征程序化选出的对象不算目标；"Kill all units at battlefields"
 *   明确 "doesn't target anything"，因此"deal 3 to all units at battlefields" 是无选择
 *   集合，不选目标、不触发 became-target（355.7、754）。
 * - 418.1.c/418.1.d：伤害分别标记在每个单位上，并且可以同时造成。
 *
 * 状态：judge-required。已合入的 effect.damage 只接受 TargetSpec id 并通过 ctx.targets
 * 读取 Finalize 锁定的目标组，解释器也会把 instruction.targets 一律按目标组处理
 * （进入 became-target 流程）；本卡是 355.10.d 的"无选择集合"，两者不可互换。
 * 缺的是 effect.damage 的"非目标集合"选择符——effect.ready 已有 { kind: "query", filter }
 * 形状可作参照，effect.damage 没有；也没有其它已合入原语能对无选择集合结算伤害。
 * 用 targets + selection "all" 会把非目标集合写成目标组，属被禁止的近似实现。
 * 本文件因此不写 instruction.targets，只把 355.10.d 的集合写进指令参数描述。
 */
export default {
  canonicalCardId: "card.hash-71a433d035b3ceed303ac22a2952e428f4da5dc252f95947d82c3325d1b6f0e1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺非目标集合伤害路径：deal 3 to all units at battlefields 按 355.10.d 是按特征程序化" +
    "选出的无选择集合，不选目标、不触发 became-target；已合入的 effect.damage 只接受 " +
    "TargetSpec id 并经 ctx.targets 读取，解释器又会把 instruction.targets 一律当目标组，" +
    "没有 effect.ready 的 { kind: query, filter } 那样针对无选择集合的选择符；" +
    "用 targets 加 selection all 会把非目标集合写成目标组，属禁止的近似实现。" +
    "依赖：原语批次（effect.damage 的 query 选择符）与 RIFT-120（链/事件单管线）的集合结算。" +
    "不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { self: true } },
      optional: false,
      body: [
        {
          id: "tibbers-annie.damage-all-at-battlefields",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 3 },
            setFilter: {
              kind: "constant",
              value: { type: "unit", zone: "board", locationType: "battlefield" }
            }
          }
        }
      ]
    }
  ],
  sourceText: "When you play me, deal 3 to all units at battlefields."
} satisfies CardProgram;
