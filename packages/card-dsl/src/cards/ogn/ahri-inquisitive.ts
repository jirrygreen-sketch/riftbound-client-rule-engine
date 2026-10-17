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
 * 状态：judge-required。效果本体已可执行：已合入的 continuous.might（RIFT-258）
 * 按 478/479.4.b 注册 arithmetic 层减法并快照印刷下限、按 this-turn 在回合末到期
 * （317.1.a/468.7.c），golden 用解释器与参考内核真实执行（含同位置目标合法性、
 * 最低 1 的逐条钳制与到期）。触发绑定也已合入（RIFT-257，programs/triggers.ts +
 * filters.ts 的 translateTriggerFilter，能把本卡嵌套 { filter: { source: 'self' } }
 * 拼写翻译成 object:{objectId:宿主} 并通过 assertTriggerSpec；instruction 目标
 * 过滤的 sameLocationAs 锚点仍不被 programs/filters.ts 的绑定翻译路径接受）。
 * 仍缺的是触发发射本身：
 * attack-declared / defense-declared（383.4.e.1 / 383.4.f.1）没有发射方——
 * combat/flow.ts 的宣告事务仍以 combat-start-transaction 显式阻断（CR 466.2）。
 *
 * 依赖：RIFT-120（链/事件与战斗宣告事务）。
 */
const ahriInquisitive = {
  canonicalCardId: "card.hash-c68ef91624a369cffdc5c5e3f81ab2700878a51de07b1cde21bbfc25db8dea10",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "效果本体已合入并可执行：「give an enemy unit here -2 :rb_might: this turn, to a minimum of 1 :rb_might:」由 RIFT-258 的 continuous.might" +
    "注册 arithmetic 层效果（478/479.4.b：施加时快照印刷下限 1 的逐条钳制），按 this-turn 到期（317.1.a/468.7.c），" +
    "golden 经解释器 + 图层引擎真实执行并断言登记、最低下限、同位置目标合法性（359.3.f）与到期。" +
    "触发绑定也已合入（RIFT-257，programs/triggers.ts + filters.ts 的 translateTriggerFilter 能把本卡嵌套" +
    " { filter: { source: 'self' } } 拼写翻译成 object:{objectId:宿主} 并通过 assertTriggerSpec；" +
    "instruction 目标过滤的 sameLocationAs 锚点仍不被 programs/filters.ts 的绑定翻译路径接受）。" +
    "仍缺：attack-declared / defense-declared 的发射方——combat/flow.ts 的宣告事务仍被 combat-start-transaction 阻断" +
    "（CR 466.2）。依赖：RIFT-120（链/事件与战斗宣告事务）。不近似实现。",
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
              // sameLocationAs 锚点：IR 校验接受；kernel 环境的 queryObjects 真实解析；
              // programs/filters.ts 的绑定翻译路径尚未接受（见 judgeReason）。
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
              // sameLocationAs 锚点：IR 校验接受；kernel 环境的 queryObjects 真实解析；
              // programs/filters.ts 的绑定翻译路径尚未接受（见 judgeReason）。
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
