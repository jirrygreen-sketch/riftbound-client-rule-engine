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
 * status = judge-required（2026-10-18 复核：逐 Token 地点选择本身已可表达，缺的是合法地点集合的全量枚举）：
 * - 逐 Token 选择已实测可执行：`repeat` 节点（count=3）内包一条 `effect.token`（amount=1），
 *   每条指令用 `condition.value` 求值 `{ kind: "location", value: { kind: "choose", filter } }`
 *   得到自己的 LocationRef，再由 effect.token 的 `location: { kind: "linked-value" }` 读取；
 *   真实解释器会为 3 次迭代各问一次地点并生成 3 个位于各自地点的 Recruit
 *   （见 golden）。因此旧的「只能整条指令选一次」结论已不成立。
 * - 仍缺的是合法地点集合的完整枚举（355.2.a）：`target/location/candidates.ts` 的 allRefs 只从
 *   「已经有对象所在的地点」+ 玩家 Base（+ 调用方显式提供的 location state）收集 LocationRef，
 *   实测一个没有任何单位在场的、你控制的战场不会被枚举出来（空战场时 choose 候选只有 Base）。
 *   355.2.a 明确允许把单位打到「你控制的战场」，所以缺的是把战场对象本身纳入候选的来源；
 *   没有它，程序只能写死地点或漏掉印刷选项，属近似实现，故不写死 location。
 * - 已可真实执行的部分：Exhaust this 费用的真实收取（cost/plan-values.ts + cost/payment.ts，用卡
 *   自身的 cost 收取，415.4 的已横置拒绝也成立）与链上生成 + 打出的 Recruit token 本体
 *   （golden 用合并后的 repeat + effect.token + linked location 路径真实执行）。
 */
export default {
  canonicalCardId: "card.hash-1a195f8245b52279e6972886278ad1ad1a5802773ad4affa1e6ecff419aad1aa",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "逐 Token 地点选择已可表达（2026-10-18 实测）：repeat(count=3) 内包 effect.token(amount=1)，" +
    "每次迭代用 condition.value 求值 { kind: \"location\", value: { kind: \"choose\", filter } } 取一个 LocationRef，" +
    "再由 effect.token 的 location: { kind: \"linked-value\" } 消费；真实解释器会问 3 次并生成 3 个各自落点的 Recruit。" +
    "当前真实缺口是 355.2.a 允许的合法地点集合枚举不全：target/location/candidates.ts 的 allRefs 只收集" +
    "「已有对象所在的地点」+ 玩家 Base（以及调用方显式提供的 location state），" +
    "实测一个没有任何单位在场的、你控制的战场不在 choose 候选里（只剩 Base），" +
    "所以「你控制的战场」这一印刷选项无法由程序自身表达；写死基地或某个战场都会删掉印刷选项，属近似实现。" +
    "依赖：把战场对象（Battlefield Zone 中的 battlefield）纳入 355.2.a 候选生成的来源；" +
    "effect.token 的 location 表达式、repeat 迭代与 linked value 消费均已合入并有 golden 实测。" +
    "已可真实执行：Exhaust this 费用（204.1.b/415.3.a/415.5，含 415.4 的已横置拒绝）与 187.1 Recruit token 的链上生成 + 打出（440.2.c/185.2.a）。",
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
