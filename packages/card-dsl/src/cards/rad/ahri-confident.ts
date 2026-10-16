import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ahri, Confident (rad-038-167) — Unit, 4 energy + 1 Calm power, 4 Might.
 *
 * 原文："[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn.)\n"
 *       "When you reduce the Might of an enemy unit here by 1 or more, give me "
 *       "+1 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）：
 * - 831.1 / 831.1.b / 831.1.d：Disarm 是触发式能力关键词（Attack Trigger），功能等价于
 *   "When I attack, give an enemy unit here -X [M] this turn"；831.1.c.3：省略 X 时按 1。
 *   keyword 声明不带 value（默认 1），展开由 effects/keywords/<keyword>.ts 负责。
 * - "When you reduce the Might of an enemy unit here by 1 or more"：Might 变化时点
 *   might-changed（events/timing-points.ts，payload 含 previousMight/currentMight，709），
 *   过滤条件要求减少方向且幅度 ≥ 1、对象是"你控制的任一效果"所减少的敌方单位——原文的
 *   "you reduce" 只看动作是否由你方效果造成（契约 3.4 结算时检查行动）。
 * - "give me +1 [M] this turn"：临时 Might 修改 = arithmetic 层的持续效果，
 *   期限到本回合结束（143.2.a / 475 / continuous.duration）。
 *
 * status 判定（README 第 2 节）：judge-required。缺口（不近似实现）：
 * 1. `effects/keywords/` 没有 Disarm KeywordDef（RIFT-81~91 关键词批次只覆盖
 *    Assault/Shield/Deathknell/Legion/Ganking/Vision/Deflect/Hidden/Action/Reaction/
 *    Repeat/Accelerate/Equip/Quick-Draw/Weaponmaster/Mighty，不含 Disarm），需要调度者
 *    新增关键词任务；
 * 2. 卡牌侧没有登记临时 Might 修改的已注册原语（`continuous.might` / `continuous.duration`
 *    仍是 RIFT-91 图层与后续原语批次的规划项；已合入的 effect.buff 只放 Buff counter，
 *    不是 Might 数值修改），也没有 might-changed 事件的 payload 过滤接线；
 * 3. might-changed 的触发过滤依赖图层结算（709）与事件管线把 previousMight/currentMight
 *    交给 filter。
 * 依赖：Disarm KeywordDef（无已分配任务）、RIFT-91（layers-continuous）、RIFT-83
 * （trigger/事件过滤接线同批）。
 */

const abilities: Ability[] = [
  // 831.1.c.3：印刷未写 X，Disarm 值为 1，故 keyword 声明省略 value。
  { kind: "keyword", keyword: "disarm" },
  {
    kind: "triggered",
    trigger: {
      at: "might-changed",
      filter: {
        event: "might-changed",
        filter: {
          type: "unit",
          controller: "opponent",
          // "here"：与来源同在 Battlefield Zone / Base（464.2.b 的 here referent）。
          sameLocationAs: "self",
          // 709 的 must 方向：只统计减少，且至少 -1。
          mightChanged: "decreased",
          amount: { gte: 1 }
        }
      }
    },
    optional: false,
    body: [
      {
        id: "ahri-confident.give-me-might",
        // 临时 Might 修改（arithmetic 层 + 本回合结束到期）；原语未注册，见 judgeReason。
        op: "continuous.might",
        args: {
          mode: { kind: "constant", value: "add" },
          layer: { kind: "constant", value: "arithmetic" },
          amount: { kind: "constant", value: 1 },
          duration: { kind: "constant", value: "end-of-turn" },
          target: { kind: "constant", value: "ahri-confident.self" }
        },
        targets: [
          {
            id: "ahri-confident.self",
            filter: { type: "unit", object: "self" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-b5c30bb9570eb87f81c02526593c66f04d242c43ca13f9e3f0e38ed148fe62c1",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 Disarm KeywordDef：effects/keywords/ 没有 Disarm 文件（831.1 的展开是攻击触发 + 临时 " +
    "Might 修改），RIFT-81~91 关键词批次也不含 Disarm，需要新增关键词任务。" +
    "「give me +1 [M] this turn」还需要已注册的临时 Might 修改原语（continuous.might + " +
    "continuous.duration，143.2.a/475；effect.buff 只放 Buff counter，不修改 Might），" +
    "以及 might-changed 事件的 payload 过滤接线（709）。依赖：Disarm KeywordDef（无已分配任务）、" +
    "RIFT-91（layers-continuous）。不近似实现：不使用 Buff counter 代替 Might 修改。",
  abilities,
  sourceText:
    "[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn.)\n" +
    "When you reduce the Might of an enemy unit here by 1 or more, give me +1 :rb_might: this turn."
} satisfies CardProgram;

export default program;
