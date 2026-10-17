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
 * status 判定（README 第 2 节）：judge-required —— 两处依赖未合入，均不近似实现：
 * 1. [Ambush]（822）的关键词展开已合入，但其打出位置许可与 Reaction 时间许可
 *    （continuous.timing + 位置许可）没有消费方（依赖 RIFT-84）。
 * 2. attack-declared 时点在封闭枚举中声明但没有已合入发射方：combat/ 的流程（引擎批 5 /
 *    RIFT-31/33/77）不发出该时点，且没有把 CardProgram 触发注册进 TriggerRegistration 的
 *    路径已合入，但触发在真实链路上不可达（同 icevale-archer 的判定）。
 * "When I attack, [Stun] an enemy unit here" 的结构、目标过滤与 sameLocationAs 锚点已用
 * 已合入的 effect.stun + 解释器/参考内核真实执行验证（见 golden）。
 */
export default {
  canonicalCardId:
    "card.hash-940239e930273675dbfef51d216846a7ba2391c6eb507a28893f250c32eee6cd",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入：(1) [Ambush]（822.1.b/822.1.c）的关键词展开已合入，但" +
    "其「可向有你控制单位的战场打出」的位置许可与「按此方式打出时具有 [Reaction]」的时间许可" +
    "（continuous.timing + 位置许可）都没有消费方，依赖 RIFT-84（Ambush/Hidden 消费接线）。" +
    "(2) attack-declared 时点虽然在封闭枚举中（events/timing-points.ts），但没有已合入的发射方——" +
    "combat/ 不发射战斗时点（引擎批 5 / RIFT-31/33/77）；CardProgram 的 triggered ability 注册接线已合入，" +
    "但触发在真实链路上仍不可达。" +
    "「When I attack, [Stun] an enemy unit here」的触发结构、目标过滤（controller: opponent + sameLocationAs 锚点）" +
    "与 effect.stun 动作已在 golden 中用解释器与参考内核真实执行；整卡不因此标记 executable，不近似实现 Ambush。",
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
