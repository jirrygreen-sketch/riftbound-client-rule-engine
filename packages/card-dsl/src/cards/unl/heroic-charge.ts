import type { CardProgram } from "../../ir/index.js";

/**
 * Heroic Charge (unl-155-219) — Spell, 3 energy, no printed power, Order.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-155-219，逐字):
 *   [Action] (Play on your turn or in showdowns.)
 *   Give a friendly unit +1 :rb_might: this turn and [Stun] an enemy unit at its
 *   location. (A stunned unit doesn't deal combat damage this turn.)
 *
 * 规则依据（CR v1.5）:
 * - [Action]（806）是许可类关键词：806.1.b/806.1.c 允许在自己的回合或 Showdown 中
 *   打出；卡牌只声明关键词，展开与链的时机判定属关键词注册表与 chain/（契约 3.7/3.5）。
 * - 「Give a friendly unit +1 :rb_might: this turn」是 143.2.a 的临时 Might 修正，
 *   在回合结束清理的 3d 步骤与其它 "this turn" 效果同时到期（317.2.c；433.1.a 图层）。
 *   effect.buff 的文件头明确：临时 Might 归 layers 的 continuous.might，绝不入
 *   Buff 计数器（702/703 的 Buff 是另一种东西）。
 * - 「[Stun] an enemy unit at its location」是 424.1 的 Stun 动作，由已合入的
 *   effect.stun 提交；424.1.a.1 已 Stunned 的单位不能再被 Stun（选择仍合法但无事发生）；
 *   424.1.a.2 的清除属回合结束清理，424.1.b 的「不贡献战斗伤害」是规则结果而非另一条指令。
 * - 「at its location」把敌方单位限制在所选友方单位所在位置（355.10.b 的 targeting
 *   restriction；位置锚点用冻结 ObjectFilter 的 sameLocationAs）。
 * - 括号内是该动作结果的释义，不是独立指令，因此不另写指令。
 *
 * status: judge-required —— 「+1 Might this turn」没有已合入原语：契约 3.6 的封闭
 * GameAction 集合没有 Might 修改动作，effects/instructions 也没有 continuous.might
 * 的卡牌入口（RIFT-91）。不把 +1 近似成 effect.buff（702 Buff 计数器）。Stun 半段
 * 已用 effect.stun 写全并在 golden 中真实执行（含目标失效边界）。
 *
 * 依赖：RIFT-91（layers/continuous.might 的卡牌指令入口）。无契约变更请求。
 */
const program = {
  canonicalCardId: "card.hash-7df5a08371438cce0299d5cb0462f93ad1b442be5e5d5f288e5a0ce882fa4230",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「Give a friendly unit +1 :rb_might: this turn」是 143.2.a 的临时 Might 修正（317.2.c 到期、433.1.a 图层），" +
    "契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effects/instructions 也没有卡牌可用的 continuous.might 指令" +
    "（图层消费方与期限归 RIFT-91）；effect.buff 的文档明确临时 Might 不入 Buff 计数器（702/703），不得近似。" +
    "「Stun an enemy unit at its location」只用已合入的 effect.stun（424.1）与 sameLocationAs 位置锚点，在 golden 中真实执行；" +
    "Stunned 的清除（424.1.a.2）与不贡献战斗伤害（424.1.b）是 turn/combat 的规则结果。" +
    "依赖：RIFT-91（layers/continuous.might）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 }
      },
      body: [
        {
          // 「Give a friendly unit +1 Might this turn」——按契约 3.6 的图层效果形状
          // 记录意图；没有已注册的 continuous.might 指令（见 judgeReason）。
          id: "heroic-charge.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "heroic-charge.friendly-unit",
              filter: { type: "unit", zone: "board", controller: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 「and [Stun] an enemy unit at its location」——424.1 的 Stun，用已合入的
          // effect.stun；「its location」是所选友方单位的位置锚点（355.10.b）。
          // 与 Might 半段是同一句「and」连接的两个独立动作，故不写 linkedTo。
          id: "heroic-charge.stun-enemy-unit",
          op: "effect.stun",
          args: {
            target: { kind: "constant", value: "heroic-charge.enemy-unit" }
          },
          targets: [
            {
              id: "heroic-charge.enemy-unit",
              filter: {
                type: "unit",
                zone: "board",
                controller: "opponent",
                sameLocationAs: { target: "heroic-charge.friendly-unit" }
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
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give a friendly unit +1 :rb_might: this turn and [Stun] an enemy unit at its location. (A stunned unit doesn't deal combat damage this turn.)"
} satisfies CardProgram;

export default program;

