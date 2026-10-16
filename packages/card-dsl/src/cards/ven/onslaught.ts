import type { CardProgram } from "../../ir/index.js";

/**
 * Onslaught（ven-081-166）— Spell，4 Energy，无印刷 Power，领域 Body。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-081-166，逐字）：
 *   "Give a unit +6 :rb_might: this turn.\n[Flow] :rb_energy_4: (You may play this
 *    from your trash for its Flow cost. Then banish it.)"
 *
 * 规则依据（Core Rules v1.5）：
 * - "Give a unit +6 :rb_might: this turn"：被点名的单位在公开区域（Board）由玩家具体选择，
 *   按 355.7 / 355.9.a.1 / 355.9.b 是 Target（Finalize 锁定、Resolve 重验）；"+6 Might"
 *   是带回合期限的临时 Might 修正（143.2.a 的有效 Might 读数，317.2.c 在回合结束的 3d
 *   步骤同时到期），属 arithmetic 图层（478 / 478.1.a）。
 * - [Flow]（829 / 829.1.a / 829.1.b / 829.1.c）：Flow 是法术上的被动关键词，功能等价于
 *   "你可以从废牌堆以 Flow 费用打出此牌，然后放逐它"；印刷费用为 :rb_energy_4:（4 Energy）。
 *   按 README 第 5 节本卡只声明关键词身份，展开与费用改写归 effects/keywords/Flow.ts。
 *
 * status = judge-required（两处缺口均不近似实现）：
 * 1. 缺临时 Might 修正的卡牌侧指令原语：effects/instructions/ 只有 effect.* 文件，没有
 *    continuous.might（RIFT-258 的 continuous.* 指令批次刻在 sibling 分支、未合入本基线），
 *    契约 3.6 的封闭 GameAction 集合也没有 Might 修改动作；layers 引擎（RIFT-91）能求值
 *    arithmetic 持续效果，但没有已注册 op 通过 ResolveContext.addContinuous 注册它。
 *    effect.buff 明确只做 Buff 计数（702 / 703），不得用来近似临时 Might 修正。
 * 2. Flow 关键词展开依赖未合入：Flow.ts 自身记录 flow.cost 需要 RIFT-261 的替代费用消费方
 *    （选择 Flow 费用、保留 energy:null、记录实际支付的 Flow 实例），替代放逐需要 RIFT-260 的
 *    replacement 注册/排序路径；[Flow] 的 Trash 打出许可（829.1.b.2 不改变可打出的时机）也没有
 *    消费方。印刷 Flow 费用（4 Energy）按契约 3.8.3 应经 KeywordDef.expand 的 params.cost 承载，
 *    但 card-dsl 的 KeywordAbility 没有该字段（见最终回复的契约变更请求），故只在本注释与
 *    judgeReason 中记录，不伪造成第二条启动能力。
 * 依赖：continuous.might 指令原语（RIFT-258 / RIFT-91）、Flow 费用与替代路径（RIFT-260/261）。
 * golden 覆盖校验、身份与结构；未合入的两半以 test.todo 注明缺什么。
 */
const onslaught = {
  canonicalCardId: "card.hash-3d956150539f05acad046c9b3b303490605a2e9f9546aa9bc58fb0b8256412a9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) 缺临时 Might 修正的卡牌侧指令原语——effects/instructions/ 只有 effect.* 文件，" +
    "没有 continuous.might（continuous.* 指令批次属 RIFT-258，且 layers 的 RIFT-91 只合入求值侧），" +
    "契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，因此「Give a unit +6 :rb_might: this turn」" +
    "（143.2.a 有效 Might、317.2.c 回合结束到期、478.1.a arithmetic 图层）无法执行；" +
    "effect.buff 只做 Buff 计数（702/703），不得近似。" +
    "(2) [Flow]（829.1）的展开依赖未合入：Flow.ts 记录 flow.cost 需要 RIFT-261 的替代费用消费方、" +
    "替代放逐需要 RIFT-260 的 replacement 路径，且印刷 Flow 费用（4 Energy）按契约 3.8.3 需经 " +
    "params.cost 承载而 KeywordAbility 无该字段（契约变更请求）。" +
    "依赖：continuous.might 指令原语（RIFT-258 / RIFT-91）、Flow 费用与替代路径（RIFT-260/261）。不近似实现。",
  abilities: [
    // 829.1.c：印刷 "[Flow] :rb_energy_4:"；费用本身归 Flow.ts 的展开（见 judgeReason）。
    { kind: "keyword", keyword: "flow" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        // 印刷费用 4 Energy（power: null 表示无印刷 Power，不写成 0）。
        energy: { kind: "constant", value: 4 }
      },
      body: [
        {
          id: "onslaught.give-plus-6",
          // 「+6 Might this turn」= arithmetic 图层的带期限持续效果；该 op 未注册（见 judgeReason）。
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 6 },
            duration: { kind: "constant", value: "this-turn" },
            target: { kind: "constant", value: "onslaught.unit" }
          },
          targets: [
            {
              id: "onslaught.unit",
              // "a unit"：Board 上的单位（355.9.a.1），无控制者限制。
              filter: { type: "unit", zone: "board" },
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
    "Give a unit +6 :rb_might: this turn.\n" +
    "[Flow] :rb_energy_4: (You may play this from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;

export default onslaught;
