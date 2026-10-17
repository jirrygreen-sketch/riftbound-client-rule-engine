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
 * status = judge-required：
 * 1. 5 张的 Predict 没有已合入的完整路径：effect.inspect 的非零 top 查看要求上游提供有序
 *    picksSpecId，而“上游按牌库顶提供有序 5 张”的生产接线未合入（契约 3.6 只有 zoneSlice
 *    保序原语，没有把它接进查看指令的调用方）；rad/command-attack 已记录同一缺口
 *    （单张 Predict 形状有已合入路径，5 张的没有）。
 * 2. 也没有把 [Predict 5] 作为关键词展开的 KeywordDef：effects/keywords/ 没有 predict.ts，
 *    RIFT-83 的 Vision 只内联了 Predict 1 的两步，本卡按 README 第 4 节把三步写进 body
 *    作为可审查的已支持部分，并按第 2 节保持 judge-required。
 * 3. 已支持部分：“Draw 2.” 与 Predict 三件套的结构由 golden 校验；effect.draw 的抽牌与
 *    effect.inspect + effect.recycle + effect.order 的组合在参考内核中按有序 picks 真实执行。
 * 依赖：RIFT-64/RIFT-66（有序牌库顶查询契约与 effect.inspect 接线）。
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
        // "[Predict 5]" 第 1 步：437.1 的私下查看 + 437.1.a 的“回收任意张”选择。
        // 读牌库顶必须由上游按有序 picks 提供（契约 3.6 的 zoneSlice 语义）；
        // 原语在缺有序范围时明确阻断，绝不用 query 猜顺序。
        id: "clairvoyance.predict-look",
        op: "effect.inspect",
        args: {
          player: { kind: "constant", value: "controller" },
          zone: { kind: "constant", value: "deck" },
          scope: { kind: "constant", value: "top" },
          amount: { kind: "constant", value: 5 },
          picksSpecId: { kind: "constant", value: "clairvoyance.predict-top-5" },
          choose: { kind: "constant", value: true },
          chooseCount: { kind: "constant", value: { min: 0, max: 5 } },
          choiceId: { kind: "constant", value: "clairvoyance.predict-select" },
          pickedKey: { kind: "constant", value: "clairvoyance.predict-looked" },
          choosePicksKey: { kind: "constant", value: "clairvoyance.predict-recycle" }
        }
      },
      {
        // "[Predict 5]" 第 2 步：417.1 回收所选（417.1.a 主牌库牌回主牌库底）。
        id: "clairvoyance.predict-recycle",
        op: "effect.recycle",
        linkedTo: "clairvoyance.predict-look",
        args: {
          objects: {
            kind: "linked",
            instructionId: "clairvoyance.predict-look",
            key: "clairvoyance.predict-recycle"
          }
        }
      },
      {
        // "[Predict 5]" 第 3 步：437.1.a 的“其余按任意顺序放回顶部”；
        // 张数 = 5 - 实际回收张数，按链接值计算而不是写死。
        id: "clairvoyance.predict-put-back",
        op: "effect.order",
        linkedTo: "clairvoyance.predict-recycle",
        args: {
          destination: { kind: "constant", value: "top" },
          count: {
            kind: "arithmetic",
            operator: "sub",
            operands: [
              { kind: "constant", value: 5 },
              {
                kind: "linked-value",
                instructionId: "clairvoyance.predict-recycle",
                key: "recycledCount"
              }
            ]
          },
          chooseOrder: { kind: "constant", value: true }
        }
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
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1)「[Predict 5]」（437.1 / 437.1.a / 437.4）的私下查看需要上游按牌库顶提供有序 " +
    "picksSpecId：effect.inspect 明确要求非零 top 查看由上游提供保序来源（契约 3.6 的 zoneSlice 语义），" +
    "缺失时明确 negated/impossible，绝不用无序 query 近似；把 zoneSlice 接进查看指令的生产接线未合入" +
    "（rad-013-167 command-attack 记录同一缺口：单张 Predict 有已合入路径，5 张的没有）。" +
    "(2) effects/keywords/ 没有 [Predict X] 的 KeywordDef（RIFT-83 的 Vision 只内联了 Predict 1 的两步），" +
    "本程序按 README 第 4 节把 437.1.a 的三步（inspect → recycle → order，张数按 linked-value 计算）写进 body 作为可审查的已支持部分，" +
    "并按第 2 节保持 judge-required——能写出结构不等于整卡可执行。" +
    "已支持部分：「Draw 2.」是已合入的 effect.draw（414.3），golden 真实执行；Predict 三步在参考内核中按有序 picks 真实执行。" +
    "依赖：RIFT-64/RIFT-66（有序牌库顶查询契约与 effect.inspect 接线）。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "[Predict 5]. (Look at the top 5 cards of your Main Deck. Recycle any of them and put the rest back in any order.)\n" +
    "Draw 2."
} satisfies CardProgram;
