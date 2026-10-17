import type { Ability, CardProgram, Instruction } from "../../ir/index.js";

/**
 * rad-074-167 Raving Witness（能量 3、Power 无印刷值、Might 3、领域 Body、无标签）。
 *
 * 原文（逐字，已对照官方卡图）：
 *   "When I move, reveal the top card of your Main Deck. If it's [Mighty], draw it.
 *    Otherwise, recycle it. (A unit is Mighty while it has 5+ :rb_might:.)"
 *
 * 规则依据（CR v1.5）：
 * - "When I move"：Move 的成功时点（449 定义 Origin/Destination；时点枚举里的
 *   object-moved，ruleRefs 为 421.1 / 449.1 / 449.2 / 458 / 435.4.a）。该时点只描述
 *   "成功完成一次 Move"，Recall / 入场 / Attach 都不算 Move（timing-points.ts 描述与
 *   ruleRefs 一致）。触发者是本来源单位。
 * - "reveal the top card of your Main Deck"：425.1 的 Reveal 把牌对全体公开、牌仍在
 *   原区域、顺序不变（425.1.a.2 / 425.3）。牌库顶是隐藏信息，引用必须来自上游按真实
 *   区域内顺序提供的 pick（RIFT-66 契约：只能用 ctx.zoneSlice，不能从 query 推断顺序）；
 *   一次只揭一张，因此用 pick 而不是 zone+count（effect.reveal 对非手牌区域的真子集
 *   明确要求改用 pick，避免近似"牌库顶"）。
 * - "If it's [Mighty], draw it"：707 / 708 的 Mighty = 有效 Might ≥ 5；710 在场上按
 *   当前 Might 判定，711 在非棋盘区域按印刷 Might 判定——本例被揭的牌在牌库（非棋盘
 *   区域），因此按印刷 Might 判定。"draw it" 是把**这一张**（不是牌库顶随机一张）
 *   拿到手，由 effect.zone 的 pick → hand 完成（414.1 的抽牌要求"取牌库顶"，这里已
 *   经通过 reveal 锁定了具体对象，所以用移动而不是 effect.draw）。
 * - "Otherwise, recycle it"：417.1 / 417.1.a 的 Recycle 把牌放到其拥有者主牌库**底部**。
 *
 * 状态：judge-required（2026-10-17 实测复核）。
 * 已可执行的部分：Mighty 判定按 707/708 的阈值 5 用锁定对象的比较条件表达，
 * 非棋盘对象按印刷 Might 判定（711）；实测把牌库顶对象交给解释器后，Might 6 与 5 走
 * draw 半段（return-to-hand，牌进手牌），Might 4 与 1 走 recycle 半段（牌回牌库底），
 * 两条互斥条件各自 correct。揭示（effect.reveal，pick 形式）与两个半段的原语都可执行。
 * 剩余缺口（两条都实测，不近似实现）：
 * 1. 触发词表：object-moved 不在引擎 EVENT_PATTERN_TYPES（实测 validateTriggerSpec
 *    返回 invalid-event-type；时点本身存在于 timing-points.ts，action-adapter 也把
 *    move-location 映射到该时点）。translateTriggerFilter 能翻译 {source:'self'}，
 *    但注册会被严格校验 fail-closed 拒绝，所以"When I move"绑不上。
 * 2. 契约 3.9 的控制结构只有 sequence / repeat / choice.optional / choice.mode，没有
 *    if/otherwise 节点。当前两条互斥 condition 指令在单次结算的测试里各自正确，但
 *    引擎没有保证"否则"分支的条件读取与展示时锁定的是同一份快照；正式分支语义需要
 *    契约层的 if/otherwise（或等价的 result 谓词）支持，故不把整卡标为 executable。
 * 不近似实现：Mighty 已按 707/708/711 用阈值比较表达，也不把"draw it"
 *   写成 effect.draw（那会变成抽牌库顶，而不是抽已揭示的那一张）。
 */

const revealTop: Instruction = {
  // 425.1 / RIFT-66：牌库顶只能由上游按真实区域内顺序提供引用，故走 pick。
  id: "raving-witness.reveal-top",
  op: "effect.reveal",
  args: {
    pick: { kind: "constant", value: "raving-witness.top-card" }
  },
  picks: [
    {
      id: "raving-witness.top-card",
      options: ["top-card-of-controller-main-deck"],
      min: 1,
      max: 1,
      selection: "one"
    }
  ]
};

/** "If it's [Mighty], draw it."（707/708/711：牌库中的牌按印刷 Might ≥ 5 判定）。 */
const drawIfMighty: Instruction = {
  id: "raving-witness.draw-mighty",
  op: "effect.zone",
  linkedTo: "raving-witness.reveal-top",
  condition: {
    kind: "compare",
    left: {
      kind: "object-property",
      object: { linked: "raving-witness.reveal-top" },
      property: "might"
    },
    operator: "gte",
    right: { kind: "constant", value: 5 }
  },
  args: {
    pick: { kind: "constant", value: "raving-witness.revealed-card" },
    to: { kind: "constant", value: "hand" },
    amount: { kind: "constant", value: 1 }
  },
  picks: [
    {
      id: "raving-witness.revealed-card",
      options: [
        {
          kind: "linked-value",
          instructionId: "raving-witness.reveal-top",
          key: "revealed"
        }
      ],
      min: 1,
      max: 1,
      selection: "one"
    }
  ]
};

/** "Otherwise, recycle it."（417.1.a：放到其拥有者主牌库底部）。 */
const recycleOtherwise: Instruction = {
  id: "raving-witness.recycle-not-mighty",
  op: "effect.recycle",
  linkedTo: "raving-witness.reveal-top",
  condition: {
    kind: "compare",
    left: {
      kind: "object-property",
      object: { linked: "raving-witness.reveal-top" },
      property: "might"
    },
    operator: "lt",
    right: { kind: "constant", value: 5 }
  },
  args: {
    objects: {
      kind: "linked-value",
      instructionId: "raving-witness.reveal-top",
      key: "revealed"
    }
  }
};

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: { event: "object-moved", filter: { source: "self" } }
    },
    optional: false,
    body: [revealTop, drawIfMighty, recycleOtherwise]
  }
];

const program = {
  canonicalCardId:
    "card.hash-5100d228a6eda08c0fbbe5b5f17f74b70f6df76adde914277019866a34ba54b2",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "Mighty 判定本身已可执行：707/708 的阈值是 5，当前分支用锁定对象的 compare 条件表达，" +
    "condition.predicate 也能执行 mightyCondition 的同一比较语义；非棋盘区域按 711 使用印刷 Might。" +
    "实测证据：把牌库顶对象交给解释器后，印刷 Might 6 与 5 走 draw 半段（return-to-hand，牌进手牌），" +
    "Might 4 与 1 走 recycle 半段（牌回牌库底），effect.reveal 的 pick 形式与两个半段原语都真实执行。" +
    "剩余两条缺口（均实测）：(1) 触发词表——object-moved 不在引擎 EVENT_PATTERN_TYPES，" +
    "validateTriggerSpec 实测 invalid-event-type（时点本身存在，action-adapter 也把 move-location 映射到该时点），" +
    "translateTriggerFilter 虽能翻译 {source:'self'} 但注册被严格校验 fail-closed 拒绝。" +
    "(2) 契约 3.9 的控制结构只有 sequence / repeat / choice.optional / choice.mode，没有 if/otherwise 分支节点；" +
    "两条互斥 condition 指令在单次结算里各自正确，但引擎没有保证「否则」分支与展示锁定同一份快照，" +
    "正式分支语义需要契约层的 if/otherwise 或等价的 result 谓词支持。" +
    "结构已写出：object-moved 触发 + effect.reveal（pick 形式，牌库顶按真实顺序取）+ effect.zone to hand + effect.recycle to deck bottom。" +
    "依赖：object-moved 事件词表接线与 if/otherwise 契约缺口。" +
    "Mighty 使用 707/708/711 的阈值比较，不把「draw it」写成 effect.draw。",
  abilities,
  sourceText:
    "When I move, reveal the top card of your Main Deck. If it's [Mighty], draw it. Otherwise, recycle it. (A unit is Mighty while it has 5+ :rb_might:.)"
} satisfies CardProgram;

export default program;
