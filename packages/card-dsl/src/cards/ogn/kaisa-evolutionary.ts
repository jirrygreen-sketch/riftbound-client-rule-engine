import type { CardProgram } from "../../ir/index.js";

/**
 * Kai'Sa, Evolutionary (ogn-112-298) — Unit, 6 energy + 1 Mind power, Might 6。
 *
 * 原文：[Ganking] (I can move from battlefield to battlefield.)
 *      When I conquer, you may play a spell from your trash with Energy cost
 *      less than your points without paying its Energy cost. Then recycle it.
 *      (You must still pay its Power cost.)
 *
 * 规则依据（CR v1.5）：
 * - [Ganking]：810 的被动关键词（810.1.b "I may move to a battlefield from another
 *   battlefield with a standard move."）；卡片只声明 keyword，展开由
 *   effects/keywords/Ganking.ts 负责（continuous.movement）。
 * - “When I conquer”：征服触发，时点 "conquer"（383.4.c.1；471.1 / 473.2.a）。
 * - “you may play a spell from your trash …”：383.3.a 的条件性执行决定 → 契约 §3.9
 *   的 choice.optional 把被选择的指令包进 body。
 * - 355.10.a：Trash 是公开区域（355.10.a.1 列出 Trashes），所以“trash 里的一张
 *   法术牌”是选目标（不是 pick），用 targets + TargetSpec。
 * - “with Energy cost less than your points”：目标过滤条件引用玩家的 Points
 *   （4138–4155 的计分与点数）；这是一个跨对象的数值比较（取选择的牌 printed
 *   Energy 与能力控制者当前 points 比较），冻结 IR 的 Condition 只有两侧 Expr 比较，
 *   在 TargetSpec.filter 里没有等价的“取值时机即选择时”的动态比较表达 → 见下。
 * - “without paying its Energy cost … (You must still pay its Power cost)”：
 *   356.1.b.2 的 "ignoring its Energy cost"——只把 base Energy cost 置 0，Power 仍
 *   按 359.3 正常支付。
 * - “Then recycle it”：同一条效果的后续独立句子（359.3.e.14 的独立性），回收
 *   刚打出并已进 Trash 的那张牌（417.1 的 Recycle）。
 *
 * 状态：judge-required。已合入的时点（conquer 由 TurnFlow Score wave 发出）、
 * choice.optional、effect.play（含 cost 覆盖与 location 改写）与 effect.recycle 能表达骨架，
 * golden 对「trash 法术以零 Energy finalized 计划被打出」与「拒绝执行」有真实执行证据，
 * 但整条效果仍有三处缺口：
 * 1. “Energy cost less than your points”的动态目标过滤：需要把能力控制者当前 Points
 *    （CR 4138–4155）与候选牌 printed Energy 在 Finalize 比较的过滤谓词；合并的
 *    ObjectFilter 实现（layers/filter.ts、参考内核 matchesFilter、chain/engine.ts 的
 *    query 归一化）只识别 type/tags/controller/owner/zone/location/states，
 *    energyLessThan/points 键被静默忽略，写成它会选中任意法术（近似实现）。
 * 2. “ignoring its Energy cost”需要按 356.1.b.2 对实际选中的牌生成 base Energy=0、
 *    Power 保留的 finalized cost plan；静态 IR 生成不出该计划，cost.printed / cost.pay /
 *    cost.modify 未合入（RIFT-261）。
 * 3. “Then recycle it”要把上一步真正打出的那张牌的对象引用链接出来；effect.play 的链接值
 *    只有成功次数 played，没有对象引用（链/费用管线的结果绑定补齐）。
 * [Ganking]（810）的 KeywordDef（RIFT-83）已合入，但展开的 continuous.movement 只被
 * layers/rules 查询读取，卡牌/关键词展开→图层的注册接线未合入（RIFT-257）。
 * 依赖：RIFT-261（费用管线）、动态 points 比较谓词与链上结果绑定、RIFT-257（绑定/展开消费）。
 * 不近似实现。
 */
const kaisaEvolutionary = {
  canonicalCardId: "card.hash-697cf91efe23c8a9d145276f047432baac8d3218d9975045d3e27ad7573275ec",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1)「a spell from your trash with Energy cost less than your points」需要 Finalize 期比较候选牌 printed Energy " +
    "与能力控制者当前 Points（CR 4138–4155）的动态过滤谓词——合并的 ObjectFilter 实现（layers/filter.ts、参考内核 matchesFilter、" +
    "chain/engine.ts 的 query 归一化）只识别 type/tags/controller/owner/zone/location/states，energyLessThan/points 键被静默忽略；" +
    "(2)「without paying its Energy cost」需要按 356.1.b.2 对实际选中的牌生成 base Energy=0、Power 保留的 finalized cost plan，" +
    "cost.printed / cost.pay / cost.modify 未合入（RIFT-261）；(3)「Then recycle it」需要链接真正打出的那张牌的对象引用，" +
    "effect.play 的链接值只有成功次数。另：Ganking 的 KeywordDef（RIFT-83）已合入，但展开的 continuous.movement " +
    "没有卡牌/关键词展开→图层的注册接线（RIFT-257）。effect.play / effect.recycle / choice.optional 与 conquer 时点已合入并有执行测试。" +
    "依赖：RIFT-261、动态 points 比较谓词与结果绑定、RIFT-257。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "ganking" },
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquer", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "kaisa.opt-in",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Play a spell from your trash without paying its Energy cost?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "kaisa.play-spell",
                  op: "effect.play",
                  args: {
                    // 355.10.a / 355.10.a.1：Trash 是公开区域 → 使用 targets 选目标。
                    target: { kind: "constant", value: "kaisa.trash-spell" },
                    // 356.1.b.2：只忽略 Energy（base Energy cost 置 0），Power 仍须按被
                    // 选牌的印刷费用支付 —— 后者只有结算时才知道，静态 IR 生成不出可支付
                    // 的 finalized 计划，因此这里的计划只是形状（本卡 judge-required，
                    // RIFT-261 之前不得当作可执行费用）。
                    cost: { kind: "constant", value: { finalized: true, energy: 0 } }
                  },
                  targets: [
                    {
                      id: "kaisa.trash-spell",
                      filter: {
                        zone: "trash",
                        owner: "controller",
                        type: "spell",
                        // 动态条件：「Energy cost less than your points」需要
                        // Finalize 期的跨对象数值比较，保留占位形状。
                        energyLessThan: "controller-points"
                      },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                },
                {
                  id: "kaisa.recycle-it",
                  op: "effect.recycle",
                  linkedTo: "kaisa.play-spell",
                  args: {
                    // “Then recycle it” 指刚打出的那张牌；effect.play 目前只链接
                    // 成功次数，缺少对象引用绑定（见 judgeReason）。
                    objects: {
                      kind: "linked-value",
                      instructionId: "kaisa.play-spell",
                      key: "playedObjects"
                    }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
    "When I conquer, you may play a spell from your trash with Energy cost less than your points without paying its Energy cost. Then recycle it. (You must still pay its Power cost.)"
} satisfies CardProgram;

export default kaisaEvolutionary;
