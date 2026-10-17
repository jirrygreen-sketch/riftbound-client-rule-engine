import type { CardProgram } from "../../ir/index.js";

/**
 * Combat Experience (unl-031-219) — Spell, 1 energy, Power null, Might null, Calm。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-031-219，逐字）：
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Give a unit +1 :rb_might: this turn.
 *   [Level 6][>] Give it +3 :rb_might: this turn instead. (While you have 6+ XP, get the effect.)
 *
 * 规则依据（CR v1.5）：
 * - [Reaction]（813）许可关键词，卡牌只声明。
 * - “Give a unit +1 :rb_might: this turn”：临时 Might 修改，属算术图层（143.2.a 的有效 Might、
 *   317.2.c 的 this-turn 到期），不是 Buff 计数（702）；effect.buff 的文件头明确临时 Might 修改
 *   归 layers 的 continuous.might。355.9.a.1 的 “a unit” 是目标。
 * - “[Level 6][>] Give it +3 :rb_might: this turn instead.”：824.1.a/824.1.b 规定 [Level N][>]
 *   到子句结尾整段是一条 Level Ability，824.1.b.1 的功能释义是“当你有 N 点或更多 XP 时，本卡获得
 *   ‘[Text]’”；824.1.c/824.1.d 要求按控制者 XP 动态 Active/Inactive。因为该从句是 “instead”，
 *   它替换第一句的数额而不是叠加，两条分支共用同一个被选单位（“it”，355.10.c.1）。
 * - XP 门槛条件按已合入 ogn/kadregrin-the-infernal、unl/wuju-master 的写法保留（count + subject），
 *   重组后的 Condition 词汇仍没有 XP 读取路径（见下方 Status）。
 *
 * Status: judge-required. Re-checked 2026-10-17 against merged source:
 * continuous.might supports both printed amounts and turn-end expiry, and
 * programs/statics.ts now binds a static continuous.might to the arithmetic
 * layer. The blocker is the Level 6 gate itself: effects/interpreter/expr.ts
 * evaluates `count` as queryObjects(filter).length and ignores `subject`, and
 * the merged condition vocabulary (always/never/compare/all/any/not/
 * expression plus the played-from-*, printed-characteristic and result
 * predicates added with the condition-predicate batch) has no player-XP read.
 */
const levelSixCondition = {
  kind: "compare",
  left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
  operator: "gte",
  right: { kind: "constant", value: 6 }
} as const;

const combatExperience = {
  canonicalCardId: "card.hash-9e75e74352d500dfa1b7c1192957a26c7b4c5e2cc9471eb6057e9d0147ebf803",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺控制器 XP 的门控求值（CR 824.1.b.1/824.1.c/824.1.d）：已合入的 Condition 词汇只有 " +
    "always/never/compare/all/any/not/expression 与 played-from-hand/played-from-zone/printed-characteristic/result 谓词，" +
    "没有任何 Expr/Condition 读取玩家 XP；effects/interpreter/expr.ts 的 count 只统计 query(filter) 的对象数并忽略 subject，" +
    "而常量字符串条件恒真。程序保留 compare(count.controller-xp) 只为记录门控：实测同一条件在 6 XP/1 个对象时为 false、" +
    "0 XP/7 个对象时为 true，证明它计的是对象数而不是 XP，所以 +1 与 +3 的 instead 互斥不能执行，也不能用 Buff 计数或写死一档近似。" +
    "已合入并可执行：reaction 关键词声明、continuous.might（算术图层 + this-turn 到期）与共享 TargetSpec（\"it\"=同一个被选单位）。" +
    "依赖：Expr/Condition 的 controller-xp 读取以及 824.1.c.1/824.1.d 的动态失效。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      // 印刷 1 Energy；力量无印刷值（catalog power: null），不声明 power。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 }
      },
      body: [
        {
          // “Give a unit +1 Might this turn”：临时 Might 修改；仅 XP 门控仍缺消费方。
          id: "combat-experience.give-plus-1",
          op: "continuous.might",
          condition: { kind: "not", condition: levelSixCondition },
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" },
            objects: { kind: "constant", value: { kind: "target", id: "combat-experience.unit" } }
          },
          targets: [
            {
              id: "combat-experience.unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // “[Level 6][>] Give it +3 Might this turn instead.”：同一个被选单位（共用 TargetSpec），
          // 金额替换第一支；仅 XP 门控仍缺消费方（见 judgeReason）。
          id: "combat-experience.give-plus-3-instead",
          op: "continuous.might",
          condition: levelSixCondition,
          args: {
            amount: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "this-turn" },
            objects: { kind: "constant", value: { kind: "target", id: "combat-experience.unit" } }
          },
          targets: [
            {
              id: "combat-experience.unit",
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
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give a unit +1 :rb_might: this turn.\n" +
    "[Level 6][>] Give it +3 :rb_might: this turn instead. (While you have 6+ XP, get the effect.)"
} satisfies CardProgram;

export default combatExperience;
