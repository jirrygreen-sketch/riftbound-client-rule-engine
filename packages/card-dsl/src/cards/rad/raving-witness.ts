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
 * 状态：judge-required。Mighty 判定本身可执行：707/708 的阈值是 5，
 * 当前 IR 用锁定对象的比较条件表达；condition.predicate 也能执行
 * mightyCondition 的同一比较语义，非棋盘对象按印刷 Might 判定（711）。
 * 剩余缺口集中在分支控制与触发词表：
 * - 契约 3.9 的控制结构只有 sequence / repeat / choice.optional / choice.mode，没有
 *   if/otherwise 节点；用两条互斥 condition 指令表达"否则"时，两次条件求值的时机
 *   无法保证（同一次结算内该牌可能已离开牌库），故不把它当成可执行。
 * - 触发词表也是当前缺口：object-moved 不在引擎 EVENT_PATTERN_TYPES（validateTriggerSpec
 *   实测 invalid-event-type；translateTriggerFilter 虽能翻译 {source:'self'}，但严格校验
 *   fail-closed），时点本身存在（timing-points.ts），需要事件词表接线。
 * - 结构已写出并用测试内核验证了揭示与移动/回收半段。
 * 依赖：if/otherwise 契约缺口，以及 object-moved 事件词表接线。
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
    "剩余的真实缺口是契约 3.9 的控制结构只有 sequence / repeat / choice.optional / choice.mode，没有 if/otherwise 分支节点，" +
    "用两条互斥 condition 指令表达「否则」时两次条件求值的时机无法保证（同一次结算内该牌可能已离开牌库），故不当作可执行。" +
    "触发词表也是当前缺口：object-moved 不在引擎 EVENT_PATTERN_TYPES（validateTriggerSpec 实测 invalid-event-type；" +
    "translateTriggerFilter 虽能翻译 {source:'self'}，但严格校验 fail-closed），时点本身存在（timing-points.ts）。" +
    "结构已写出：object-moved 触发 + effect.reveal（pick 形式，牌库顶按真实顺序取）+ effect.zone to hand + effect.recycle to deck bottom；" +
    "golden 用测试内核验证揭示与移动/回收半段。依赖：if/otherwise 契约缺口与 object-moved 事件词表接线。" +
    "Mighty 使用 707/708/711 的阈值比较，不把「draw it」写成 effect.draw。",
  abilities,
  sourceText:
    "When I move, reveal the top card of your Main Deck. If it's [Mighty], draw it. Otherwise, recycle it. (A unit is Mighty while it has 5+ :rb_might:.)"
} satisfies CardProgram;

export default program;
