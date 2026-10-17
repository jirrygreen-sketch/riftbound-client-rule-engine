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
 * status = judge-required：
 * - 355.10.b 的 sameLocationAs 锚点尚未被 programs/filters.ts 接受，
 *   describePlay -> translateInstructionTargets 无法绑定这张卡。
 * - TargetSpec.location 虽有选择器类型，validation.ts 将非具体地点按 LocationFilter
 *   校验，仍拒绝 target-location/location-of 的 kind，不能靠换字段绕过此缺口。
 * - chain/interpreter-adapter.ts 的字面参数表未列 effect.stun.target，原始 Expr
 *   无法通过该原语要求字符串的 argsSchema；直接解释器执行不证明链路径已连通。
 * Might、Stun 与解释器锚点子效果保留真实执行测试，不硬编码地点。
 */
const program = {
  canonicalCardId: "card.hash-7df5a08371438cce0299d5cb0462f93ad1b442be5e5d5f288e5a0ce882fa4230",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 CR 355.10.b 的动态位置锚点生产接线：programs/filters.ts 拒绝 sameLocationAs，describePlay → translateInstructionTargets 无法绑定本卡。TargetSpec.location 虽声明 LocationSelector 类型，当前 validation.ts 将非具体地点按 LocationFilter 校验，拒绝 target-location/location-of 的 kind；因此也不能用该字段表达所选友方单位的位置。还缺 chain/interpreter-adapter.ts 对 effect.stun.target 的字面参数解包：当前传入 Expr，原语 argsSchema 要求字符串。需要统一卡牌校验、目标翻译、动态位置绑定与原语参数适配。",
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
          id: "heroic-charge.grant-might",
          // continuous.might 原语固定 arithmetic 层（没有 layer 参数）；
          // this-turn → end-of-turn 期限（317.1.a / 468.7.c）。objects 用契约 3.6 的选择器
          // 指回本指令声明的 TargetSpec。
          op: "continuous.might",
          args: {
            mode: { kind: "constant", value: "add" },
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "heroic-charge.friendly-unit" }
            }
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

