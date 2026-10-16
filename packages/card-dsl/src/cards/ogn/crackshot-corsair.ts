import type { CardProgram } from "../../ir/index.js";

/**
 * Crackshot Corsair (ogn-130-298) — Unit, 3 energy, no printed power (Body), 3 Might.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-130-298):
 *   When I attack, deal 1 to an enemy unit here.
 *
 * 规则依据（CR v1.5）：
 * - “When I attack”：攻击触发（383.4.e；时点 attack-declared，ruleRefs 323.2、383.4.e、
 *   466.2.c），filter 指向自身。
 * - “deal 1 to an enemy unit here”：effect.damage，数额为印刷常数 1；目标是一名与本单位
 *   同地点的敌方单位（355.7 目标；`sameLocationAs: "source"` 锚点由解释器按当前位置解析）。
 * - 418.6.a：未指定来源的 Deal 动作以描述该动作的游戏效果（本能力，来源即本单位）为来源；
 *   effect.damage 缺省即为 ctx.source.ref，故不另写 source。
 *
 * status: judge-required —— 效果本体（effect.damage + 目标锚点）已合入，但时点本身没有
 * 已合入的发射方：blackbox 中 `attack-declared` 只出现在封闭枚举 events/timing-points.ts
 * 与 events/trigger-spec.ts，战斗模块（packages/engine-core/src/combat/）当前只有伤害分配与
 * 派生 Might，没有任何流程发射该时点（combat/ 不在本任务 owns；属引擎批 5 战斗流程）。
 * 触发无法在真实内核中发生，故不标 executable。
 */
export default {
  canonicalCardId: "card.hash-4acf60426320c2884ae76dd73b385b04731efa6ca356ff3cbaba1c02983837c1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "effect.damage 与目标锚点均已合入，但攻击时点 `attack-declared` 没有已合入的发射方：该 id 只" +
    "存在于封闭枚举 events/timing-points.ts 与 events/trigger-spec.ts，packages/engine-core/src/combat/" +
    "（base-combat-allocation、derived-might）不发射任何时点，战斗流程/时点发射属引擎批 5（RIFT-31/33 等" +
    "场景与触发任务）。触发在真实内核中不会发生，故整卡保持 judge-required，不把「能写出声明」当作可执行。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: { event: "attack-declared", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          id: "crackshot.damage",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 1 },
            target: { kind: "constant", value: "crackshot.enemy-unit-here" }
          },
          targets: [
            {
              id: "crackshot.enemy-unit-here",
              filter: { type: "unit", controller: "opponent", sameLocationAs: "source" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When I attack, deal 1 to an enemy unit here."
} satisfies CardProgram;
