import type { CardProgram } from "../../ir/index.js";

/**
 * Treasure Trove — CR v1.5 383.2.c.3/383.2.c.3.a–b, 414, 431.2, 429.
 * Card-program trigger and activated bindings are merged. The remaining gap
 * is unregistering the source before the deferred leave-event scan completes.
 * The leave timing uses the action producer's object-left-zone event kind.
 */
const treasureTrove = {
  canonicalCardId: "card.hash-42b87e27f1b0c57a6160fc790e9257e741e6d8ec2e0f7a846d8aa0f6bcbe04f2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "CR 383.2.c.3/383.2.c.3.a–b 的自身离场触发仍受生命周期扫描顺序阻塞：events/pipeline.publish 暂停扫描期间，programs/lifecycle 的 emit 在 object-leaves-board 后立即 detachSource 并注销订阅，随后 drain 已无法扫描到本卡的离场触发。" +
    "应在离场事件完成扫描并捕获最后已知信息后解绑；不能省略生命周期或手动发出离场事件替代。触发 IR 已对齐真实生产者的 kind object-left-zone。" +
    "CardProgram 触发/启动绑定、self 归一化、Chaos Power 与 exhaust 费用规划均已合入；draw、channel exhausted 与 kill-self 已有真实执行证据。参考测试内核的 channel-rune 还未消费 exhausted:true（431.2），故当前证据只验证横置入场动作参数与区域迁移，不能声称已验证横置状态；整卡等待离场扫描/解绑顺序与该动作消费修复。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-leaves-board",
        filter: { event: "object-left-zone", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "treasure-trove.draw",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        },
        {
          id: "treasure-trove.channel",
          op: "effect.channel",
          args: {
            amount: { kind: "constant", value: 1 },
            exhausted: { kind: "constant", value: true }
          }
        }
      ]
    },
    {
      kind: "activated",
      cost: {
        kind: "activated",
        power: { kind: "constant", value: ["Chaos"] },
        payments: [{ kind: "exhaust" }]
      },
      timing: "action",
      body: [
        {
          id: "treasure-trove.kill-self",
          op: "effect.kill",
          args: { self: { kind: "constant", value: true }, reason: { kind: "constant", value: "kill-this" } }
        }
      ]
    }
  ],
  sourceText:
    "When this leaves the board, draw 1 and channel 1 rune exhausted.\n" +
    ":rb_rune_chaos:, :rb_exhaust:: Kill this."
} satisfies CardProgram;

export default treasureTrove;
