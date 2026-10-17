import type { CardProgram } from "../../ir/index.js";

/**
 * Vanguard Armory (sfd-168-221) — Gear, 7 energy, 1 Order power, Might null, Order, 无标签。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-168-221）：
 *   ":rb_exhaust:: Play three 1 :rb_might: Recruit unit tokens.
 *    (You may play them to different locations.)"
 *
 * 规则依据（CR v1.5）：
 * - 204.1.b / 377.1 / 415.3.a / 415.5：印刷行没有冒号，但格式是「[费用符号]：效果」中的
 *   费用部分（冒号前只有横置符号）——"Exhaust this" 是启动能力的费用，415.4 要求费用必须
 *   能完成。Gear 的启动能力默认 Action 时机（151.2）。
 * - 440.2 / 440.2.c / 185.2.a：被"打出"的新 token 先在链上生成，再由打出流程接手；已合入的
 *   effect.token 用 mode "play" 走同一条路径（token 定义见 187.1：1 Might 的 domainless
 *   Recruit 单位 token，无印刷费）。
 * - 355.2 / 355.2.a：「Play …」时每个单位各自选择一个合法地点，默认为该玩家的 Base 或该玩家
 *   控制的 Battlefield；括号里 "You may play them to different locations." 正是提示这一
 *   逐 Token 的选择权。355.2.b 允许某些效果扩大合法地点集合。
 *
 * status = judge-required（逐 Token 地点无法表达；不近似实现）：
 * - 已合入的 effect.token 只接受一个固定的目的地（location），或 locations + choiceId 的
 *   **整条指令一次**选择，且三者必须恰好给出一个（实测不写目的地会抛
 *   “effect.token requires exactly one destination argument”）。三个 token 逐 Token 选地点
 *   （可能各不相同）需要 355.2 的逐 finalize 位置选择，冻结原语没有该路径。
 * - effect.token 仍只能为整条指令消费一个固定 location，或 locations + choiceId 的一次选择；
 *   它不能为 amount=3 的每个 token 分别消费 Finalize 产生的地点选择。程序里不写
 *   location/locations：写死基地或某个战场会删掉印刷的地点选项。
 * - 已可真实执行的部分：Exhaust this 费用的真实收取（cost/plan-values.ts + cost/payment.ts，用卡
 *   自身的 cost 收取，415.4 的已横置拒绝也成立）与链上生成 + 打出的 Recruit token 本体
 *   （golden 由调用方补上 355.2 会给出的具体地点，与已合入 sfd/herald-of-the-arcane 同一口径）。
 *   位置选择是本卡仍未闭合的唯一能力级阻断；费用与 Recruit token 本体已有执行证据。
 */
export default {
  canonicalCardId: "card.hash-1a195f8245b52279e6972886278ad1ad1a5802773ad4affa1e6ecff419aad1aa",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Play three 1 :rb_might: Recruit unit tokens. (You may play them to different locations.)」的逐 Token 打出地点无法表达：" +
    "CR 355.2/355.2.a 规定每个被打出的单位各自选择一个合法地点（默认是该玩家的 Base 或该玩家控制的 Battlefield），" +
    "而已合入的 effect.token 只接受单一 location，或 locations + choiceId 的整条指令一次选择，且恰好需要一个目的地参数（实测不写目的地会抛 " +
    "“effect.token requires exactly one destination argument”；locations + choiceId 只在 amount 循环前选择一次，amount=3 不能得到三个独立地点）。逐 Token 的地点选择需要 Finalize 的位置选择。" +
    "地点候选集合虽可由 target/location/candidates.ts 生成并产出 LocationRef，但 effect.token 没有逐 token 的 " +
    "Finalize 选择/消费路径；程序不写死基地或某个战场（那会删掉印刷选项）。" +
    "已可真实执行的部分：Exhaust this 费用（204.1.b/415.3.a/415.5，cost/plan-values.ts + cost/payment.ts，含 415.4 的已横置拒绝）" +
    "与 187.1 Recruit token 的链上生成 + 打出（440.2.c/185.2.a），golden 用程序自己的 cost 与 args 真实执行（地点由调用方按 355.2 给出）。" +
    "依赖：effect.token 的逐 Token 地点选择与 Finalize 结果消费。不近似实现。",
  abilities: [
    {
      kind: "activated",
      // 204.1.b / 415.3.a：冒号前的 ":rb_exhaust:" 是启动费用；415.5 规定它表示 Exhaust this。
      cost: {
        kind: "activated",
        payments: [{ kind: "exhaust", object: "self" }]
      },
      // 151.2：Gear 的启动能力默认 Action 时机（没有印刷 [Reaction]）。
      timing: "action",
      body: [
        {
          id: "vanguard-armory.play-recruits",
          op: "effect.token",
          args: {
            // 187.1：1 Might 的 domainless Recruit 单位 token，无印刷费。
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 3 },
            // 440.2.c / 185.2.a：新 token 在链上生成后由 play 动作接手。
            mode: { kind: "constant", value: "play" }
            // 355.2 的逐 Token 地点选择缺生产方（见 judgeReason）；这里刻意不写
            // location / locations / choiceId，而不是把三个 token 钉死在同一个地点。
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_exhaust:: Play three 1 :rb_might: Recruit unit tokens. (You may play them to different locations.)"
} satisfies CardProgram;
