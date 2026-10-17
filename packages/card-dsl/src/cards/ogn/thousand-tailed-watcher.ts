import type { CardProgram } from "../../ir/index.js";

/**
 * Thousand-Tailed Watcher — CR v1.5 805, 383.4.a, 355.10.d, 478.1.c.
 * 复核 2026-10-17：正文的 -3 Might 已有真实执行证据，Accelerate 仍缺
 * (1) accelerate.cost → CostPlan.optionalAdditional 的生产接线（图层不可绑定、
 * describePlay 不读该静态声明），(2) 付费后才安装的延迟入场替代（805.2.b）。
 */
const thousandTailedWatcher = {
  canonicalCardId: "card.hash-0c45b29063c3531b9891e06fa06538c7ff50e7ecd9a1f6f1147e18ee33176c81",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Accelerate] 的两段生产接线仍缺（2026-10-17 复核，CR 805.1.b、805.2.b、805.6.a）：" +
    "(1) 可选附加费用进不了 Finalize——关键词展开的静态 accelerate.cost 被 programs/statics.ts::layerFor 拒绝" +
    "（实测 ProgramBindingError \"Static ability kind accelerate.cost has no layer mapping\"），" +
    "而 programs/play.ts::describePlay 只读 play 能力自身的 cost，返回的 ChainItem 没有 cost 字段，" +
    "cost-plan 的 optionalAdditional 里永远不会出现 accelerate 组件，也没有支付回执；" +
    "(2) 805.2.b 的「付费后才安装」无从判定：把展开的 replacement 直接绑到管线，实测未支付任何费用就由横置入场改成就绪入场" +
    "（同一路径下的普通单位仍是横置入场），不能这样放行。" +
    "已合入并有执行证据的是正文：continuous.might 取敌方单位集合、-3、minimum 1（478.1.c）与 this-turn 到期，" +
    "经生产触发注册结算后敌方 3→1、5→2，己方单位与本卡不变；cost.pay、附加费用规划本身、关键词展开与 CardProgram 触发注册均已合入。",
  abilities: [
    { kind: "keyword", keyword: "accelerate" },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "watcher.debuff-enemy-units",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -3 },
            duration: { kind: "constant", value: "this-turn" },
            minimum: { kind: "constant", value: 1 },
            // 355.10.d："enemy units" 是按特征选择的一组（无玩家选择），用集合查询表达。
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                filter: { zone: "board", type: "unit", controller: "opponent" }
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me enter ready.)\n" +
    "When you play me, give enemy units -3 :rb_might: this turn, to a minimum of 1 :rb_might:."
} satisfies CardProgram;

export default thousandTailedWatcher;
