import type { CardProgram } from "../../ir/index.js";

/**
 * Maduli the Gatekeeper (unl-144-219) — Unit, Chaos, tag Bandle City。
 * catalog：energy 7、power 1、might 6。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-144-219，逐字）：
 *   I can't be readied.
 *   :rb_rune_chaos:: Move me to an occupied enemy battlefield if my Might is greater
 *   than the total Might of enemy units there.
 *
 * 规则依据（CR v1.5）：
 * - “I can't be readied.” 是 364.2 式的陈述句（被动能力，364.1/364.3 的 “can't” 形式）：
 *   它禁止 416 的 Ready 动作与该单位互动；315.1.b.1 的 Awaken 阶段“把能够被重置的对象重置”
 *   因此必须跳过本卡。被动能力用 static + ContinuousEffect 表达（ContinuousEffect.kind 是开放的
 *   由 layers 消费的字符串，对照 sfd/dauntless-vanguard 的先例）；这里写成 continuous.restrict
 *   形状（ability-templates 第 252 行：一般许可/禁止）。
 * - “:rb_rune_chaos:: “ 是冒号前的基础费用：204.1.b 规定冒号前的资源即启动能力的 Base Cost，
 *   此处是一点 Chaos 力量；376/377.3 的启动能力进链，本卡没有印刷 [Action]/[Reaction]，
 *   按默认 Action 时机。费用形态对齐已合入的费用管线（cost/plan-values.ts 的 power 组件 +
 *   payment.ts 的按域分配）。
 * - “Move me to an occupied enemy battlefield”：448.1/421 的效果移动（不是 144 的 Standard Move，
 *   也不是 457 的 Recall）；“me” 是宿主自身（355.10.d 的程序化指定，不是目标）；目的地是 170.11.a
 *   的“被占据（有单位在）的敌方战场”，属于 355.4/355.4.a 的合法目的地选择，355.4 规定它必须在
 *   移动前选定。
 * - “if my Might is greater than the total Might of enemy units there”：条件在结算时求值
 *   （143.2.a 的有效 Might；467.2.a 一类的 Might 汇总由 355.4.a / 451.1 的合法性检查承担）。
 *
 * status = judge-required（缺口不近似实现）：
 * - “occupied enemy battlefield”的运行期 Location 选择已经可由 LocationExpr 的 choose/filter
 *   表达并交给 effect.move；但 451.1 的“我的 Might 是否大于该地敌方单位总 Might”仍需要按 143.2.a
 *   汇总比较，当前地点选择器没有把该动态条件接入候选合法性或结算门控。
 * - “I can't be readied.” 的 continuous.restrict 原语、static binder 和 restriction 查询已经合入，
 *   但 chain 的 canAct 与 416/315.1.b.1 的重置流程仍不读取该禁止，所以这条禁令尚未成为
 *   真实的 Ready/Awaken 规则约束。
 * - 已合入且被 golden 真实执行的是启动费用：buildCostPlan + payCostPlan 用 1 点 Chaos 力量
 *   真实支付（并按 Duel 资源分配验证 415.3/415.5 式的“付得出”），未提供 Chaos 时如实拒绝。
 *
 * 依赖：目的地的 Might 汇总比较，以及 Ready/Awaken 对 continuous.restrict 的消费。
 */
export default {
  canonicalCardId:
    "card.hash-9f4e7daa818aadec972e97c3f25f231c123fa7f6c5d2b58750be9027cbca870c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入：(1) 「Move me to an occupied enemy battlefield」的 LocationExpr choose/filter 已合入，" +
    "可以筛出被占据且由对手控制的战场并交给 effect.move；但「my Might is greater than the total Might " +
    "of enemy units there」仍需要按 143.2.a 汇总比较该地敌方单位总 Might，当前地点选择器没有动态条件门控" +
    "（170.11.a / 355.4.a）。" +
    "(2) 「I can't be readied.」的 continuous.restrict 原语、static binder 和 restriction 查询已经合入，" +
    "但 chain 的 canAct 与 416/315.1.b.1 的重置流程仍不读取该禁止。" +
    "已合入且由 golden 真实执行的是冒号前的 1 点 Chaos 力量费用（204.1.b；buildCostPlan + payCostPlan，缺 Chaos 时如实拒绝）。" +
    "依赖：目的地的 Might 汇总比较，以及 Ready/Awaken 对 restriction 查询的消费。不近似实现。",
  abilities: [
    {
      kind: "static",
      // 364.1/364.2 的陈述句被动：“I can't be readied.”（禁止 416 的 Ready 与 315.1.b.1 的重置）。
      // 该 ContinuousEffect 的消费者缺失（见 judgeReason）。
      effect: {
        kind: "continuous.restrict",
        mode: "prohibit",
        action: "ready",
        appliesTo: "self"
      }
    },
    {
      kind: "activated",
      timing: "action",
      cost: {
        kind: "activated",
        // 204.1.b：冒号前的 :rb_rune_chaos: 是 1 点 Chaos 力量的 Base Cost。
        power: { kind: "constant", value: ["Chaos"] }
      },
      body: [
        {
          id: "maduli-the-gatekeeper.move-me",
          op: "effect.move",
          args: {
            // “me” 是宿主自身（355.10.d：程序化指定，不是目标选择）。
            objects: { kind: "constant", value: "self" },
            // 170.11.a / 355.4：先从运行期地点状态中选择一个被占据且由对手控制的战场。
            // “我的 Might > 该地敌方单位总 Might”的动态门控仍由 judgeReason 记录，
            // 不能在这里近似成无条件移动。
            to: {
              kind: "location",
              value: {
                kind: "choose",
                id: "maduli-the-gatekeeper.destination",
                filter: { type: "battlefield", occupied: true, controller: "opponent" }
              }
            },
            amount: { kind: "constant", value: 1 },
            linkKey: { kind: "constant", value: "moved" }
          }
        }
      ]
    }
  ],
  sourceText:
    "I can't be readied.\n" +
    ":rb_rune_chaos:: Move me to an occupied enemy battlefield if my Might is greater than the total " +
    "Might of enemy units there."
} satisfies CardProgram;
