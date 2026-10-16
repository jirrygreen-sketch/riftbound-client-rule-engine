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
 * 状态：judge-required。两个触发能力（attack-declared / defense-declared + here
 * 目标过滤 + once per combat）结构与目标合法性都能在已合入的解释器里执行，但
 * -2 Might 不能：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effect.buff
 * 文档明确临时 Might 修改归 continuous.might（702–705 的 Buff counter 是 +1 Might
 * 且每单位限一个，与 -2 不同）；图层消费者与期限（RIFT-91）未合入，
 * "to a minimum of 1" 的钳制也没有实现路径。按红线不做近似实现。
 *
 * 依赖：RIFT-91（layers-continuous：continuous.might + continuous.duration）。
 */
const ahriInquisitive = {
  canonicalCardId: "card.hash-c68ef91624a369cffdc5c5e3f81ab2700878a51de07b1cde21bbfc25db8dea10",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「give an enemy unit here -2 :rb_might: this turn, to a minimum of 1 :rb_might:」需要 continuous.might 图层减法" +
    "（契约 3.6 封闭 GameAction 无 Might 修改动作；effect.buff 是 702–705 的 +1 Buff counter，不能替代 -2 Might）" +
    "以及本回合到期（continuous.duration）与「最低 1」钳制；layers/continuous 消费者（RIFT-91）未合入。" +
    "触发结构（attack-declared / defense-declared + here 目标过滤 + once per combat，383.4.e/f 与 359.3.f）可表达并有执行测试。" +
    "依赖：RIFT-91。",
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
            // 与已合入的 Might 修正形状一致（frigid-touch / stupefy / punch-first）：
            // target 是 TargetSpec id 的字面值。
            target: { kind: "constant", value: "ahri.enemy-unit-here" }
          },
          targets: [
            {
              id: "ahri.enemy-unit-here",
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
            target: { kind: "constant", value: "ahri.enemy-unit-here" }
          },
          targets: [
            {
              id: "ahri.enemy-unit-here",
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
