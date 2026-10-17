import type { CardProgram } from "../../ir/index.js";

/**
 * Kayn, Unleashed (ogn-189-298), CR v1.5 810 / 438.7.
 * programs/ now expands and registers Ganking's continuous.movement rule;
 * its string permission still needs adaptation to the rule query's permission.routes.
 * Damage prevention already binds through replacement/. Its condition needs
 * this object's actual Move actions in the current turn (RIFT-359).
 * condition.history can query history in an instruction body, but Condition
 * Expr/count is a live object-set query and cannot gate replacement matching
 * from that event history. Never treat counting the unit as counting its moves.
 */
export default {
  canonicalCardId: "card.hash-1958207f0c4a0be000a8fb2e9fefe3b7deac31092670ca1484b69d633b7df9b7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) Ganking 的 continuous.movement 已能通过 programs/ 注册到图层，" +
    "但其字符串 permission=battlefield-to-battlefield 未适配为 movement 规则查询要求的 permission.routes 数组（CR 810.1.b）。" +
    "(2) If I have moved twice this turn 需要替代匹配期读取本回合自身 Move 历史（RIFT-359）：" +
    "condition.history 已能在指令中查询历史，但替代 Condition 的 Expr/count 只计当前对象，不能统计移动次数。" +
    "伤害 prevent 替代已可绑定（438.7）；缺的是历史条件与 Ganking 许可形状适配。",
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
