import type { CardProgram } from "../../ir/index.js";

/**
 * Xin Zhao, Vigilant (sfd-176-221) — Unit, Order, Demacia/Xin Zhao/Champion.
 * energy 3, power 1 (Order), Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-176-221，逐字）:
 *   "[Tank] (I must be assigned combat damage first.)\n"
 *   "I enter ready if you have two or more other units in your base."
 *
 * 规则依据（CR v1.5）：
 * - [Tank]（815）：Passive Ability 关键词；815.1.b 功能上等于「战斗伤害步骤中，在我
 *   被分配致命伤害之前，同一控制者下没有 [Tank] 的其他单位都不能被分配伤害」，
 *   815.1.c.1/.c.2 给出多条 Tank 时的分配顺序，815.2 多重实例冗余，815.3 是单位特征。
 *   按契约 3.7 关键词只声明，展开（continuous.combat 指派要求）属
 *   engine-core/src/effects/keywords/Tank.ts（RIFT-264 已合入）；卡程序不重写。
 * - "I enter ready if you have two or more other units in your base."（364.3 条件被动；
 *   369.3 入场替代）：单位默认横置进场（359.2.c / 143.4），官方把 "I enter ready"
 *   列为替代进场方式的效果（369.3 的 Master Yi, Honed 示例），因此写成
 *   replacement 能力（event object-enters-board，filter 指向自身且只替代 exhausted
 *   默认进场），with 体用已合入的 effect.ready 并显式指向 `{ kind: "source" }`
 *   （被替代事件的对象就是即将进场的本单位自身，355.10.c/805.6 的写法），
 *   而不是事后 effect.ready。
 * - 条件 "two or more other units in your base"：其他友方单位位于你自己的 Base。
 *   Base 是 Location（107.1.b / 198.1），而凡由你控制的永久物都位于你的 Base
 *   （107.1.c），因此「your base」用 controller（"self"，由生产链路归一化为能力
 *   控制者）加 location: "base" 表达（location 的字符串形式是已合入匹配器实际求值的
 *   形状）；"other" 用 OBJECT_FILTER_ANCHORS 的 exclude: "self" 排除本卡（740.1.a
 *   的 "another" 惯例），"two or more" 用 count 表达式 gte 2。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，两处缺口都不近似实现。
 * - [Tank] 的 KeywordDef 已合入（effects/keywords/Tank.ts，RIFT-264），展开为
 *   static continuous.combat（mode damage-assignment、priority first、damage lethal），
 *   但该 kind 仍无运行时消费方：layers/engine.ts 的 ability/arithmetic 分支都不命中它，
 *   combat/base-combat-allocation.ts 仍注明 "No Tank/Backline/other assignment-priority
 *   requirement is bound here"，815.1.b/815.1.c.1/.c.2 的分配顺序不可执行。
 * - 入场替代管线已合入（replacement/，RIFT-260），但**入场状态改写路径不读取
 *   ability.condition**：replacement/bind.ts 的 synthetic enter declaration
 *   （Accelerate/805.6 同型）在 matchesEnterAction 命中入场 move 后直接返回 true，
 *   只有在非入场事件路径（matchFor）才调用 testCondition。带条件的入场替代因此会变成
 *   无条件改写（≤1 个其他单位时也会就绪进场），与 364.3/369.3 不符。
 * - 条件里的 exclude: "self" 也绑定在**登记时的入区序号**上（replacement/bind.ts 的
 *   environment 用 hostRef 作为 host）：等条件真的在入场时求值时，被排除的是旧 incarnation，
 *   刚进场的本单位会把自己算进 count，
 *   「two or more other units」的阈值因此也会错。golden 只真实求值条件谓词与 with 体的
 *   effect.ready 本体，并把「入场路径必须先求值条件」与 incarnation 绑定记为 test.todo。
 * - 不近似实现：不用事后 effect.ready 顶替入场状态改写，也不把条件删成无条件。
 */
export default {
  canonicalCardId: "card.hash-74a101bf90abcf30478ceacbdf6a254627d4b912349d7ed3b6a76591368936a8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口：(1) [Tank]（815）的 KeywordDef 已合入（effects/keywords/Tank.ts，RIFT-264），" +
    "展开为 static continuous.combat（mode: damage-assignment、priority: first、damage: lethal），" +
    "但该 kind 仍无运行时消费方——layers/engine.ts 的 ability/arithmetic 分支都不命中它，" +
    "combat/base-combat-allocation.ts 仍注明 \"No Tank/Backline/other assignment-priority requirement " +
    "is bound here\"，815.1.b/815.1.c.1/.c.2 的「先给 Tank 分配致命伤害」不可执行" +
    "（同 ogn/sett-kingpin、ogn/shen-kinkou）。" +
    "(2) 「I enter ready if you have two or more other units in your base」是带条件的入场替代" +
    "（359.2.c/364.3/369.3）：replacement/（RIFT-260）已合入 synthetic enter declaration" +
    "（805.6/Accelerate 同型），但该入场路径在 matchesEnterAction 命中 move 后直接返回 true，" +
    "不求值 ability.condition（只有 matchFor 的非入场事件路径才调用 testCondition），" +
    "条件（count gte 2 + controller self + location base + exclude self）无法为入场改写开闸；" +
    "用它执行会变成无条件就绪进场，属近似实现。另外条件的 exclude: self 锚点在 bind 时被绑定到" +
    "登记时的入区序号（environment 的 host 用 hostRef），入场求值时刚进场的本单位会把自己计入 count，" +
    "「two or more other units」的阈值同样会错。golden 真实求值该条件谓词（≥2 / 1 个 / 战场单位等边界）" +
    "与 with 体的 effect.ready 本体，不据此宣称整卡可执行。" +
    "依赖：continuous.combat 消费方（战斗伤害分配读取 Tank 指派要求，RIFT-258 交接的战斗工作流）与" +
    "入场替代路径按入场 incarnation 求值 ability.condition（含 exclude 锚点绑定）。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "tank" },
    {
      kind: "replacement",
      replaces: {
        event: "object-enters-board",
        filter: { source: "self", exhausted: true }
      },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "units",
          filter: {
            type: "unit",
            controller: "self",
            zone: "board",
            location: "base",
            exclude: "self"
          }
        },
        operator: "gte",
        right: { kind: "constant", value: 2 }
      },
      with: [
        {
          id: "xin-zhao-vigilant.enter-ready",
          op: "effect.ready",
          args: { objects: { kind: "constant", value: { kind: "source" } } }
        }
      ]
    }
  ],
  sourceText:
    "[Tank] (I must be assigned combat damage first.)\n" +
    "I enter ready if you have two or more other units in your base."
} satisfies CardProgram;
