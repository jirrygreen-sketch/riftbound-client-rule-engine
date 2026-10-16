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
 * - 383.4.c："When I conquer after an attack" 是 Conquer Effect（时点 conquer，
 *   filter 指向自身；“after an attack”指该征服由一次攻击造成）。
 * - 383.2.a.1：紧随触发条件之后的 "if ..." 从句是**触发条件的一部分**，必须
 *   在进链前为真；"assigned 5 or more excess damage to enemy units" 是战斗伤害
 *   分配的结果统计（CR 467.2.c：战斗伤害按分配行动统计 excess damage），因此
 *   条件写在 TriggerSpec.condition 上而不是 body 指令上。
 * - 194.1.c / 470.1："you score 1 point" 是获得点数（Gaining Points），与
 *   战场 Scoring 是两件事；官方文本用 "Score X points" 指获得点数（470.2）。
 *
 * status：judge-required。缺两样：
 * 1. effect.score 指令原语——当前 instructions/ 目录没有 effect.*score* 文件
 *    （RIFT-115 才新增，尚未合入本工作树）；没有它无法提交 `score` 游戏动作。
 * 2. "assigned 5 or more excess damage to enemy units" 的触发条件统计：没有
 *    已注册的 history / payload 谓词读取本次攻击分配的 excess damage 总量
 *    （467.2.c.4 定义 excess = 超过致命所需的分配量）。
 * 依赖：RIFT-115（effect.score 原语）、RIFT-31/33（scoring / 战斗分配的触发统计）。
 * 不把条件近似成固定常量，也不手改玩家点数。
 */
const tryndamereBarbarian = {
  canonicalCardId: "card.hash-6ba12b26451c240435ee3952db1009ed8f8cb3d1db061aef3df6e51c359883aa",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 effect.score 指令原语（RIFT-115 的 effect.score 尚未合入本工作树，instructions/ 无对应文件），无法提交 score 游戏动作；" +
    "同时缺「本次攻击向敌方单位分配 5+ excess damage」的触发条件统计（CR 467.2.c.4 的 excess damage 定义，" +
    "需要 conquer 触发载荷或 history 暴露本次攻击的分配结果）。依赖：RIFT-115（effect.score）、" +
    "RIFT-31/33（scoring 与战斗分配触发统计）。不近似为固定条件或直接改点数。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquer", filter: { source: "self" } },
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
