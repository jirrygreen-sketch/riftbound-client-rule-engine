import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Clairvoyance (ven-056-166) — Spell, 7 energy, no printed Power/Might, domain Mind.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-056-166，逐字）：
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
 *   "[Predict 5]. (Look at the top 5 cards of your Main Deck. Recycle any of them and put " +
 *   "the rest back in any order.)\n" +
 *   "Draw 2."
 *
 * 规则依据（Core Rules v1.5）：
 * - [Reaction]（813.1 / 813.1.c）：许可类关键词，可在任意玩家的 Closed State 打出；
 *   卡侧只声明 keyword（契约 3.7），展开与链许可由 keywords/Reaction.ts 与 chain/ 负责。
 * - "[Predict 5]"（437.1 / 437.1.a / 437.3 / 437.4）：
 *   437.1 是“看主牌库顶一张并选择是否回收它”；印刷数值 5 时按 437.1.a 看 5 张、回收其中
 *   任意张、其余按任意顺序放回主牌库顶；437.4 不足时尽可能多看，437.4.a 明确不因此 Burn Out。
 *   本程序的 body 按 README 第 4 节的“用已有原语表达已支持部分”写成三步：
 *   1. effect.inspect（scope "top"、amount 5、choose 允许 0..5 张进入回收）—— 读牌库顶
 *      必须按契约 3.6 的 zoneSlice 保序语义由上游提供有序 picksSpecId；原语明确拒绝用
 *      无序 query 近似（effect.inspect 文件头），因此程序给出稳定的有序范围 id
 *      "clairvoyance.predict-top-5"，由调用方按该 id 提供牌库顶 5 张（保序）。
 *   2. effect.recycle —— 回收所选，objects 取前序 inspect 的链接值（417.1 / 417.6）。
 *   3. effect.order（destination "top"、count = 5 - 实际回收张数、chooseOrder true）
 *      —— 437.1.a 的“其余按任意顺序放回”；张数由 arithmetic(sub) + linked-value 计算，
 *      不写死。
 * - "Draw 2."：effect.draw（414.1 / 414.3，已合入原语），抽牌者缺省为能力控制者
 *   （190.6.d 的隐含 "you"）；与 Predict 步骤相互独立（359.3.e.11 尽可能执行），
 *   因此不写 linkedTo。
 *
 * 复核（2026-10-17，M2 覆盖率复核）：旧 judgeReason 的两条依赖均已落地——
 * RIFT-358 把 PickSpec.zoneSlice 接进链的 Finalize（chain/picks/plan.ts 的
 * finalizeOrderedPickPlans/lockSlice 以 ctx.zoneSlice 为唯一保序权威，绝不回退 query），
 * RIFT-358 的 linked/exclude 又让“其余按任意顺序放回”能直接读前序实际结果。
 * 因此 437.1.a 的三步不再需要调用方另行绑定：本卡自己声明有序来源，
 * effect.inspect 的 top 作用域由该 zoneSlice 保序供给。
 *
 * status = executable：整卡能力都有 v1.5 依据，且已用真实 ProgramBinding +
 * ChainEngine + EventPipeline（effects/testing/scenario）执行：
 * 1. 「[Predict 5]」（437.1 / 437.1.a / 437.4 / 437.4.a）写成已合入的三件套——
 *    effect.inspect（scope "top"、amount 5、0..5 张进入回收，有序来源由本卡的
 *    zoneSlice 在 Finalize 锁定）→ effect.recycle（回收所选，417.1.a）→
 *    effect.order（destination "top"、cardsPick 取“看过列表去掉已回收”的差集，
 *    437.1.a 的“其余按任意顺序放回”；张数由实际结果决定，不写死）。
 * 2. 「Draw 2.」是 effect.draw（414.1 / 414.3），与 Predict 步骤相互独立
 *    （359.3.e.11），故不写 linkedTo。
 * 3. [Predict X] 本身不是 805-832 的关键词表条目，而是 437 的 Limited Action；
 *    卡侧只写动作，不重写关键词（cards/README.md 第 5 节）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "reaction" },
  {
    kind: "play",
    cost: {
      kind: "cost.printed",
      energy: { kind: "constant", value: 7 }
    },
    body: [
      {
        // 「your Main Deck」= 施法者的主牌库（190.6.d 的隐含 "you"）。effect.inspect
        // 的 player 需要单个 PlayerId 表达式，先读出控制者再用 linked-value 交给它
        // （与已合入 unl/eclipse、ogn/stacked-deck 同一写法，不硬编码玩家 id）。
        id: "clairvoyance.bind-controller",
        op: "condition.value",
        args: {
          value: { kind: "object-property", object: "source", property: "controller" },
          key: { kind: "constant", value: "controller" }
        }
      },
      {
        // "[Predict 5]" 第 1 步：437.1 的私下查看 + 437.1.a 的“回收任意张”选择。
        // 牌库顶 5 张的顺序由本卡自己的 PickSpec.zoneSlice 在 Finalize 锁定
        // （chain/picks/plan.ts：zoneSlice 是唯一保序权威，query 顺序绝不被采用）。
        id: "clairvoyance.predict-look",
        op: "effect.inspect",
        linkedTo: "clairvoyance.bind-controller",
        args: {
          player: {
            kind: "linked-value",
            instructionId: "clairvoyance.bind-controller",
            key: "controller"
          },
          zone: { kind: "constant", value: "deck" },
          scope: { kind: "constant", value: "top" },
          amount: { kind: "constant", value: 5 },
          picksSpecId: { kind: "constant", value: "clairvoyance.predict-top-5" },
          choose: { kind: "constant", value: true },
          chooseCount: { kind: "constant", value: { min: 0, max: 5 } },
          choiceId: { kind: "constant", value: "clairvoyance.predict-select" },
          pickedKey: { kind: "constant", value: "clairvoyance.predict-looked" },
          choosePicksKey: { kind: "constant", value: "clairvoyance.predict-recycle" }
        },
        picks: [
          {
            id: "clairvoyance.predict-top-5",
            // 契约 3.6 / RIFT-358：显式有序来源 = options: []、ordered: true、
            // selection: "all"；Finalize 按真实牌库顺序锁定 5 张，子集选择在结算期的
            // effect.inspect 里完成（437.1.a）。
            options: [],
            ordered: true,
            selection: "all",
            zoneSlice: {
              zone: "deck",
              from: "top",
              count: { kind: "constant", value: 5 }
            }
          }
        ]
      },
      {
        // "[Predict 5]" 第 2 步：417.1 回收所选（417.1.a 主牌库牌回主牌库底）。
        id: "clairvoyance.predict-recycle",
        op: "effect.recycle",
        linkedTo: "clairvoyance.predict-look",
        args: {
          objects: {
            kind: "linked-value",
            instructionId: "clairvoyance.predict-look",
            key: "clairvoyance.predict-recycle"
          }
        }
      },
      {
        // "[Predict 5]" 第 3 步：437.1.a 的“其余按任意顺序放回顶部”。
        // “其余”= 实际看过的列表（linked）去掉实际回收的身份（exclude），
        // 由 RIFT-358 的 linked/exclude 按完整身份做保序差集；张数由实际结果决定，
        // 不写死 5-N，也绝不用当前区域 count 反推。
        id: "clairvoyance.predict-put-back",
        op: "effect.order",
        linkedTo: "clairvoyance.predict-recycle",
        args: {
          destination: { kind: "constant", value: "top" },
          cardsPick: { kind: "constant", value: "clairvoyance.predict-rest" },
          chooseOrder: { kind: "constant", value: true }
        },
        picks: [
          {
            id: "clairvoyance.predict-rest",
            options: [],
            ordered: true,
            selection: "all",
            linked: {
              kind: "linked-value",
              instructionId: "clairvoyance.predict-look",
              key: "clairvoyance.predict-looked"
            },
            exclude: {
              kind: "linked-value",
              instructionId: "clairvoyance.predict-recycle",
              key: "recycled"
            }
          }
        ]
      },
      {
        // "Draw 2." — 414.3；与 Predict 步骤相互独立（359.3.e.11），故不写 linkedTo。
        id: "clairvoyance.draw",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 2 } }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-932322ea9e594610dbc296c7b27a00cf97a5637134ab5407c3535c195d48e658",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "[Predict 5]. (Look at the top 5 cards of your Main Deck. Recycle any of them and put the rest back in any order.)\n" +
    "Draw 2."
} satisfies CardProgram;
