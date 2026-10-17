import type { CardProgram } from "../../ir/index.js";

/**
 * Kayn, Unleashed (ogn-189-298), CR v1.5 810 / 438.7.
 *
 * 复核（2026-10-17，第三轮 M2 覆盖率复核）：
 * - 已合入并实测：(1) RIFT-257 的 programs/ 绑定能取到 Ganking 展开的 static 能力并把
 *   continuous.movement 注册进图层（layers/engine.ts 的 ability 层、RIFT-258 的 ops）；
 *   (2) 伤害预防替代经 RIFT-260 的 replacement/ 管线真实绑定（438.1/438.7）。
 * - 仍缺（缺口一，Ganking 许可形状）：Ganking 展开写出的是**字符串** permission
 *   "battlefield-to-battlefield"（effects/keywords/Ganking.ts），而唯一读取移动许可的
 *   规则查询 layers/rules/query.ts 的 movement() 读的是 effect.permission.routes 数组。
 *   已实测：注册后 movement() 返回 canGank=false、permissions=[]；改成 routes 数组后才
 *   canGank=true。layers/engine.ts 的 applyAbility 对字符串 permission 也读不出 canGank。
 *   两处都按契约形状实现，缺的是适配（810.1.b）；144.4.c 的 Standard Move 因此不开放。
 * - 仍缺（缺口二，替代条件的历史计数）："If I have moved twice this turn" 需要按本回合**自身**的
 *   Move 动作计数（375/438.7）。已合入的 condition.history 只在指令体里可用
 *   （effects/interpreter/history.ts + interpreter 的 condition.history 分支），而替代能力
 *   的 condition 走 condition.ts 的 compare/expression 求值：接触到的 count 是**现场对象集合查询**
 *   （chain/engine.ts 的 ctx.query），subject "moves-this-turn" 无消费方。已实测：本回合 0 次移动、
 *   场上有 2 个对象时，卡内原条件错误地返回 true——它数的是对象不是移动次数。**不能**把
 *   该占位形式的错误结果当成可执行证据（RIFT-359 分支 4f4b5b2 扩充的是事件/结果谓词，不含此语义，
 *   且未合入 HEAD）。
 */
export default {
  canonicalCardId: "card.hash-1958207f0c4a0be000a8fb2e9fefe3b7deac31092670ca1484b69d633b7df9b7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) Ganking 的 continuous.movement 已能通过 programs/ 注册到图层，" +
    "但其字符串 permission=battlefield-to-battlefield（effects/keywords/Ganking.ts）未适配为 movement 规则查询" +
    "（layers/rules/query.ts）要求的 permission.routes 数组；实测注册后 movement() 仍 canGank=false、permissions=[]，" +
    "须改成 routes 数组才生效（CR 810.1.b、144.4.c）。" +
    "(2)「If I have moved twice this turn」需要替代匹配期按本回合**自身** Move 动作计数（375/438.7）：" +
    "condition.history 只在指令体可用，替代能力的 condition 走 compare/expression，其 count 是现场对象集合查询，" +
    "subject moves-this-turn 无消费方；实测 0 次移动、场上 2 个对象时原条件错误返回 true（数的是对象不是移动次数，" +
    "进行中 RIFT-359 分支 4f4b5b2 只扩充事件/结果谓词且未合入 HEAD）。" +
    "已合入可用：RIFT-257 的 static 注册路径与 RIFT-260 的伤害 prevent 替代。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "ganking" },
    {
      kind: "replacement",
      replaces: { event: "damage", filter: { target: "self" } },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "moves-this-turn",
          // 占位谓词：需要按本回合自身 object-moved 事件计数；见 judgeReason。
          filter: { object: "self" }
        },
        operator: "gte",
        right: { kind: "constant", value: 2 }
      },
      // Empty replacement body = the damage event is prevented (438.1/438.7).
      with: []
    }
  ],
  sourceText:
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
    "If I have moved twice this turn, I don't take damage."
} satisfies CardProgram;
