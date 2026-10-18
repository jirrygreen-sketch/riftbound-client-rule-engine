import type { CardProgram } from "../../ir/index.js";

/**
 * Durand Memorial (rad-161-167) — Battlefield, Colorless.
 *
 * 原文（packages/card-data/data/deck-catalog.json，sourceText 逐字）：
 *   "When you defend here, choose a unit you control here. Give it [Tank] this
 *    combat. (It must be assigned combat damage first.)"
 *
 * 规则依据（CR v1.5）：
 * - 383.2 / 383.4.d：防御宣言时点的触发能力（Triggered Ability）；"here" 指本战场，
 *   "you" 指该战场能力的控制者（190.6.d）。
 * - 355.5 / 355.7 / 355.10："choose a unit you control here" 在 Finalize 选择，
 *   既不是费用也不是 pick，因此是 TargetSpec。
 * - 815 / 815.1.b / 815.1.c：Tank 是被动战斗伤害指派要求；"this combat" 对应
 *   end-of-combat 期限（317.2.c 的到期时点，激战结束）。
 *
 * status = judge-required（2026-10-18 第四轮复核，逐项实测，不近似实现）：
 * 1. defense-declared 触发仍绑定不了：translateTriggerFilter 对触发的 here 字段抛
 *    "Unsupported filter field here"（programs/filters.ts 的允许字段表里没有 here），
 *    因此 registerProgramTriggers 直接以 ProgramBindingError 失败，生产注册路径不可达。
 * 2. 目标过滤器的 sameLocationAs 同样被 translateObjectFilter 拒绝
 *    （"Unsupported filter field sameLocationAs"），触发的 Finalize 目标计划取不到候选；
 *    解释器侧的 sameLocationAs 锚点（effects/interpreter/selectors.ts）本身是可执行的。
 * 3. defense-declared 时点没有事件发射方：combat/flow.ts 仍在 staged combat 抛
 *    combat-start-transaction（docs/rules/timing-point-producers.md 记为「待后续」），
 *    角色指定transaction 未实现，ObjectSnapshot.combatRole 无生产方。
 * 4. Tank 的消费方缺失：combat/base-combat-allocation.ts 自述
 *    "No Tank/Backline/other assignment-priority requirement is bound here"，
 *    615.1.c.1/c.2 的致命伤害优先指派没有实现；continuous.grant-keyword 只负责登记
 *    关键词（授予与 end-of-combat 到期已有真实执行证据），不能代替伤害指派规则。
 */
export default {
  canonicalCardId: "card.hash-97d6652832570169cee7f8ada60deed43c5e7d3c133950eed2de4fe1f0818f76",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(2026-10-18 第四轮复核实测) 四处当前缺口，均不近似实现：" +
    "(1) defense-declared 触发绑定失败：translateTriggerFilter 对触发的 here 抛 \"Unsupported filter field here\"，" +
    "registerProgramTriggers 因此以 ProgramBindingError 失败，生产注册路径不可达（CR 383.4.d / 466.2.c）。" +
    "(2) 目标过滤器的 sameLocationAs 同样被 translateObjectFilter 拒绝（\"Unsupported filter field sameLocationAs\"），" +
    "Finalize 目标计划取不到候选；解释器侧的 sameLocationAs 锚点本身可执行（CR 355.5 / 355.10）。" +
    "(3) defense-declared 时点没有事件发射方：combat/flow.ts 在 staged combat 抛 combat-start-transaction，" +
    "角色指定 transaction 未实现，ObjectSnapshot.combatRole 无生产方。" +
    "(4) Tank 消费方缺失：combat/base-combat-allocation.ts 自述 \"No Tank/Backline/other assignment-priority requirement is bound here\"，" +
    "815.1.c.1/c.2 的致命伤害优先指派没有实现；continuous.grant-keyword 的授予与 end-of-combat 到期" +
    "已有真实执行证据，但不能代替伤害指派规则。",
  sourceText:
    "When you defend here, choose a unit you control here. Give it [Tank] this combat. (It must be assigned combat damage first.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "defense-declared",
        filter: { event: "defense-declared", here: true, player: "self" }
      },
      optional: false,
      body: [
        {
          id: "durand-memorial.grant-tank",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Tank" },
            duration: { kind: "constant", value: "end-of-combat" },
            objects: { kind: "constant", value: { kind: "target", id: "durand-memorial.chosen-unit" } }
          },
          targets: [
            {
              id: "durand-memorial.chosen-unit",
              filter: {
                type: "unit",
                controller: "controller",
                zone: "board",
                sameLocationAs: "self"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;
