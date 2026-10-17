import type { CardProgram } from "../../ir/index.js";

/**
 * Wildclaw Shaman (ogn-147-298) — Unit, 4 energy, no printed power (Body),
 * 3 Might.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-147-298):
 *   When you play me, you may spend a buff to buff me and ready me. (If I
 *   don't have a buff, I get a +1 :rb_might: buff.)
 *
 * 规则依据（CR v1.5）：
 * - “When you play me”：打出触发（420.4.a；时点 card-played），filter 指向自身。
 * - “you may …”：可选。383.3.a/383.3.a.1 说明 “you may” 出现在效果最前时，由控制者
 *   在 Finalize 决定是否执行该触发能力（对应 triggered.optional: true）。
 *   而“spend a buff to buff me and ready me”是“[做 X] to [做 Y]”形式的指令内费用
 *   （740.4.a、355.10.c.1），触发式能力的这一费用在 Finalize 支付（740.4.a.2、
 *   383.3.b/383.3.b.1）。契约 3.9 规定“可以……”一律写成 `choice.optional` 并把被选指令
 *   包进 body（不是 choice + linkedTo），故 body 用 choice.optional 包裹支付与结果。
 * - “spend a buff”：702.2.b（Spend 移除一个 buff counter）、702.2.b.1（没有 buff 就不能
 *   Spend）、702.2.b.2（只能 Spend 自己控制的单位的 buff）——effect.buff 的 mode
 *   "spend" 已合入该语义（本卡以宿主 self 为目标，控制者即 ctx.controller）。
 * - “buff me and ready me”：effect.buff（mode "buff"，702.3.a 已 buff 时不再放置）与
 *   effect.ready（416.1）。二者都是「spend a buff」这一指令内费用的结果；真正的费用门禁与链接
 *   判定属于 Finalize（383.3.b.1）与宿主选择器缺口，见 status 说明与 golden 测试的分层。
 *
 * status: judge-required —— “spend a buff” 作为触发能力的费用尚未实现：
 * 1. value 层没有“宿主自身”的对象选择器：effect.buff / effect.ready 的 objects 参数
 *    只接受 TargetSpec / pick / 引用（effect.ready 支持 {kind:"source"}，effect.buff 只
 *    接受 TargetSpec id），而本卡的 “me” 是能力宿主、不是选择目标（355.10.d）；把它写成
 *    TargetSpec 会错误触发“成为目标”规则，也会允许对手影响选择，故不伪造目标。
 * 2. 383.3.b.1 要求该“指令内费用”在 Finalize 支付并据此决定触发能否进链；已合入的
 *    TriggerRegistration.cost 桥接（card-program 适配层）尚未消费 choice.optional 内的
 *    spend-buff 费用，属引擎批 6 / 费用计划（RIFT-89/90）。
 * 3. 触发能力本身仍没有 CardProgram → ChainDraft / TriggerRegistration 的注册适配
 *    （RIFT-257）：chain/engine.ts 已发射 card-played 时点，但 describePlay 由调用方
 *    提供，卡数据没有接线路径。
 */
export default {
  canonicalCardId: "card.hash-050d713d056c980eaa282af3d9145bdcc7e5f630b1b27d672aad1c0fcced6a31",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "1) 「spend a buff to buff me and ready me」里的指令内费用（740.4.a、355.10.c.1）尚无落地路径：" +
    "383.3.b/383.3.b.1 要求在 Finalize 支付该费用并据此决定触发能否进链，已合入的 TriggerRegistration.cost " +
    "桥接没有消费 choice.optional 内的 spend-buff 费用（依赖 RIFT-89/90 费用与目标计划）。" +
    "2) 「buff me」缺少宿主选择器：effect.buff 的 target 参数只接受 TargetSpec id（内部读 ctx.targets），" +
    "没有 effect.ready 那样的 objects 选择器形式（实测未绑定 TargetSpec 时返回 ignored mistargeted）；" +
    "而“me”是宿主自身、不是选择目标（355.10.d），" +
    "故不伪造 TargetSpec，并把「effect.buff 需要宿主/选择器形态的 target」作为契约变更请求上报。" +
    "（effect.ready 的 objects: {kind: \"source\"} 已支持“ready me”，golden 测试据此真实执行该半段。）" +
    "3) 触发能力没有 CardProgram → ChainDraft / TriggerRegistration 的注册适配（RIFT-257）：" +
    "chain/engine.ts 已发射 card-played 时点，但 describePlay 由调用方提供，卡数据没有接线路径。" +
    "effect.buff（mode buff/spend，702.2.b/702.2.b.1/702.3.a）与 effect.ready（416.1）本体已合入，但不构成整卡可执行证据。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self" } }
      },
      optional: true,
      body: [
        {
          id: "wildclaw.may-spend",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Spend a buff to buff and ready Wildclaw Shaman?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "wildclaw.spend-buff",
                  op: "effect.buff",
                  args: {
                    mode: { kind: "constant", value: "spend" },
                    target: { kind: "constant", value: "self" }
                  }
                },
                {
                  id: "wildclaw.buff-self",
                  op: "effect.buff",
                  linkedTo: "wildclaw.spend-buff",
                  args: {
                    mode: { kind: "constant", value: "buff" },
                    target: { kind: "constant", value: "self" }
                  }
                },
                {
                  id: "wildclaw.ready-self",
                  op: "effect.ready",
                  args: { objects: { kind: "constant", value: { kind: "source" } } }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you play me, you may spend a buff to buff me and ready me. (If I don't have a buff, I get a +1 :rb_might: buff.)"
} satisfies CardProgram;
