import type { CardProgram } from "../../ir/index.js";

/**
 * Brittle Steel（ven-003-166）— Spell，2 能量 + 1 点 Fury 力量，领域 Fury，标签 无。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，ven-003-166，逐字）：
 *   "Kill a gear.\n[Flow] :rb_energy_4::rb_rune_fury: (You may play this from your trash for its Flow cost. Then banish it.)"
 *
 * 规则依据（Core Rules v1.5）：
 * - 「Kill a gear」是 Kill 指令（429.1.a.1.a 的主动消灭、429.6 的书写形式）：355.9.a.1 规定
 *   未特别说明时 "gear" 指 Board 上的对象；355.10 的豁免都不适用（该对象由玩家在 Finalize
 *   选择，不是按特征程序化选定），所以它是目标（355.7、355.8），作用域为一张 Gear。
 *   消灭本身交给已合入的 effect.kill 原语提交 {type:"kill"} 游戏动作；进入弃牌堆、消灭归因
 *   （429.5）与死亡类时点由内核负责，本程序不手改区域。
 * - 「[Flow] :rb_energy_4::rb_rune_fury:」是 829.1 / 829.1.a 的法术关键词：829.1.b 把它展开为
 *   「你可以从弃牌堆按其 Flow 费用打出此牌，然后放逐它」，829.1.b.1 说明“然后放逐”是延迟替代
 *   效果，829.1.c.1 说明 Flow 费用替代基础费用（本卡印刷为 4 能量 + 1 点 Fury 力量，135.2.e.4）。
 *   卡文件只声明关键词（cards/README.md 第 5 节）；展开与流程归 effects/keywords/Flow.ts。
 *
 * 复核（2026-10-17，M2 覆盖率复核）：逐项对照当前源码实测，两处缺口仍成立，并把
 * 旧的“消费方完全未合入”细化为当前的实际断点。
 *
 * status = judge-required（两处缺口，均不近似实现）：
 * 1. 印刷 Flow 费用无法送进展开：契约 3.1 的 KeywordAbility 只有 keyword / value，而 829.1.c 的
 *    Flow 费用是 CostSpec；effects/keywords/Flow.ts 的 FlowKeywordInput 消费侧已接受 cost /
 *    params.cost，但 IR 的 KeywordAbility 没有承载字段、programs/keywords.ts 的 expandProgram
 *    仍以 `def.expand({ value, host })` 调用（契约 3.8.3 的生产侧未落地）。卡层因此无法声明
 *    4 能量 + 1 点 Fury 力量，既不臆造额外字段，也不用 value: 4 冒充费用。
 * 2. Flow 展开的两个消费方仍未接上：
 *    (a) 费用侧：实测 buildCostPlan 的 baseModifications 已能接受 `kind: "flow"` 的 CostSpec
 *        并替换基础费用（对 trash 中的 Spell 生效，对不在 trash 的来源正确拒绝），RIFT-261 的
 *        扩展费用管线是合入的；但没有任何生产路径把 Flow.ts 展开出的 `flow.cost` 静态声明接到
 *        CostPlanInput.baseModifications：programs/statics.ts 的 layerFor 对 kind "flow.cost"
 *        没有图层映射（无 layer 声明、也不含 might/copy/type/timing/keyword 等片段），
 *        bindStatic 实测抛 “Static ability kind flow.cost has no layer mapping”。
 *    (b) 替代侧：829.1.b.1 的“然后放逐它”需要匹配 Chain 离开并排除法术自身指示的离链。
 *        replacement/pattern.ts 的 ACTION_KINDS 仍没有 object-leaves-chain 条目，且闭合的
 *        GameAction 没有 leavingInstruction 标记；实测 bindReplacement 对 Flow 展开出的
 *        替代能力抛 “Unsupported replacement opcode: effect.banish”（连被替代事件的动作都
 *        还没进入可绑定集合）。continuous.timing 的“从弃牌堆打出”位置许可也未合并。
 * 已合入并真实执行的部分：「Kill a gear」的 effect.kill（429.1/429.6）；RIFT-682 模板
 * 经真实入链、Finalize 和事件管线从手牌执行原始程序，并用真实 Retreat 使目标失效
 * （359.3.e）。这不证明 Flow；测试台 pay 动作还不扣 Power，不能充当完整费用证据。
 * 依赖：Flow 声明到费用计划（baseModifications）与替代匹配（object-leaves-chain /
 * leavingInstruction）两侧的生产接线。
 * 无契约变更请求以外的臆造：未在卡里重写 Flow 或放逐逻辑。
 */
export default {
  canonicalCardId: "card.hash-045b07d4199255ec6dcfd300272520972fba1ee89dc4e3cfe4e63f1f6b6c95e3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口，均不近似实现：(1) 印刷 Flow 费用送不进展开——契约 3.1 的 KeywordAbility 只有 keyword / value，" +
    "829.1.c 的 Flow 费用是 CostSpec；effects/keywords/Flow.ts 的 FlowKeywordInput 消费侧已接受 cost / params.cost，" +
    "但 IR 的 KeywordAbility 没有承载字段、programs/keywords.ts 的 expandProgram 仍以 def.expand({ value, host }) 调用" +
    "（契约 3.8.3 的生产侧未落地），卡层无法声明 4 能量 + 1 点 Fury 力量，也不臆造字段或用 value: 4 冒充费用。" +
    "(2) Flow 展开的两个消费方仍未接上：(a) 费用侧——buildCostPlan 的 baseModifications 已能接受 kind: \"flow\" 的 CostSpec " +
    "并替换基础费用（对 trash 中的 Spell 生效、对不在 trash 的来源正确拒绝），但没有任何生产路径把 flow.cost 静态声明接到 " +
    "CostPlanInput.baseModifications：programs/statics.ts 的 layerFor 对 kind \"flow.cost\" 没有图层映射，bindStatic 实测抛 " +
    "“Static ability kind flow.cost has no layer mapping”。(b) 替代侧——829.1.b.1 的“然后放逐它”需要匹配 Chain 离开并排除" +
    "法术自身指示的离链；replacement/pattern.ts 的 ACTION_KINDS 仍没有 object-leaves-chain，闭合的 GameAction 也没有 " +
    "leavingInstruction 标记，bindReplacement 实测对 Flow 替代抛 “Unsupported replacement opcode: effect.banish”；" +
    "continuous.timing 的“从弃牌堆打出”位置许可未合并。" +
    "已合入并真实执行：「Kill a gear」的 effect.kill（429.1/429.6，355.9.a.1 的 Board Gear 目标）由 RIFT-682 模板经原始程序入链、" +
    "Finalize、事件管线执行，并覆盖真实 Reaction 使目标失效；RIFT-701 模板进一步经原始程序入链、Finalize 锁定敌方 Gear 并发布 killed 链接，且覆盖无合法目标边界；测试台 pay 仍未扣 Power，不作为完整费用证据。" +
    "依赖：flow.cost 到费用计划的接线与 object-leaves-chain / leavingInstruction 的替代匹配。",
  abilities: [
    {
      // 829.1.a：Flow 出现在法术上；本卡只声明关键词，展开归 keywords/Flow.ts（见 judgeReason）。
      kind: "keyword",
      keyword: "flow"
    },
    {
      kind: "play",
      // 印刷基础费用：2 能量 + 1 点 Fury 力量（catalog energy 2 / power 1 / domains ["Fury"]）。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // 「Kill a gear」：355.9.a.1 的 Board Gear 目标；消灭走已合入的 effect.kill。
          id: "brittle-steel.kill-gear",
          op: "effect.kill",
          args: { target: { kind: "constant", value: "brittle-steel.gear" } },
          targets: [
            {
              id: "brittle-steel.gear",
              filter: { type: "gear", zone: "board" },
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
    "Kill a gear.\n" +
    "[Flow] :rb_energy_4::rb_rune_fury: (You may play this from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;
