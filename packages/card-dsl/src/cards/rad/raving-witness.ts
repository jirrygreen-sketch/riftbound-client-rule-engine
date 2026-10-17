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
 *   拿到手并执行 Draw；effect.zone 的 pick → hand 只覆盖对象移动，不能证明 Draw
 *   的事件与替代语义（414.1.a），因此该子效果不支持升级整卡状态。
 * - "Otherwise, recycle it"：417.1 / 417.1.a 的 Recycle 把牌放到其拥有者主牌库**底部**。
 *
 * 2026-10-17 再复核：整卡仍为 judge-required；当前缺口见 judgeReason。
 * 已合入原语与关键词声明不等于生产链路可执行；局部执行证据见同名单卡测试。
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
      options: [],
      ordered: true,
      selection: "all",
      zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 1 } }
    }
  ]
};

// Compute the branch once before either zone change. Non-units and units with
// no printed Might are not Mighty; never coerce a null characteristic to zero.
const checkMighty: Instruction = {
  id: "raving-witness.check-mighty",
  op: "condition.predicate",
  linkedTo: "raving-witness.reveal-top",
  args: {
    condition: {
      kind: "constant",
      value: {
        kind: "all",
        conditions: [
          {
            kind: "compare",
            left: { kind: "count", subject: "objects", filter: { type: "unit", object: { linked: "raving-witness.reveal-top" } } },
            operator: "gt",
            right: { kind: "constant", value: 0 }
          },
          {
            kind: "compare",
            left: { kind: "object-property", object: { linked: "raving-witness.reveal-top" }, property: "might" },
            operator: "ne",
            right: { kind: "constant", value: null }
          },
          {
            kind: "compare",
            left: { kind: "object-property", object: { linked: "raving-witness.reveal-top" }, property: "might" },
            operator: "gte",
            right: { kind: "constant", value: 5 }
          }
        ]
      }
    }
  }
};

/** "If it's [Mighty], draw it."（707/708/711：牌库中的牌按印刷 Might ≥ 5 判定）。 */
const drawIfMighty: Instruction = {
  id: "raving-witness.draw-mighty",
  op: "effect.zone",
  linkedTo: "raving-witness.reveal-top",
  condition: {
    kind: "result",
    result: "raving-witness.check-mighty",
    key: "value"
  },
  args: {
    pick: { kind: "constant", value: "raving-witness.revealed-card" },
    to: { kind: "constant", value: "hand" },
    amount: { kind: "constant", value: 1 }
  },
  picks: [
    {
      id: "raving-witness.revealed-card",
      options: [],
      ordered: true,
      selection: "all",
      linked: { kind: "linked-value", instructionId: "raving-witness.reveal-top", key: "revealed" }
    }
  ]
};

/** "Otherwise, recycle it."（417.1.a：放到其拥有者主牌库底部）。 */
const recycleOtherwise: Instruction = {
  id: "raving-witness.recycle-not-mighty",
  op: "effect.recycle",
  linkedTo: "raving-witness.reveal-top",
  condition: {
    kind: "not",
    condition: { kind: "result", result: "raving-witness.check-mighty", key: "value" }
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
    body: [revealTop, checkMighty, drawIfMighty, recycleOtherwise]
  }
];

const program = {
  canonicalCardId:
    "card.hash-5100d228a6eda08c0fbbe5b5f17f74b70f6df76adde914277019866a34ba54b2",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「When I move」的 object-moved 时点与 move-location 生产映射已合入，但 EVENT_PATTERN_TYPES 尚无该事件；validateTriggerSpec 返回 invalid-event-type，真实触发注册仍被拒绝（CR 421.1、449）。" +
    "Mighty（707/708/711）可由 condition.predicate 计算一次，并用已合入的 condition.result 选择 if/otherwise 分支；不再依赖不存在的专用 if/otherwise 节点。显式 zoneSlice 与 linked pick 已替换牌库顶字符串占位。" +
    "「draw it」还缺以已揭示引用为对象的 Draw 动作/原语：现有 effect.draw 只能抽当前牌库顶或选抽牌者，effect.zone to hand 实际产生 return-to-hand，不能作为 Draw 的事件、替代与触发证据（414.1.a）。" +
    "当前有序 pick 在 Finalize 锁定引用，而本卡要求 Resolve 时揭示当时牌库顶；还需 Resolve 时有序来源捕获。保留 effect.zone 仅验证已揭牌移动至手牌的子效果，整卡保持 judge-required。",
  abilities,
  sourceText:
    "When I move, reveal the top card of your Main Deck. If it's [Mighty], draw it. Otherwise, recycle it. (A unit is Mighty while it has 5+ :rb_might:.)"
} satisfies CardProgram;

export default program;
