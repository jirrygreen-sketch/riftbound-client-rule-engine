import type { CardProgram } from "../../ir/index.js";

/**
 * Keeper of the Hammer (unl-203-219) — Legend, Body/Order, tag Poppy.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-203-219，逐字）：
 *   When you hold, gain 1 XP.
 *   Spend 3 XP, :rb_exhaust:: Draw 1.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.d / 383.4.d.1 / 383.4.d.2.b：「When you hold」是 Hold Effect（引用执行
 *   固守的玩家），控制者完成固守时进链，过滤器使用封闭事件别名 held（运行时映射到 hold；
 *   events/timing-points.ts），
 *   由 turn/flow.ts 的 Beginning 计分波发出，refs 315.2.b.2 / 471.2 / 473.2.b）。
 *   383.4.d.2.c：固守的点数被否定或替代时照常触发。
 * - 728 / 730.1 / 733：「gain 1 XP」是增加玩家已标记的 XP，无上限，用 effect.xp
 *   （amount 1；获得者缺省为能力控制者，190.6.d）。
 * - 404.1.a / 415.5：第二段的「Spend 3 XP, :rb_exhaust:」是启动能力的费用（在
 *   「:」之前），由合并费用管线（cost/plan-values.ts 的 payments:
 *   [{ kind: "xp", amount: {…3} }, { kind: "exhaust", object: "self" }] 与
 *   cost/payment.ts 的 spend-xp 支付）承载；174.8 / 376：传奇可以有启动能力，
 *   没有 [Reaction] 即默认 Action 时机。
 * - 414.3 / 414.1.a / 414.4：「Draw 1」是 effect.draw，抽牌者缺省为能力控制者，
 *   牌库顺序与 Burn Out（432）由内核拥有。
 *
 * status = judge-required（唯一缺口是「me」的 Legend Zone 归属）：
 * - 「:rb_exhaust:」是「Exhaust me」的费用。CR 107.4.a / 107.4.c 规定传奇在 Legend
 *   Zone 中且是 Game Object，107.4.d.1 允许效果添加传奇；但契约的 ZoneId
 *   （effects/contract.ts）只有 hand/deck/rune-deck/trash/banishment/board/
 *   rune-zone/chain，没有 legend-zone，而 cost/payment.ts 的 exhaust 支付检查
 *   明确要求对象在 board / rune-zone（"An exhaust cost requires a ready controlled
 *   object on the Board"），传奇自身无法通过费用管线的合法性检查。这是 effect.exhaust.ts
 *   文件头已记录的同一契约缺口（见回复里的契约变更请求），本卡不把费用横置近似成
 *   effect.exhaust 的状态改变。
 * - 触发式能力的 hold 时点（turn/flow.ts 已发出）、effect.xp、启动能力的 xp +
 *   exhaust 费用计划形状与 effect.draw 都已合入，golden 用真实费用计划、真实解释器与
 *   参考内核执行；只有 Legend Zone 归属这一处依赖保持缺口。
 *
 * 依赖：契约补充 legend-zone（ZoneId / 费用支付对象合法性）与现有费用计划接线。
 * 本卡没有其他未合入依赖。
 */
const keeperOfTheHammer = {
  canonicalCardId:
    "card.hash-ae6f9827f6711f04a1ffb33df0b1a0152eef3c94d5b476705d8d3bdabc6e8453",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "唯一缺口是「me」的 Legend Zone 归属：「:rb_exhaust:」是「Exhaust me」的费用，CR 107.4.a / 107.4.c 规定传奇在 Legend Zone 中且是 Game Object，" +
    "但契约的 ZoneId（effects/contract.ts）只有 hand/deck/rune-deck/trash/banishment/board/rune-zone/chain，没有 legend-zone；" +
    "cost/payment.ts 的 exhaust 支付检查明确要求对象在 board / rune-zone（An exhaust cost requires a ready controlled object on the Board），" +
    "传奇自身无法通过费用管线的合法性检查。本卡不把费用横置近似成 effect.exhaust 的状态改变（会漏掉 415.4/415.5 的可完成性与 415.1.b 的重复横置检查）。" +
    "其余部分均已合入：hold 时点由 turn/flow.ts 的计分波发出（CR 315.2.b.2/471.2/473.2.b）、effect.xp 的 gain 1 XP（728/730.1/733）、" +
    "启动能力的 xp + exhaust 费用计划形状与 effect.draw 的 Draw 1（414.1.a/414.3），golden 用真实费用计划与参考内核执行。" +
    "依赖：契约补充 legend-zone（ZoneId / 费用支付对象合法性）与现有费用计划接线。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // 383.4.d.2.b：「引用执行固守的玩家」的 Hold Effect。
        // EventPattern uses the closed `held` spelling; pipeline-match maps it
        // to the runtime `hold` timing point emitted by scoring.
        filter: { event: "held", player: "self" }
      },
      // 「gain 1 XP」没有「may」，是强制效果（383.2 的 Effect）。
      optional: false,
      body: [
        {
          id: "keeper-of-the-hammer.gain-xp",
          op: "effect.xp",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    },
    {
      kind: "activated",
      // 404.1.a：印刷的「Spend 3 XP, :rb_exhaust:」是费用；没有 [Reaction]，
      // 默认 Action 时机（376 / 338.1.a.1）。
      timing: "action",
      cost: {
        kind: "activated",
        payments: [
          { kind: "xp", amount: { kind: "constant", value: 3 } },
          { kind: "exhaust", object: "self" }
        ]
      },
      body: [
        {
          // 414.3：「Draw 1」——抽牌者缺省为能力控制者（414.1.a / 190.6.d）。
          id: "keeper-of-the-hammer.draw",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "When you hold, gain 1 XP.\nSpend 3 XP, :rb_exhaust:: Draw 1."
} satisfies CardProgram;

export default keeperOfTheHammer;
