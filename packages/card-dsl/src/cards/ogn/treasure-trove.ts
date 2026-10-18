import type { CardProgram } from "../../ir/index.js";

/**
 * Treasure Trove — CR v1.5 383.2.c.3/383.2.c.3.a–b, 414, 431.2, 429.
 * 复核 2026-10-17：离场触发的注册顺序缺口仍在，参考测试内核的 channel 也不消费
 * exhausted:true；启动杀自身与抽牌半段有真实执行证据。
 */
const treasureTrove = {
  canonicalCardId: "card.hash-42b87e27f1b0c57a6160fc790e9257e741e6d8ec2e0f7a846d8aa0f6bcbe04f2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口（2026-10-17 复核）：" +
    "(1) CR 383.2.c.3/383.2.c.3.a–b 的自身离场触发被生命周期解绑顺序吃掉：" +
    "programs/lifecycle.ts 的 detachSource 在 pipeline.emit 返回后立即执行（leavesBoard 判定含 object-leaves-board），" +
    "而 pipeline.publish 是在 suspended>0 期间先发事件、出组后才 drain；解绑发生在扫描之前。" +
    "实测经生产 attachLifecycle 注册后 kill 本卡，订阅数由 1 变 0，手牌与符文区均无变化（抽 1 与 Channel 1 都没发生）。" +
    "应在离场事件完成扫描并捕获最后已知信息后解绑；不能省略生命周期或手动发出离场事件替代。" +
    "(2) 431.2 的 exhausted:true 在参考测试内核里不落地：effects/testing/test-kernel.ts 的 channel-rune 分支只搬区域、" +
    "不把 exhausted 写进入场状态，实测 channel 1 exhausted 后该符文 exhausted 仍为 false（game-server 的 engine-runtime/host.ts 已消费该字段，" +
    "所以这只是参考内核的覆盖缺口，不能拿它当整卡通过证据）。" +
    "已合入并有执行证据：CardProgram 触发/启动绑定与 self 归一化、Chaos Power + exhaust 的费用规划与支付回执、" +
    "启动杀自身（effect.kill self）、离场 body 的 draw 与 channel 动作参数、以及触发过滤只匹配本卡真实生产者发出的 object-left-zone 事件。",
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
