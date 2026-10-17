import type { CardProgram } from "../../ir/index.js";

/**
 * Tryndamere, Barbarian (ogn-034-298) — Unit, Fury, Tryndamere/Freljord/Champion.
 * energy 7, power 2 (Fury), Might 8.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-034-298):
 *   "When I conquer after an attack, if you assigned 5 or more excess damage to
 *    enemy units, you score 1 point."
 *
 * 规则依据（CR v1.5）：
 * - 383.4.c："When I conquer after an attack" 是 Conquer Effect（时点 conquer；
 *   "after an attack" 指该征服由一次攻击造成）。
 * - 383.2.a.1：紧随触发条件之后的 "if ..." 从句是**触发条件的一部分**，必须
 *   在进链前为真；"assigned 5 or more excess damage to enemy units" 是战斗伤害
 *   分配的结果统计（467.2.c.1 区分分配和造成；467.2.c.4 限制分配上限），因此条件
 *   写在 TriggerSpec.condition 上而不是 body 指令上。
 * - 194.1.c / 470.1："you score 1 point" 是获得点数（Gaining Points），与
 *   战场 Scoring 是两件事；官方文本用 "Score X points" 指获得点数（470.2）。
 *
 * status：judge-required。source:self 由生产过滤器绑定到真实宿主。
 * 仍缺本次攻击的伤害分配统计、征服参与单位身份与得分替代后的征服事件；
 * count.subject 不会读取分配数据，不能用当前对象数量近似 excess damage。
 * effect.score 的执行证据只证明获得点数子效果。
 */
const tryndamereBarbarian = {
  canonicalCardId: "card.hash-6ba12b26451c240435ee3952db1009ed8f8cb3d1db061aef3df6e51c359883aa",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺本次攻击向敌方单位分配 5+ excess damage 的战斗伤害分配统计（CR 467.2.c.1、467.2.c.4；" +
    "383.2.a.1 要求在触发入链前判断），不能用已造成伤害或当前对象数量代替。" +
    "conquer 事件 details 只有 battlefieldId，没有本次攻击/分配关联或参战单位 object；" +
    "HistoryQuery 也没有伤害分配数值维度，count.subject 不参与求值。" +
    "source:self 过滤还需征服事件提供真实参与单位身份（383.4.c.2.a）；" +
    "替代或阻止征服得分时仍须产生征服触发（383.4.c.2.c）。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // "conquered" is the closed discriminant (EVENT_NAMES maps it to the
        // conquer timing point). source:self binds the actual host; the
        // production emission still needs participant identity (383.4.c.2.a).
        filter: { event: "conquered", source: "self" },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "excess-damage-assigned-this-combat",
            filter: { targetController: "opponent", scope: "this-attack" }
          },
          operator: "gte",
          right: { kind: "constant", value: 5 }
        }
      },
      optional: false,
      body: [
        {
          id: "tryndamere-barbarian.score-1",
          op: "effect.score",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "When I conquer after an attack, if you assigned 5 or more excess damage to enemy units, you score 1 point."
} satisfies CardProgram;

export default tryndamereBarbarian;
