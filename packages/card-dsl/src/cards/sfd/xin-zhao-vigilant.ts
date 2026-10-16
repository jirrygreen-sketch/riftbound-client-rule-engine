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
 *   engine-core/src/effects/keywords/<keyword>.ts；卡程序不重写。
 * - "I enter ready if you have two or more other units in your base."（364.3 条件被动；
 *   369.3 入场替代）：单位默认横置进场（359.2.c / 143.4），官方把 "I enter ready"
 *   列为替代进场方式的效果（369.3 的 Master Yi, Honed 示例），因此写成
 *   replacement 能力（event object-enters-board，filter 指向自身），而不是事后
 *   effect.ready——effect.ready 自己的文档也明确它不参与入场替代。
 * - 条件 "two or more other units in your base"：其他友方单位位于你自己的 Base。
 *   Base 是 Location（107.1.b / 198.1），而凡由你控制的永久物都位于你的 Base
 *   （107.1.c），因此「your base」用 controller: "controller" 加 location: "base"
 *   表达（location 的字符串形式是已合入匹配器实际求值的形状）；"other" 用
 *   OBJECT_FILTER_ANCHORS 的 exclude: "self" 排除本卡（740.1.a 的 "another" 惯例），
 *   "two or more" 用 count 表达式 gte 2。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - [Tank] 没有已合入的 KeywordDef（effects/keywords/ 下无 Tank 文件），战斗伤害
 *   分配也不读取分配优先级要求——combat/base-combat-allocation.ts 明确写着
 *   "No Tank/Backline/other assignment-priority requirement is bound here"，
 *   815.1.c.1/.c.2 因此无法执行。
 * - "I enter ready" 是入场替代（359.2.c / 369.3），缺 replacement.enter 消费管线：
 *   事件管线的替代注册表存在，但没有读取 CardProgram replacement 能力并注册的
 *   入口，因此替换不会发生；不把 effect.ready 当作事后重置来近似。
 * - 条件里的 count/exclude/location 形状可校验，但「条件作出替换决定」只有在
 *   replacement.enter 落地后才可执行验证；参考内核不做替代注册，golden 测试只执行
 *   with 体的 effect.ready（见测试说明）。
 * - filter 的 controller: "controller"（= "you"）与 exclude: "self" 的绑定也还没有
 *   合并的消费方：chain/engine.ts 的 query 只归一化 "self"/"opponent"，参考内核按值
 *   比较（同批 M1 卡 bubble-bot 记录的同一缺口）。
 * 依赖：Tank 关键词与战斗分配（combat 工作流 / RIFT-9 continuous.combat）、
 * replacement.enter 替代管线（RIFT-9 / RIFT-120）、Base 位置谓词。
 * 不近似实现（不把 Tank 写成数值修正，不把 enter ready 改成 effect.ready）。
 */
export default {
  canonicalCardId: "card.hash-74a101bf90abcf30478ceacbdf6a254627d4b912349d7ed3b6a76591368936a8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Tank]（815）没有已合入的 KeywordDef（effects/keywords/ 无 Tank 文件），且战斗伤害分配不读取" +
    "分配优先级要求——combat/base-combat-allocation.ts 明确未绑定 Tank/Backline 要求，815.1.c.1/.c.2 无法执行；" +
    "「I enter ready if you have two or more other units in your base」是入场替代（359.2.c/369.3，官方 Master Yi, Honed 示例），" +
    "缺 replacement.enter 替代管线（events/pipeline.ts 有替代注册表但无 CardProgram 消费方），effect.ready 不能代替" +
    "（其文档明确不参与入场替代，359.2.c/369.3 的「进入方式」必须由替代在换区前完成）。" +
    "条件的「you / another」占位符绑定（controller: \"controller\" 与 exclude: \"self\"）也尚无已合入的消费方" +
    "（chain/engine.ts 的 query 只归一化 self/opponent）。" +
    "依赖：Tank 关键词与战斗分配（continuous.combat / 战斗工作流）、replacement.enter 替代管线（RIFT-9/RIFT-120）。" +
    "条件里的 two-or-more-other-units-in-your-base（107.1.b/107.1.c/198.1）随替代管线一起结算。不近似实现。",
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
            controller: "controller",
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
          args: {}
        }
      ]
    }
  ],
  sourceText:
    "[Tank] (I must be assigned combat damage first.)\n" +
    "I enter ready if you have two or more other units in your base."
} satisfies CardProgram;
