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
 * - XP 门槛条件按已合入 ogn/kadregrin-the-infernal、unl/wuju-master 的写法声明（count + XP 主体）。
 *
 * status = judge-required（按当前 HEAD 复核；缺口不近似实现）：
 * - 临时 Might 修改已经由 continuous.might（RIFT-258）通过 ResolveContext.addContinuous
 *   注册 arithmetic 层并在 this-turn 到期；本卡的两条分支都使用该合入原语。
 * - Level 的 XP 门槛没有可求值谓词：824.1.c/824.1.d 需要读取控制者 XP 的动态评估，
 *   合并 Condition 只能按 count 表达式保留形状，XP 读数未进入 Expr/谓词（unl/wuju-master 同一缺口，
 *   依赖 Level 谓词与条件求值接线（当前属于条件谓词缺口）。
 * - 两处都不近似实现：不把 +1/+3 Might 写成 Buff 计数，也不把 Level 分支写成无条件叠加。
 * +1 分支本身可通过解释器真实执行；整卡仍因 Level 的动态 XP 门控与“instead”互斥语义保持 judge-required。
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
    "两处依赖未合入，均不近似实现：(1) [Level 6][>]（824.1.a/824.1.b.1）需要按控制者 XP 动态 " +
    "Active/Inactive 的依赖能力门控（824.1.c/824.1.d）；合并的 Level KeywordDef 只发布 " +
    "condition.predicate/query=controller-xp，当前条件管线仍没有 XP 读取消费者（条件谓词任务）。" +
    "(2) “instead” 的第二支与第一支共用同一被选单位（355.10.c.1 的 it），两支替换关系必须在上述门控" +
    "可求值后才能执行。+1/+3 本体已使用 continuous.might（RIFT-258）真实注册 arithmetic 层并按 this-turn 到期；" +
    "不把 Might 写成 Buff 计数，也不把 Level 分支写成无条件叠加。",
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
          // “Give a unit +1 Might this turn”：临时 Might 修改（消费者未合入，见 judgeReason）。
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
          // 金额替换第一支；XP 门控与图层入口都未合入（见 judgeReason）。
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
