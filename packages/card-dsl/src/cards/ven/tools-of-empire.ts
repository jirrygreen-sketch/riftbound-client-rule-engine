import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Tools of Empire (ven-077-166) — Gear, 4 Energy, no printed Power, no Might,
 * Body, no tags.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-077-166，逐字）：
 *   "[Empower] :rb_energy_2: (:rb_energy_2:: Empower this. Use only if not Empowered.)
 *    :rb_exhaust:: Give a unit +2 :rb_might: this turn. If this is [Empowered],
 *    give that unit +4 :rb_might: this turn instead."
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1.c / 827.1.c.1：Empower 是启动式能力关键词，本卡印刷费用 2 Energy，
 *   功能等价于 "2: Empower this. 仅当未 Empowered 时启动"；827.1.b.1：来源不是目标。
 * - 151 / 151.2：Gear 的 ":rb_exhaust:" 启动能力；415.3.a / 415.5：横置自身作为费用。
 * - "Give a unit +2 :rb_might: this turn"：临时 Might 修正属 layers 的
 *   continuous.might（317.2.c 本回合到期；433.1.a 的算术层调制）。effect.buff 的文件头
 *   明确"gets +N Might this turn"不属于 Buff 计数器（702 的 Buff 是 +1 Might 的计数器）。
 *   355.7 / 355.9.a.1："a unit" 指场上单位，是 Target（355.10.a）。
 * - 828.1 / 828.1.b.1 / 828.1.c："If this is [Empowered] … instead" 是 Empowered 状态
 *   门控的替换分支，两条 Might 数值在同一效果组内二选一。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. [Empower] 的 KeywordDef 展开尚未提供，启动费用和“仅当未 Empowered 时启动”的门控仍缺执行路径。
 * 2. “If this is [Empowered] … instead” 依赖 Empowered 状态条件谓词（进行中的 RIFT-359）；
 *    因而 +4 分支不能在运行时与 +2 分支互斥判定。
 * continuous.might、横置费用和单位 TargetSpec 已合入；golden 直接执行 +2 分支并验证图层登记，
 * 缺依赖记 test.todo；不把 +4 写成无条件、不把 instead 丢掉，也不用 Buff 计数近似。
 * 依赖：Empower KeywordDef 展开、RIFT-359 Empowered 条件谓词。
 */
const abilities: Ability[] = [
  {
    // 827.1.c：印刷费用为 2 Energy；只声明关键词身份，展开归关键词注册表。
    kind: "keyword",
    keyword: "empower",
    value: 2
  },
  {
    kind: "activated",
    // Gear 启动能力默认 Action 时机（151.2）；费用是横置自身（415.3.a/415.5）。
    timing: "action",
    cost: { kind: "activated", payments: [{ kind: "exhaust", object: "self" }] },
    body: [
      {
        // "Give a unit +2 :rb_might: this turn." — 临时 Might 修正（continuous.might +
        // 本回合期限）。该 op 已通过 ResolveContext.addContinuous 注册图层效果；整卡仍受
        // Empowered 分支缺口阻塞。
        id: "tools-of-empire.give-2-might",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "end-of-turn" },
          // 与已合入的 Might 修正形状一致：target 指向 TargetSpec id。
          objects: {
            kind: "constant",
            value: { kind: "target", id: "tools-of-empire.unit" }
          }
        },
        targets: [
          {
            id: "tools-of-empire.unit",
            // "a unit"（355.9.a.1：默认指场上的单位），选择一个，是 Target（355.10.a）。
            filter: { type: "unit", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        // "If this is [Empowered], give that unit +4 :rb_might: this turn instead." —
        // 同一被选单位的 Empowered 替换分支；"that unit" 复用前一条指令的 TargetSpec
        // （355.10.c 的指称不是新选择），经 { target } 选择器读取。
        id: "tools-of-empire.give-4-might-instead",
        op: "continuous.might",
        linkedTo: "tools-of-empire.give-2-might",
        args: {
          amount: { kind: "constant", value: 4 },
          duration: { kind: "constant", value: "end-of-turn" },
          objects: {
            kind: "constant",
            value: { kind: "target", id: "tools-of-empire.unit" }
          }
        },
        condition: {
          kind: "expression",
          value: { kind: "constant", value: "is-empowered" }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-df9284be653b8dfcd7b469fd3cf3f242aabebe0a2a123738ad9225ede8828b1c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) [Empower] 的 KeywordDef 展开尚未提供，827.1.c.1 的启动费用与“仅当未 Empowered 时启动”门控无执行路径；" +
    "(2)“If this is [Empowered] … instead” 依赖进行中的 RIFT-359 Empowered 状态条件谓词，因而 +4 分支不能与 +2 分支互斥判定。" +
    "continuous.might、横置费用和单位 TargetSpec 已合入，golden 直接执行 +2 分支并验证 end-of-turn 图层登记；不近似实现。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_2: (:rb_energy_2:: Empower this. Use only if not Empowered.)\n" +
    ":rb_exhaust:: Give a unit +2 :rb_might: this turn. If this is [Empowered], give that unit +4 :rb_might: this turn instead."
} satisfies CardProgram;
