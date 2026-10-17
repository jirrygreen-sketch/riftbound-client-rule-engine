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
 * status = judge-required（三处缺口，均不近似实现）：
 * 1. 印刷 Flow 费用无法送进展开：契约 3.1 的 KeywordAbility 只有 keyword / value，而 829.1.c 的
 *    Flow 费用是 CostSpec；已合入的 KeywordDef.expand 签名（effects/keyword-contract.ts）只有
 *    value/host——effects/keywords/Flow.ts 的 FlowKeywordInput 消费侧已接受 cost /
 *    params.cost，但 IR 的 KeywordAbility 没有承载字段的形状、expandProgram 也不会传入
 *    （契约 3.8.3 的生产侧未落地）。因此卡层无法声明 4 能量 + 1 Fury 力量，既不臆造额外
 *    字段，也不用 value: 4 冒充费用。
 * 2. Flow 展开的消费方未合入：keywords/Flow.ts 自己记录 flow.cost 需要 RIFT-261 的费用消费方
 *    暴露可选的 alternative cost、保留 null 印刷费并记录“哪一份 Flow 实例被支付”；
 *    replacement.event 需要 RIFT-260 的替代注册/排序路径（区分正常离链与法术自身指示的离链，
 *    829.1.b.1——programs/lifecycle.ts 的 bindReplacementOnChain 已合入替换通道，但
 *    leavingInstruction 过滤键会被 programs/filters.ts 拒收）；continuous.timing 的
 *    “从弃牌堆打出”位置许可与链项终态也未合并。
 * 3. 卡牌程序 → 关键词展开 → 链的接线（契约 3.5）未合入，与 Accelerate / Equip 的判定同型。
 * 已合入并真实执行的部分：「Kill a gear」的 effect.kill（429.1/429.6），golden 用解释器 +
 * 参考内核以 Finalize 锁定的目标真实执行，并覆盖目标失效（359.3.e）分支。
 * 依赖：RIFT-261（Flow 费用消费）、RIFT-260（replacement 注册）、关键词接线任务。
 * 无契约变更请求以外的臆造：未在卡里重写 Flow 或放逐逻辑。
 */
export default {
  canonicalCardId: "card.hash-045b07d4199255ec6dcfd300272520972fba1ee89dc4e3cfe4e63f1f6b6c95e3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 印刷 Flow 费用送不进展开——契约 3.1 的 KeywordAbility 只有 keyword / value，" +
    "829.1.c 的 Flow 费用是 CostSpec；已合入的 KeywordDef.expand 只有 value/host，" +
    "effects/keywords/Flow.ts 的 FlowKeywordInput 消费侧已接受 cost / params.cost，" +
    "但 IR 的 KeywordAbility 没有承载字段的形状、expandProgram 也不会传入（契约 3.8.3 的生产侧未落地），" +
    "卡层无法声明 4 能量 + 1 点 Fury 力量，也不臆造字段或用 value: 4 冒充费用。" +
    "(2) Flow 展开的消费方未合入：Flow.ts 记录 flow.cost 需要 RIFT-261 的费用消费方（可选 alternate cost、保留 null 印刷费、" +
    "记录被支付的 Flow 实例），「然后放逐」（829.1.b.1 的延迟替代）需要 RIFT-260 的替代注册/排序路径——" +
    "programs/lifecycle.ts 的 bindReplacementOnChain 已合入替换通道，但 leavingInstruction 过滤键会被 " +
    "programs/filters.ts 拒收；从弃牌堆打出的位置许可与链项终态同样未合并。" +
    "(3) 卡牌程序 → 关键词展开 → 链的接线（契约 3.5）未合入（同 Accelerate / Equip 判定）。" +
    "已合入并真实执行：「Kill a gear」的 effect.kill（429.1/429.6，355.9.a.1 的 Board Gear 目标）由 golden 以解释器 + " +
    "参考内核执行。依赖：RIFT-261、RIFT-260 与关键词接线任务。",
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
