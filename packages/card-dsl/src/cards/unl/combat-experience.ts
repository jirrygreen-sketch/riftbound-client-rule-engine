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
 * status = judge-required（缺口不近似实现）：
 * - 临时 Might 修改没有卡牌侧入口：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，
 *   effects/instructions/ 也没有任何注册 continuous.might 的原语（layers 引擎能求值 arithmetic 层
 *   与 end-of-turn 期限，但没有把结算中的持续效果经 ResolveContext.addContinuous 落地的指令；
 *   同 ogn/back-to-back / ogn/punch-first / sfd/frigid-touch 的缺口，依赖 RIFT-83/84 一族的图层原语）。
 * - Level 的 XP 门槛没有可求值谓词：824.1.c/824.1.d 需要读取控制者 XP 的动态评估，
 *   合并 Condition 只能按 count 表达式保留形状，XP 读数未进入 Expr/谓词（unl/wuju-master 同一缺口，
 *   依赖 kw-level 的展开与 RIFT-87/90 的条件管线）。
 * - 两处都不近似实现：不把 +1/+3 Might 写成 Buff 计数，也不把 Level 分支写成无条件叠加。
 * 本卡没有可独立执行的正文指令，golden 只做校验、结构断言与缺口 todo。
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
    "三处依赖未合入，均不近似实现：(1)「Give a unit +1 :rb_might: this turn」（143.2.a 的有效 Might、" +
    "317.2.c 的 this-turn 到期）是临时 Might 修改，属算术图层而不是 Buff 计数（CR 702；effect.buff 文件头明确），" +
    "但 effects/instructions/ 没有任何已注册原语（如 continuous.might）能通过 ResolveContext.addContinuous 注册它，" +
    "契约 3.6 的封闭 GameAction 集合也没有 Might 修改动作（同 back-to-back / punch-first / frigid-touch 的缺口）。" +
    "(2)「[Level 6][>] … instead」（824.1.a/824.1.b.1）需要按控制者 XP 动态 Active/Inactive 的依赖能力门控" +
    "（824.1.c/824.1.d），合并 Condition 只能保留 count 形状，XP 读数未进入 Expr/谓词（unl/wuju-master 同一缺口，" +
    "依赖 kw-level 展开与 RIFT-87/90）。(3) “instead” 的第二支与第一支共用同一被选单位（355.10.c.1 的 it），" +
    "两支的替换关系需要 Level 门控落地后才能求值。不把 +1/+3 Might 写成 Buff 计数，也不把 Level 分支写成无条件叠加。",
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
            duration: { kind: "constant", value: "this-turn" }
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
            duration: { kind: "constant", value: "this-turn" }
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
