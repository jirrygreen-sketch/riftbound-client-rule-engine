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
 * 当前执行边界见 judgeReason 与对应 golden；保留所有印刷语义。
 */
const onslaught = {
  canonicalCardId: "card.hash-3d956150539f05acad046c9b3b303490605a2e9f9546aa9bc58fb0b8256412a9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason: "当前缺口仅在 Flow 消费链（829.1.b / 829.1.b.1 / 829.1.c.3）：KeywordAbility / programs/keywords.ts 未把印刷的 4 Energy 通过 params.cost 传给 Flow.expand，programs/statics.ts 不能映射 flow.cost，尚无从 Trash 打出、选择并记录独立 Flow 费用实例的路径；离链 replacement 的 flow-cost-selected / leavingInstruction:false 仍未接到已支付实例及退出原因。通用费用计划、replacement 绑定与 continuous.might 已合入；+6 Might 及 317.2.c 回合结束到期有真实执行证据，不近似实现 Flow。",
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
          // 「+6 Might this turn」= arithmetic 图层的带期限持续效果；通过已注册 continuous.might 创建图层效果。
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 6 },
            duration: { kind: "constant", value: "this-turn" },
            objects: { kind: "constant", value: { kind: "target", id: "onslaught.unit" } }
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
