import type { CardProgram } from "../../ir/index.js";

/**
 * Icevale Archer (unl-065-219) — Unit，2 能量、无印刷 Power、Might 2，Mind / Freljord。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-065-219，逐字）：
 *   When I attack, you may pay :rb_energy_1: to give a unit here -1 :rb_might:
 *   this turn.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.e / 466.2.c："When I attack" 是攻击触发，时点取封闭枚举里的
 *   attack-declared。
 * - 355.9 / 355.9.a.1："a unit here" 是选目标（Board 上的单位；英文没有
 *   friendly/enemy，故不写控制者限制）。"here" 指来源当前位置（053.3），用契约
 *   3.6 的 sameLocationAs 锚点表达，由解释器在结算时按来源位置解析。
 * - 383.3.a / 383.3.b："you may pay :rb_energy_1:" 位于效果开头，是触发能力的
 *   基础费用，在 Finalize 时决定是否支付（383.3.b.1：未支付则该触发不进链）。
 *   冻结 IR 的 triggered ability 没有 cost 字段（契约 3.1），因此这里用
 *   optional: true 表达「由控制者在 Finalize 决定是否执行」，费用本身见 judgeReason。
 * - 122.5：-1 :rb_might: 是临时数值修正，归 continuous.might 图层（effect.buff 的
 *   边界注释明确临时 Might 修改不进 Buff 原语），期限为 "this turn"。
 *
 * status = judge-required（2026-10-17 三度复核，缺口不近似实现）：
 * 1. attack-declared 仍无发出方：该 id 只出现在 events/timing-points.ts 与
 *    events/trigger-spec.ts 的封闭枚举里；combat/flow.ts 的 Combat start 角色事务仍是
 *    TurnCombatBlockedError('combat-start-transaction')（CR 466.2），所以真实内核里既没有
 *    Attacker/Defender 指派也没有该时点，触发不可达。原依赖任务号（引擎批 5）已并入
 *    枚举与 CombatFlow 骨架，剩下的正是这个事务本身。
 * 2. body 目标过滤的 sameLocationAs（"a unit here"，053.3）仍被 programs/filters.ts 的
 *    translateObjectFilter 拒绝（实测 ProgramBindingError judge-required
 *    "Unsupported filter field sameLocationAs"），触发在注册阶段即 fail-closed、
 *    pipeline 触发器数为 0。layers/statics.ts 已能解析静态 sameLocationAs，但目标翻译层
 *    尚未接线，故不能把 "a unit here" 近似成无地点限制的 unit。
 * 3. 前导可选 Energy 费用（383.3.b）仍无承载：契约 3.1 的 TriggeredAbility 没有 cost
 *    槽位，programs/triggers.ts 也不把前导费用提升为 TriggerRegistration.cost /
 *    mayAtFinalize（实测 registration 没有 cost / mayAtFinalize），因此 Finalize 不会做
 *    383.3.b 的支付检查；cost.pay 与已合入的链上费用计划都无法被本卡的触发声明
 *    调用。能力只用 optional: true 表达 Finalize 决定，不把费用写成事后指令。
 * 依赖（当前真实缺口）：Combat start 角色事务、目标翻译层 sameLocationAs、触发前导费用
 * 的程序适配（TriggeredAbility.cost / programs/triggers.ts）。
 *
 * 执行证据（模板层，2026-10-17）：
 * packages/card-dsl/test/cards/templates/triggered-attack-declared-continuous-mig-705.test.mjs
 * 覆盖：本卡正文的 -1 Might 注册（arithmetic、end-of-turn）与无合法对象时的
 * ignored mistargeted；生产注册的 fail-closed（ProgramBindingError judge-required、
 * Unsupported filter field sameLocationAs、触发器 0）；触发声明未被提升为
 * registration.cost / mayAtFinalize（实测为 undefined）；以及攻击时点发射但正文不生效的边界。
 */
const icevaleArcher = {
  canonicalCardId: "card.hash-cfa683e56408938bf27747d5d9dcb341900100c1cc87f15bd487c270cd7b2dee",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处实测缺口，均不近似实现：(1) attack-declared 仍无发出方——combat/flow.ts 的 Combat start 角色事务" +
    "仍是 TurnCombatBlockedError(\"combat-start-transaction\")（CR 466.2），真实内核没有 Attacker/Defender 指派，" +
    "触发不可达；" +
    "(2) body 目标过滤的 sameLocationAs（a unit here，053.3）仍被 programs/filters.ts 的 translateObjectFilter 拒绝" +
    "（实测 ProgramBindingError judge-required「Unsupported filter field sameLocationAs」，触发注册 fail-closed、" +
    "pipeline 触发器数为 0）；continuous.might 本体已可执行（objects 选择约定，见模板层）" +
    "test/cards/templates/triggered-attack-declared-continuous-mig-705.test.mjs；" +
    "(3) 前导可选 1 能量费用（383.3.b）无承载：契约 3.1 的 TriggeredAbility 没有 cost 槽位，" +
    "programs/triggers.ts 也不把前导费用提升为 TriggerRegistration.cost/mayAtFinalize" +
    "（实测 registration.cost 与 registration.mayAtFinalize 均为 undefined），Finalize 不会做 383.3.b 的支付检查；" +
    "链上费用计划已合入但本卡的触发声明接不进去——能力只用 optional: true 表达 Finalize 决定，" +
    "不把费用写成事后指令。当前依赖：Combat start 角色事务、目标翻译层 sameLocationAs、" +
    "触发前导费用的程序适配（TriggeredAbility.cost / programs/triggers.ts）。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: { event: "attack-declared", filter: { source: "self" } }
      },
      // 383.3.a/383.3.b："you may pay" 在效果开头，由控制者在 Finalize 决定是否执行该触发。
      optional: true,
      body: [
        {
          id: "icevale-archer.give-minus-1",
          // 临时 Might 修正属 continuous.might（见 judgeReason 第 2 点）。选择用
          // 合并原语的 objects 约定表达（smoke-screen / back-alley-bar 同形）；
          // 写成 args.target 时解释器把 Expr 当规格 id 传给 ctx.targets()，
          // 实测返回空集（ignored mistargeted），不新增规则语义。
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -1 },
            duration: { kind: "constant", value: "this-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "icevale-archer.unit-here" }
            }
          },
          targets: [
            {
              id: "icevale-archer.unit-here",
              // "a unit here"：任何一方的单位，只要与来源同地点（355.9.a.1、053.3）。
              filter: { type: "unit", zone: "board", sameLocationAs: "source" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "When I attack, you may pay :rb_energy_1: to give a unit here -1 :rb_might: this turn."
} satisfies CardProgram;

export default icevaleArcher;
