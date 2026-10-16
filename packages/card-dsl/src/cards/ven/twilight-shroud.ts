import type { CardProgram } from "../../ir/index.js";

/**
 * Twilight Shroud（ven-031-166）— Spell，1 能量、无印刷力量，领域 Calm，标签 无。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，ven-031-166，逐字）：
 *   "Give a friendly unit +1 :rb_might: this turn. It can't be chosen by enemy spells and abilities this turn.\n[Flow] :rb_energy_2: (You may play this from your trash for its Flow cost. Then banish it.)"
 *
 * 规则依据（Core Rules v1.5）：
 * - 「Give a friendly unit +1 Might this turn」是带 end-of-turn 期限的临时 Might 修改
 *   （317.2.c 于回合结束清理时到期；143.2.a 规定 “Might” 指当前有效 Might），属 layers 的
 *   arithmetic 层持续效果（契约 3.4/3.6 的 continuous.might）；不是 Buff 计数
 *   （702/703：Buff 是 counter，与 Might 值修正不是一回事），effect.buff 文件头亦如此声明。
 *   「a friendly unit」由玩家在 Finalize 选择（355.5.a 的同类示例），是目标（355.7/355.9.b：
 *   “friendly” 是该单位的控制者限制）。
 * - 「It can't be chosen by enemy spells and abilities this turn」是 355.9.b 明文列举的目标
 *   限制（规则原文的第二个例子正是这句话：这类单位即使满足其它限制，也不是敌方法术/能力的
 *   合法目标）；它是持续期限为 “this turn” 的目标合法性限制（054.1 的“禁止优于许可”），
 *   由持续限制/目标系统消费，不是一条独立结算指令。
 * - 「[Flow] :rb_energy_2:」同 Brittle Steel 的判定：829.1.b 的功能文本、829.1.b.1 的延迟
 *   放逐替代、829.1.c.1 的替代费用；印刷 Flow 费用为 2 能量（无 Power）。
 *
 * status = judge-required（三处缺口，均不近似实现）：
 * 1. 临时 Might 修改没有已合入原语：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，
 *    effects/instructions 下没有任何原语通过 ResolveContext.addContinuous 注册
 *    continuous.might（RIFT-91 只合入了 layers 求值侧）。
 * 2. 目标限制没有消费方：chain/ 的目标计划只按 ObjectFilter 的字段匹配（layers/filter.ts 的
 *    objectId/cardId/type/zone/location/controller/owner/states/tags/characteristics），不读取
 *    任何“不可被敌方法术/能力选中”的持续限制；continual.restrict 类原语（RIFT-9 清单第 27 项
 *    continuous.restrict）没有文件，也没有把 CardProgram 的 static 能力注册成持续效果的路径。
 * 3. 印刷 Flow 费用送不进展开（契约 3.8.3 的 params.cost 未落地），Flow 消费方依赖
 *    RIFT-261/RIFT-260。
 * 已合入并可真实执行的部分：目标形状本身（type/zone/controller 与 355.9.b 的限制语义）；
 * golden 用参考内核与已合入的过滤器匹配器断言该 TargetSpec 的合法性判定，并锁定未注册的
 * Might / 限制指令在当前解释器上 fail-closed（抛错而不是静默施加 Buff）。
 * 依赖：continuous.might 指令原语（RIFT-9 / RIFT-91）、目标限制消费方（RIFT-90 之后）、
 * RIFT-261/RIFT-260（Flow）。
 */
export default {
  canonicalCardId: "card.hash-e54ee1b49e982f2d0d89cb2a1ada3688523cfee6c53db33c9aa872c7802ea0df",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1)「Give a friendly unit +1 :rb_might: this turn」是带 end-of-turn 期限的临时 Might 修改" +
    "（317.2.c/143.2.a，layers 的 arithmetic 层 continuous.might）：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，" +
    "effects/instructions 下也没有任何原语通过 ResolveContext.addContinuous 注册它（RIFT-91 只合入了层求值侧）；" +
    "effect.buff 只处理 CR 702 的 Buff 计数，不能代替。" +
    "(2)「It can't be chosen by enemy spells and abilities this turn」（355.9.b 的原文示例）是持续期限内的目标合法性限制，" +
    "而 chain/ 的目标计划只按 ObjectFilter 字段匹配（layers/filter.ts），不读取任何“不可被敌方法术/能力选中”的持续限制；" +
    "continuous.restrict 类原语（RIFT-9 第 27 项）没有文件，也没有把 CardProgram 的 static 能力注册成持续效果的路径。" +
    "(3) 印刷 Flow 费用（829.1.c：2 能量）送不进展开——契约 3.8.3 的 params.cost 未落地，Flow 消费方依赖 RIFT-261/RIFT-260（829.1.b.1）。" +
    "已合入可验证：目标形状（team/zone 与 355.9.b 的 “friendly” 控制者限制）由 golden 用参考内核与合并过滤器匹配器断言，" +
    "并锁定未注册的 Might / 限制指令在解释器上 fail-closed（抛错而非静默施加 Buff）。" +
    "依赖：continuous.might 指令原语（RIFT-9/RIFT-91）、目标限制消费方（RIFT-90 之后）、RIFT-261/RIFT-260。",
  abilities: [
    // 829.1.a：Flow 在法术上；卡只声明关键词（展开见 judgeReason 第 3 条）。
    { kind: "keyword", keyword: "flow" },
    {
      kind: "play",
      // 印刷基础费用：1 能量；catalog power 为 null（无印刷力量），不改写为 0。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 }
      },
      body: [
        {
          // 「Give a friendly unit +1 Might this turn」：待接线的临时 Might 修改（见 judgeReason 第 1 条）。
          id: "twilight-shroud.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "twilight-shroud.friendly-unit",
              filter: { type: "unit", zone: "board", controller: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 「It can't be chosen by enemy spells and abilities this turn」：对同一单位的持续目标限制
          // （355.9.b），用符号选择器表达 “it”（359.3.e.14）。op 未注册，见 judgeReason 第 2 条。
          id: "twilight-shroud.cannot-be-chosen",
          op: "continuous.restrict",
          linkedTo: "twilight-shroud.grant-might",
          args: {
            restriction: { kind: "constant", value: "cannot-be-chosen-by-enemy-spells-and-abilities" },
            appliesTo: { kind: "constant", value: { target: "twilight-shroud.friendly-unit" } },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "twilight-shroud.friendly-unit",
              filter: { type: "unit", zone: "board", controller: "controller" },
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
    "Give a friendly unit +1 :rb_might: this turn. It can't be chosen by enemy spells and abilities this turn.\n" +
    "[Flow] :rb_energy_2: (You may play this from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;
