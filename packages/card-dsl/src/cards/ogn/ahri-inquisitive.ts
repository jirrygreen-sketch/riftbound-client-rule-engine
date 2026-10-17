import type { CardProgram } from "../../ir/index.js";

/**
 * Ahri, Inquisitive (ogn-119-298) — Unit, 3 energy + 1 Mind power, Might 3，
 * 标签 Ahri / Ionia / Champion。
 *
 * 原文：When I attack or defend, give an enemy unit here -2 :rb_might: this turn,
 *      to a minimum of 1 :rb_might:.
 *
 * 规则依据（CR v1.5）：
 * - 攻击 / 防守触发：383.4.e.1（"When I attack …"）与 383.4.f.1（"When I defend …"）；
 *   383.4.e.2.a / 383.4.f.2.a 要求每次战斗只检查一次触发条件 → 两个能力各自
 *   once: "per-combat"。两个能力是同一句话的两个触发条件，各自独立入链。
 * - "an enemy unit here"：一张敌方单位，是选目标（355.9.b 的 "enemy unit" 例、
 *   355.10）；"here" 是 359.3.f 的指称（referents），在指令执行时读取来源当前位置，
 *   用 sameLocationAs: "source"（359.3.f.2 / 359.3.f.2.a：执行时目标不合法则
 *   referent 返回 null、相关指令被忽略）。
 * - "give … -2 [M] this turn, to a minimum of 1"：临时 Might 修正，属
 *   continuous.might + 本回合期限 + 下限钳制，见 judgeReason。
 *
 * 状态：judge-required。continuous.might 已可执行；生产路径仍缺 CR 466.2
 * 的战斗开启/攻防身份事务及 attack-declared / defense-declared 发射。
 * here 的 sameLocationAs:source 仍被目标绑定层拒绝；替代的 TargetSpec.location
 * location-of/source 虽有内核实现，validateCardProgram 尚把它当 location filter
 * 并拒绝该 kind，不能绕过共享校验器迁移。golden 仅验证解释器子效果。
 */
const ahriInquisitive = {
  canonicalCardId: "card.hash-c68ef91624a369cffdc5c5e3f81ab2700878a51de07b1cde21bbfc25db8dea10",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 attack-declared / defense-declared 的真实发射：combat/flow.ts 仍以 combat-start-transaction 阻断 CR 466.2 的战斗开启与攻防身份事务（383.4.e.2/383.4.f.2）。另缺 continuous.might 目标的动态 here 绑定：programs/filters.ts 拒绝 sameLocationAs:source；替代的 TargetSpec.location location-of/source 虽有 target-plan 内核实现，validateCardProgram 仍按 LocationFilter 校验并报 invalid-location-kind。translateTriggerFilter 的 self 翻译不补足这些缺口（CR 359.3.f.2），需同步共享目标校验与绑定契约。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: { event: "attack-declared", filter: { source: "self" } },
        once: "per-combat"
      },
      optional: false,
      body: [
        {
          id: "ahri.debuff-attack",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -2 },
            duration: { kind: "constant", value: "this-turn" },
            minimum: { kind: "constant", value: 1 },
            // RIFT-258 的 continuous.might：objects 用契约 3.6 的 target 选择符
            // 指名 Finalize 锁定的目标（与已合入的 smoke-screen / siphon-power 同形）。
            objects: {
              kind: "constant",
              value: { kind: "target", id: "ahri.enemy-unit-here" }
            }
          },
          targets: [
            {
              id: "ahri.enemy-unit-here",
              // The interpreter resolves this live anchor; production binding
              // and symbolic target-location validation remain blocked.
              filter: {
                type: "unit",
                controller: "opponent",
                sameLocationAs: "source"
              },
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
      trigger: {
        at: "defense-declared",
        filter: { event: "defense-declared", filter: { source: "self" } },
        once: "per-combat"
      },
      optional: false,
      body: [
        {
          id: "ahri.debuff-defense",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -2 },
            duration: { kind: "constant", value: "this-turn" },
            minimum: { kind: "constant", value: 1 },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "ahri.enemy-unit-here" }
            }
          },
          targets: [
            {
              id: "ahri.enemy-unit-here",
              // The interpreter resolves this live anchor; production binding
              // and symbolic target-location validation remain blocked.
              filter: {
                type: "unit",
                controller: "opponent",
                sameLocationAs: "source"
              },
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
    "When I attack or defend, give an enemy unit here -2 :rb_might: this turn, to a minimum of 1 :rb_might:."
} satisfies CardProgram;

export default ahriInquisitive;
