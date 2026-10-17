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
 *   分配的结果统计（CR 467.2.c.4：excess = 超过致命所需的分配量），因此条件
 *   写在 TriggerSpec.condition 上而不是 body 指令上。
 * - 194.1.c / 470.1："you score 1 point" 是获得点数（Gaining Points），与
 *   战场 Scoring 是两件事；官方文本用 "Score X points" 指获得点数（470.2）。
 *
 * status：judge-required。复核 2026-10-17：
 * - 已合入：「score 1 point」由 effect.score 真实执行（golden 断言
 *   score 动作、玩家点数 +1 与链接凭证）；conquer 时点由 turn/flow.ts 的 Score
 *   波发出。触发拼写改用封闭判别值 "conquered"。
 * - 仍缺：「assigned 5 or more excess damage to enemy units」的条件统计。excess
 *   damage 分配结果既不在 conquer 发射的载荷里（turn/flow.ts scheduleScore 的
 *   details 只有 battlefieldId），也不在 HistoryQuery 的维度里
 *   （interpreter/history.ts 只接受 scope/action/timingPoint/player/object/
 *   exclude/objectFilter）；count 表达式的 subject 不参与求值（expr.ts 只按
 *   filter 查询对象，未知 filter 键被忽略会过度满足）。
 * - 同时，conquer 的 score 动作只带 player，触发 filter 的
 *   object:{objectId:"self"}（383.4.c.2.a 的单位身份）没有可绑定的事件对象；
 *   本卡按可接受拼写声明意图并保留该缺口。
 * 依赖：战斗伤害分配统计接入 conquer 事件或 HistoryQuery，以及 conquer 事件携带征服单位身份。
 * 不把条件近似成固定常量，也不手改玩家点数。
 */
const tryndamereBarbarian = {
  canonicalCardId: "card.hash-6ba12b26451c240435ee3952db1009ed8f8cb3d1db061aef3df6e51c359883aa",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处触发条件/载荷缺口：(1)「本次攻击向敌方单位分配 5+ excess damage」没有条件统计——conquer 发射载荷（details）" +
    "只有 battlefieldId，HistoryQuery（interpreter/history.ts）只支持 scope/action/timingPoint/player/object/exclude/objectFilter，" +
    "而 count 表达式的 subject 在 expr.ts 里不参与求值、未知 filter 键被忽略会过度满足（CR 467.2.c.4 的 excess 定义）；" +
    "(2)「When I conquer」的 383.4.c.2.a 单位身份没有事件对象可绑定：conquer 的 score 动作只带 player，" +
    "filter 的 object:{objectId:self} 只能声明意图、没有可绑定载荷。" +
    "已合入部分：「score 1 point」由 effect.score 真实执行，conquer 时点由 turn/flow.ts 的 Score 波发出。" +
    "依赖：战斗伤害分配统计接入 conquer 事件或 HistoryQuery，以及 conquer 事件携带征服单位身份。不近似为固定条件或直接改点数。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // "conquered" is the closed discriminant (EVENT_NAMES maps it to the
        // conquer timing point). The object self-filter declares the "this
        // unit" intent; the current score/conquer emission carries only the
        // player, so no event object can bind it yet (see judgeReason).
        filter: { event: "conquered", object: { objectId: "self" } },
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
