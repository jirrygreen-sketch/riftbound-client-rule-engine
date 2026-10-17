import type { Ability, CardProgram, Instruction } from "../../ir/index.js";

/**
 * rad-067-167 Clocktower Guardian（能量 8、Power 2、Might 8、领域 Fury、标签 Mech）。
 *
 * 原文（逐字，已对照官方卡图：PREDICT 3 与 DEATHKNELL 是印刷关键词）：
 *   "When you play me or when I hold, [Predict 3]. / [Deathknell][>] Banish the
 *    top card of your Main Deck. You may play it, ignoring its Energy cost."
 *
 * 规则依据（CR v1.5）：
 * - "When you play me" 是 Play Effect（383.4.a），"when I hold" 是 Hold 触发
 *   （315.2.b.2 / 471.2 / 473.2.b）；两者是**同一个触发能力的两个条件**
 *   （"or"），因此写成两条独立的 triggered 能力（同源同正文），而不是一条带
 *   复合 filter 的能力——时点枚举里 card-played 与 hold 是两个不同 at。
 * - [Predict 3]（437.1 / 437.3 / 437.3.a）：看 Main Deck 顶 3 张、可回收其中任意张、
 *   其余按任意顺序放回；437.4 牌库不足时尽可能多看且不因此 Burn Out。
 * - [Deathknell]（808.1.b/808.1.c）：功能等于 "When I die, [Effect]"，触发源是
 *   该永久物被消灭并送入 Trash（808.1.d，时点 object-killed）；808.1.d.2 要求在
 *   卡牌进入 Trash **之前**作为 Pending Item 入链。
 * - "Banish the top card of your Main Deck"（428.1 的 Banish 是把牌放入 Banishment）：
 *   牌库顶是隐藏信息，effect.banish 的 zone 选择形式（{ zone: "deck", player,
 *   from: "top" }）按真实区域内顺序取顶，符合 RIFT-66 契约（牌库顶只能用 zoneSlice）。
 * - "You may play it, ignoring its Energy cost"：420.3 的 Limited Play Effect；
 *   356.1.b.2 明确"ignoring its Energy cost"只把 Base Energy cost 置零、其余费用仍适用。
 *
 * 状态：judge-required。缺口：
 * 1. [Predict 3] 没有关键词展开（注册表无 predict；现有 Vision 只内联了
 *    Predict 1 的两步），按 README 第 5 节不在卡里手写同一套逻辑。
 * 2. [Deathknell] 的关键词展开（keywords/Deathknell.ts）产出 trigger.leave 指令，
 *    该 op 仍没有运行期消费路径，因此展开还不能执行；本程序把 Deathknell 的 [Effect] 用等价的 object-killed 触发写出来
 *    （808.1.c 的"功能等价"），并保留 keyword 声明。
 * The finalized zero-Energy plan for "ignoring its Energy cost" is already
 * consumed by effect.play; the golden covers that path.
 * 依赖：Predict 关键词展开、Deathknell 的 trigger.leave 消费与离场入链时序。
 * 不近似实现：不把"ignoring its Energy cost"当作忽略全部费用，也不用手写 Predict 冒充关键词。
 */

/** 437.1 / 437.1.a：看顶 X 张、可回收任意张、其余任意顺序放回。 */
const predictThree: Instruction = {
  // 牌库顶顺序由上游按真实区域内顺序提供（RIFT-66 契约：只能用 zoneSlice，
  // 不能从 query 的返回顺序推断），因此范围走 picks。
  id: "clocktower-guardian.predict-look",
  op: "effect.inspect",
  args: {
    // "your Main Deck" = 能力控制者的主牌库；EffectIR 没有控制者字面量，
    // 运行装配层在结算时绑定实际 PlayerId（同 rad/consult-the-heavens 的写法）。
    player: { kind: "constant", value: "controller" },
    zone: { kind: "constant", value: "deck" },
    scope: { kind: "constant", value: "picks" },
    picksSpecId: { kind: "constant", value: "clocktower-guardian.predict-range" },
    choose: { kind: "constant", value: true },
    chooseCount: { kind: "constant", value: { min: 0, max: 3 } },
    pickedKey: { kind: "constant", value: "clocktower-guardian.predicted" },
    choosePicksKey: { kind: "constant", value: "clocktower-guardian.recycle" }
  },
  picks: [
    {
      id: "clocktower-guardian.predict-range",
      options: ["top-3-cards-of-controller-main-deck-in-zone-order"],
      min: 0,
      max: 3,
      selection: "up-to"
    }
  ]
};

const predictRecycle: Instruction = {
  // 417.1.c：回收的牌放到其拥有者主牌库底部；未选择时链接值为空数组。
  id: "clocktower-guardian.recycle-predicted",
  op: "effect.recycle",
  linkedTo: "clocktower-guardian.predict-look",
  args: {
    objects: {
      kind: "linked-value",
      instructionId: "clocktower-guardian.predict-look",
      key: "clocktower-guardian.recycle"
    }
  }
};

const predictReorder: Instruction = {
  // 437.1.a：其余按任意顺序放回牌库顶。
  id: "clocktower-guardian.replace-predicted",
  op: "effect.order",
  linkedTo: "clocktower-guardian.predict-look",
  args: {
    destination: { kind: "constant", value: "top" },
    cardsPick: { kind: "constant", value: "clocktower-guardian.predicted" },
    chooseOrder: { kind: "constant", value: true }
  }
};

const deathknellBody: readonly Instruction[] = [
  {
    // 428.1 / RIFT-66：牌库顶是隐藏信息，用 zone 选择按真实区域内顺序取顶。
    id: "clocktower-guardian.banish-top",
    op: "effect.banish",
    args: {
      objects: {
        kind: "constant",
        // 428.1 / RIFT-66：牌库顶是隐藏信息，用 zone 选择按真实区域内顺序取顶；
        // player "controller" 由运行装配层绑定实际 PlayerId。
        value: { zone: "deck", player: "controller", from: "top" }
      },
      amount: { kind: "constant", value: 1 },
      linkKey: { kind: "constant", value: "banished-card" }
    }
  },
  {
    // 420.3 + "You may play it"（383.3 的可选效果写在效果后段→在结算时决定）。
    // 356.1.b.2："ignoring its Energy cost"只把 Base Energy cost 置零，其余费用仍适用；
    // effect.play 已能消费这个只把 Base Energy 置零的 finalized plan。
    id: "clocktower-guardian.may-play",
    op: "choice.optional",
    args: {
      prompt: { kind: "constant", value: "Play the banished card?" },
      body: {
        kind: "constant",
        value: [
          {
            id: "clocktower-guardian.play-banished",
            op: "effect.play",
            linkedTo: "clocktower-guardian.banish-top",
            args: {
              object: {
                kind: "linked-value",
                instructionId: "clocktower-guardian.banish-top",
                key: "banished-cardObject"
              },
              cost: {
                kind: "constant",
                value: {
                  finalized: true,
                  // 356.1.b.2：Energy 置零；Power 仍按印刷值支付，故不写 ignore。
                  energy: 0
                }
              }
            }
          }
        ]
      }
    }
  }
];

const abilities: Ability[] = [
  // 808.1：Deathknell 是触发能力关键词；[Effect] 用等价的 object-killed 触发承载
  // （808.1.c 的"功能等价"），展开（808.1.d.2 的入链时序）属关键词注册表。
  { kind: "keyword", keyword: "deathknell" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [predictThree, predictRecycle, predictReorder]
  },
  {
    kind: "triggered",
    trigger: {
      at: "hold",
      filter: { event: "hold", filter: { source: "self" } }
    },
    optional: false,
    body: [predictThree, predictRecycle, predictReorder]
  },
  {
    // 808.1.c 的等价展开：自身被消灭时执行 Deathknell 的 [Effect]。
    kind: "triggered",
    trigger: {
      at: "object-killed",
      filter: { event: "object-killed", filter: { source: "self" } }
    },
    optional: false,
    body: deathknellBody
  }
];

const program = {
  canonicalCardId:
    "card.hash-9acbf5e3c7be24dcd9c72b8ec614e8dd1d7ef60d52c6394559ece574843ccdaf",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处缺口：(1) [Predict 3] 没有关键词展开（注册表无 predict；现有 Vision 只内联 Predict 1 的两步），" +
    "按 README 第 5 节不在卡里手写同一套看顶/回收/放回展开；(2) [Deathknell] 的关键词展开产出 trigger.leave 订阅指令，" +
    "该 op 仍没有运行期消费路径，808.1.d.2 的「进 Trash 前入链」时序无消费方。" +
    "Predict 三步、Deathknell 的 Banish 半段以及 finalized zero-Energy plan for effect.play 已按 437 / 428 / 420.3 写出并由 golden 覆盖。" +
    "依赖：Predict 关键词展开、Deathknell 的 trigger.leave 消费与离场入链时序。不近似实现：不把「ignore Energy cost」当成忽略全部费用。",
  abilities,
  sourceText:
    "When you play me or when I hold, [Predict 3].\n" +
    "[Deathknell][>] Banish the top card of your Main Deck. You may play it, ignoring its Energy cost."
} satisfies CardProgram;

export default program;
