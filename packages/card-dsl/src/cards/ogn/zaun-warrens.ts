import type { CardProgram } from "../../ir/index.js";

/**
 * Zaun Warrens (ogn-298-298) — Battlefield, Colorless.
 *
 * sourceText: When you conquer here, discard 1, then draw 1.
 *
 * CR v1.5 anchors:
 * - 383.4.c / 473.2.a: "When you conquer here" is a Conquer Effect.
 * - 423.1 / 423.1.a / 423.4: discarding as part of an effect discards as many
 *   cards as possible; the discarding player chooses which cards.
 * - 359.3.e.11: instructions that can be partially followed are followed as
 *   much as possible and negated otherwise; the rule uses exactly this shape
 *   ("Discard 2, then draw 2") — an empty hand negates the discard and the draw
 *   still happens. The two instructions are therefore NOT linked.
 * - 414.3: "draw 1" is an ordinary draw by the ability controller.
 * - 053.3: "here" is this Battlefield.
 *
 * Status: judge-required for the trigger side only (re-checked 2026-10-17). The
 * merged effect.discard and effect.draw primitives execute the whole body
 * through the production chain adapter and the reference kernel in the golden
 * test (empty hand, single card, and the chooser path); the conquer timing point
 * is emitted by the TurnFlow Score wave (payload details.battlefieldId), and the
 * golden drives a real EventPipeline registration to receive it. The ability
 * still cannot run in production because programs/filters.ts rejects the 053.3
 * `here: true` placeholder while translating a CardProgram trigger, so
 * triggerRegistrations throws on this card and the ability never even
 * registers. Accepting the field would not be enough either: the scoring event
 * carries only player and details.battlefieldId (no Battlefield snapshot, and
 * the details matcher compares literal scalars only), so no merged path can
 * compare that runtime id with the ability source's own Location, and the 190.6
 * controller of a Battlefield ability cannot follow a control change because
 * control-established only updates combat/flow.ts's internal battlefield state.
 * The filter uses the closed EventPattern/PlayerSelector vocabulary for the
 * evaluable parts (event "conquered", player "self" = the ability controller).
 * Nothing here is approximated: the body keeps the printed order without a
 * linkedTo, so 359.3.e.11's "discard negated, draw still resolves" holds.
 */
export default {
  canonicalCardId: "card.hash-7eb7c2878a687bba1f5053f3c775d1f55e01679f4a8124757d2bb0a70b15ad88",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "唯一剩余缺口是 conquer 触发的 053.3「here」锚点（383.4.c / 473.2.a），三处均实测、不近似实现：" +
    "(1) 程序绑定时 programs/filters.ts 的 translateObjectFilter 对 here 抛 ProgramBindingError \"Unsupported filter field here\"，" +
    "events/trigger-spec.ts 的封闭 EventPattern 也不允许该字段（额外字段按 unknown-field 拒绝），" +
    "因此 programs/triggers.ts 的 triggerRegistrations 在本卡上直接抛错，触发连注册都进不去；" +
    "(2) 即使接受该字段也没有可比较的载荷：turn/flow.ts 的计分波只发 { timingPoint: \"conquer\", player, details: { battlefieldId } }，" +
    "events/pipeline-match.ts 的 details 匹配只接受字面标量（event.details?.[key] === expected），发射也不带 Battlefield 快照，" +
    "静态 IR 无法把 runtime battlefieldId 与来源战场自身身份比较（同 sfd/seat-of-power、rad/ruined-monastery 的记录）；" +
    "(3) 190.6 的战场能力控制者不随控制权变化：注册控制者取自来源快照的 controller（events/pipeline.ts 的 scan），" +
    "而 control-established 只更新 combat/flow.ts 内部的 battlefield 状态，不回写宿主快照。" +
    "指令体（effect.discard 数量 1 → effect.draw 数量 1；两条不 linkedTo，对应 359.3.e.11 官方例子“Discard 2, then draw 2”：弃牌被否定时抽牌照常结算）" +
    "完全用已合入原语表达并在 golden 中经 chain/interpreter-adapter.ts 的生产适配器真实执行；" +
    "conquer 时点已由 TurnFlow 的 Score wave 真实发出（载荷 details.battlefieldId），golden 也已用真实 EventPipeline 收到该事件（封闭事件词为 conquered）。",
  sourceText: "When you conquer here, discard 1, then draw 1.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // event "conquered" is the closed EventPattern spelling of the conquer
        // timing point (events/pipeline-match.ts maps conquered -> conquer);
        // "self" is the ability controller (190.6, once the binding layer
        // resolves the Battlefield ability's controller). "here" stays the
        // documented 053.3 placeholder pending the binding layer.
        filter: { event: "conquered", here: true, player: "self" }
      },
      optional: false,
      body: [
        {
          // 423.1.a / 423.4: the controller discards 1, choosing the card.
          // The instruction is NOT linked to the following draw (359.3.e.11).
          id: "zaun-warrens.discard",
          op: "effect.discard",
          args: { amount: { kind: "constant", value: 1 } }
        },
        {
          // 414.3: draw 1; the implicit drawer is the ability controller
          // (190.6.d), which effect.draw's default.
          id: "zaun-warrens.draw",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ]
} satisfies CardProgram;
