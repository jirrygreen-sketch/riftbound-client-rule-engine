import type { CardProgram } from "../../ir/index.js";

/**
 * Kayn, Unleashed (ogn-189-298), CR v1.5 810.1.b / 144.4.c / 467.2.c.10.
 * 当前复核：Ganking 可注册但许可形状不匹配；替代条件未接本回合自身移动历史。
 * 此外，不受伤害的单位必须免于强制致命分配，单独预防伤害不能实现此规则。
 */
export default {
  canonicalCardId: "card.hash-1958207f0c4a0be000a8fb2e9fefe3b7deac31092670ca1484b69d633b7df9b7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Ganking 与移动历史/战斗分配接线：(1) continuous.movement 的字符串 permission 未适配为 movement 查询所读的" +
    "permission.routes，无法开放战场间 Standard Move（810.1.b、144.4.c）。" +
    "(2) If I have moved twice this turn 需要替代匹配期读取本回合自身 Move 历史；" +
    "count 的 subject moves-this-turn 未被消费，其表达式只查询当前对象集合，现有事件/结果谓词也不提供移动次数。" +
    "(3) 不受伤害的 Kayn 必须免于强制致命伤害分配（467.2.c.10），当前空伤害预防替代尚未提供该 combat 规则查询。",
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
