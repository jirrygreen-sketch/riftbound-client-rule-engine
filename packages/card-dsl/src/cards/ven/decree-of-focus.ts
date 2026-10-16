import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Decree of Focus (ven-040-166) — Spell, 1 energy, no printed Power/Might, domain Calm.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-040-166，逐字）：
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
 *   "Choose a friendly unit that's in combat with an enemy Fury (:rb_rune_fury:) unit or " +
 *   "that's being chosen by an enemy Fury spell. Give it +4 :rb_might: this turn."
 *
 * 规则依据（Core Rules v1.5）：
 * - [Reaction]（813.1 / 813.1.c）：许可类关键词，可在任意玩家的 Closed State 打出；
 *   卡侧只声明 keyword（契约 3.7），展开与链许可由 keywords/Reaction.ts 与 chain/ 负责。
 * - "Choose a friendly unit ..."：单位在 Board（公开区域）且被明确指名，因此是 Target
 *   （355.7 / 355.9.a.1 / 355.10）；"Give it +4" 的 "it" 就是该目标，不再另做选择。
 * - "Give it +4 :rb_might: this turn"：带回合期限的临时 Might 修改，属算术图层
 *   （continuous.might + end-of-turn 到期，317.2.c）；effect.buff 文件头明确临时 Might
 *   修改归 continuous.might，绝不用 CR 702 的 Buff 计数器近似。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. 临时 Might 修改没有已合入的执行 op：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，
 *    effects/instructions/ 下也没有注册创建 continuous.might 的原语（layers 引擎能求值，
 *    但没有卡牌侧入口），同 hold-em / high-note / realm-of-death 的判定；
 * 2. 目标合法性条件没有可求值谓词：
 *    - "in combat"（740.2.c：占据正在战斗的战场且拥有 combat designation）需要战斗指定状态，
 *      它不是 ObjectSnapshot 特征（契约 3.8 的 combatRole 增补未进当前 HEAD），
 *      也没有战斗进行中的时点载荷；
 *    - "with an enemy Fury (:rb_rune_fury:) unit" 是“与另一个（敌方、Fury 域）单位同处”的
 *      关系谓词：ObjectFilter 的 sameLocationAs 只能锚定一个选中身份，没有“同位置且属于敌方
 *      且 power 含 Fury”的组合谓词，已合入的过滤器也不读 domain 键；
 *    - "that's being chosen by an enemy Fury spell" 需要读取**正在结算/待结算链项**的目标计划
 *      （355.x 的 being chosen），契约 3.8 第 4 条明确目标计划与链的对接属引擎内部，
 *      不进入原语面向的 ResolveContext。
 *    由于两个候选条件之间是“或”，而 TargetSpec.filter 是合取键值对，本程序只保留一条具名
 *    限制描述（targetRestriction），并在此登记依赖；绝不把它当成可用过滤器（未知键会被静默
 *    忽略，会让任意友方单位成为合法目标）。
 * 依赖：RIFT-91（continuous.might 与到期；图层求值侧已合入）、RIFT-90（目标计划/309.1
 * 的 combat designation 与 being-chosen 读取）、契约 3.8 combatRole 落地。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "reaction" },
  {
    kind: "play",
    cost: {
      kind: "cost.printed",
      energy: { kind: "constant", value: 1 }
    },
    body: [
      {
        // "Give it +4 :rb_might: this turn" — 算术图层的临时 Might 修正，
        // end-of-turn 到期；创建该持续效果的 op 尚未合入（见 judgeReason 第 1 点）。
        id: "decree-of-focus.give-plus-4",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 4 },
          duration: { kind: "constant", value: "this-turn" },
          target: { kind: "constant", value: "decree-of-focus.friendly-unit" }
        },
        targets: [
          {
            id: "decree-of-focus.friendly-unit",
            filter: {
              type: "unit",
              zone: "board",
              controller: "self",
              // 描述性限制，不是可求值谓词："in combat with an enemy Fury unit or
              // being chosen by an enemy Fury spell"（见 judgeReason 第 2 点）。
              targetRestriction:
                "in-combat-with-an-enemy-fury-unit-or-being-chosen-by-an-enemy-fury-spell"
            },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-e5eafd33bb50e62c31da83b13c1e44904a8cd4d53760a85e48bbb1fb82d587eb",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1)「Give it +4 :rb_might: this turn」是带回合期限的临时 Might 修改，" +
    "属算术图层（317.2.c 到期）：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effects/instructions/ 也没有注册创建 " +
    "continuous.might 的原语（layers 引擎能求值，但缺卡牌侧入口），effect.buff 只处理 CR 702 的 Buff 计数，不能近似；" +
    "(2)「a friendly unit that's in combat with an enemy Fury unit or that's being chosen by an enemy Fury spell」" +
    "的目标合法性没有可求值谓词：740.2.c 的 in combat 需要 combat designation（不是 ObjectSnapshot 特征，契约 3.8 的 " +
    "combatRole 未进 HEAD）；「with an enemy Fury unit」是与另一个敌方 Fury 域单位同处的关系谓词，ObjectFilter 的 " +
    "sameLocationAs 只锚定一个选中身份、也不读 domain；「being chosen by an enemy Fury spell」需要读取正在结算链项的目标计划，" +
    "契约 3.8 第 4 条明确该信息不进入原语面向的 ResolveContext。两个条件之间是“或”，而 TargetSpec.filter 是合取，" +
    "程序只保留具名限制描述 targetRestriction，不把它当可用过滤器（未知键会被静默忽略，任意友方单位都会变成合法目标）。" +
    "依赖：RIFT-91（continuous.might 卡牌侧入口与到期）、RIFT-90（目标计划/being-chosen 读取）、契约 3.8 combatRole 落地。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a friendly unit that's in combat with an enemy Fury (:rb_rune_fury:) unit or that's being chosen by an enemy Fury spell. Give it +4 :rb_might: this turn."
} satisfies CardProgram;
