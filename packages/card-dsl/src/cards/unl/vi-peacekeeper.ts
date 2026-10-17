import type { CardProgram } from "../../ir/index.js";

/**
 * Vi, Peacekeeper (unl-176-219) — Unit，5 能量 + 1 Order Power、Might 5，
 * 标签 Vi / Piltover / Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-176-219，逐字）：
 *   [Ambush] (You may play me as a [Reaction] to a battlefield where you have
 *   units.)
 *   When I attack, [Stun] an enemy unit here. (It doesn't deal combat damage
 *   this turn.)
 *
 * 规则依据（CR v1.5）：
 * - 822.1 / 822.1.b / 822.1.c：Ambush 是被动能力关键词，功能上等于「可以向一个你控制着
 *   单位的战场打出」+「按此方式打出时具有 Reaction」，并为合法打出位置增加选项；822.2 多个
 *   实例冗余。卡片只声明 keyword，展开属关键词注册表（契约 3.7 / README 第 5 节）。
 * - 383.4.e / 383.4.e.1 / 466.2.c："When I attack" 是 Attack Trigger（单位取得 Attacker
 *   身份时入链），封闭时点表用 attack-declared。
 * - 355.9 / 355.10："an enemy unit" 是单个由能力控制者选择的单位 → 选目标（TargetSpec），
 *   不是 pick；355.9.a.1：未写地点时指 Board 上的单位，controller 限制为 opponent。
 * - 053.3 / 359.3.f.1–f.2："here" 指能力来源当前所在的位置，用契约 3.6 的
 *   sameLocationAs: "source" 锚点表达（同 ogn/leona-determined）。
 * - 424.1 / 424.1.a：Stun 是效果型受限动作；effect.stun 已合入并由此提交 stun 动作。
 * - 括注 "(It doesn't deal combat damage this turn.)" 是 424.1.b 的提醒文本，不另写指令。
 *
 * status 判定（README 第 2 节，2026-10-17 复核）：judge-required —— 三处实测缺口，均不近似实现：
 * 1. [Ambush]（822.1.b/822.1.c）的关键词展开已合入（两个 static 声明），但没有消费方：
 *    createEngineStaticBinder（programs/statics.ts）对 play-location-permission 抛
 *    "no layer mapping"，对 continuous.timing 抛 "Unsupported static appliesTo [\"card\"]"，
 *    因此位置许可与条件 Reaction 都进不了图层；Chain 的 canAct/describePlay 也不读这两类声明。
 * 2. attack-declared 时点在封闭枚举中声明但没有已合入发射方：combat/ 的流程不发出该时点
 *    （start-combat 仍以 TurnCombatBlockedError("combat-start-transaction") 阻断），触发在真实链路上不可达。
 * 3. 触发过滤的 sameLocationAs 锚点在卡牌绑定路径被拒：translateTriggerFilter/
 *    translateObjectFilter（programs/filters.ts）对目标过滤的 sameLocationAs 抛
 *    "Unsupported filter field sameLocationAs"，因此本卡的 attack-declared 订阅即使有时点也无法注册
 *    （缺陷记录在引擎事件/过滤批次，不再引用已完成的任务号）。
 * "When I attack, [Stun] an enemy unit here" 的结构、目标过滤与 sameLocationAs 锚点已用
 * 已合入的 effect.stun + 解释器/参考内核真实执行验证（见 golden）。
 */
export default {
  canonicalCardId:
    "card.hash-940239e930273675dbfef51d216846a7ba2391c6eb507a28893f250c32eee6cd",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处实测缺口，均不近似实现：(1) [Ambush]（822.1.b/822.1.c）的两个 static 展开（play-location-permission 与 " +
    "continuous.timing）没有图层消费方——createEngineStaticBinder（programs/statics.ts）分别抛 " +
    "\"Static ability kind play-location-permission has no layer mapping\" 与 \"Unsupported static appliesTo [\\\"card\\\"]\"，" +
    "Chain 的 describePlay/canAct 也不读位置许可或条件 Reaction。" +
    "(2) events/timing-points.ts 的 attack-declared 没有发射方：combat/flow.ts 的 start-combat 仍以 " +
    "TurnCombatBlockedError(\"combat-start-transaction\") 阻断，战斗角色/伤害交易未接线，触发在真实链路上不可达。" +
    "(3) 目标过滤的 sameLocationAs 锚点被卡牌绑定路径拒绝——programs/filters.ts 的 translateObjectFilter/" +
    "translateTriggerFilter 对它抛 \"Unsupported filter field sameLocationAs\"，因此 attack-declared 订阅的注册本身会失败。" +
    "「When I attack, [Stun] an enemy unit here」的触发结构、目标过滤与 effect.stun 动作已在 golden 中用解释器与参考内核真实执行；" +
    "整卡不因此标记 executable。",
  abilities: [
    // 822.1：印刷的 [Ambush]（无印刷数值，不写 value）。
    { kind: "keyword", keyword: "ambush" },
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: { event: "attack-declared", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          id: "vi-peacekeeper.stun-enemy-here",
          op: "effect.stun",
          args: { target: { kind: "constant", value: "vi-peacekeeper.enemy-here" } },
          targets: [
            {
              id: "vi-peacekeeper.enemy-here",
              // 355.9/355.10 的选目标 + 053.3 的 "here" 位置锚点。
              filter: {
                type: "unit",
                zone: "board",
                controller: "opponent",
                sameLocationAs: "source"
              },
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
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "When I attack, [Stun] an enemy unit here. (It doesn't deal combat damage this turn.)"
} satisfies CardProgram;
