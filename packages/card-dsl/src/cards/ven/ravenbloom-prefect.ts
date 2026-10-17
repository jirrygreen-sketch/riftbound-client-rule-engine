import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ravenbloom Prefect (ven-102-166) — Unit, Chaos, tag Noxus.
 * 3 Energy, no printed Power（`power: null`，不是 0），Might 3。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-102-166，逐字）：
 *   When an opponent plays a gear, you may banish me to banish it.
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.4.a.4 / 420.4.a：“When an opponent plays a gear” 是“另一张牌被打出时”的触发条件，
 *   不是 Play Effect；观察时点为 card-played，条件里的事件牌是 gear（355.9.a.1 的 “gear”
 *   指 Board 上的装备，此处指被打出的那张牌），打出者是该能力控制者的对手（740.1.b）。
 * - 383.3.a / 383.3.a.1：效果首部的 “you may” 是触发能力的执行决定，由 ability.optional 表达；
 *   契约 3.9 的 choice.optional 包装用于“you may + 指令”的句式，这里不再重复包装，
 *   以免触发能力被问两次、或在被跳过后仍继续执行。
 * - 383.3.b / 383.3.b.1：“banish me” 紧跟在 “you may” 之后，是指令内费用，因此在 Finalize
 *   作为该触发能力的基础费用支付（428.5 的 Banish 只能由游戏效果/费用指示执行）。
 * - 428.1 / 428.2：“banish it” 把被打出的那张装备放入其拥有者的 Banishment（不是 Kill，
 *   428.2.a，也不是 Discard，428.2.b）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，两处缺口均不近似实现：
 * 1. “banish me” 作为费用没有可支付的凭据种类：cost/plan-values.ts 的非标准费用只支持
 *    exhaust/discard/recycle/kill/reveal/spend-buff，没有 banish（RIFT-89）；契约 3.1 的
 *    TriggeredAbility 也没有 cost 字段，费用只能按 383.3.b 在指令里声明。程序按契约形状保留
 *    cost.pay 指令，不在卡里手改状态。
 * 2. “it” 指触发事件里的那张被打出的装备，而冻结的 ObjectSelector 只有 self/source/target/
 *    pick/linked，没有“触发事件的物件”选择器（同 ogn/back-alley-bar 记录的契约缺口，
 *    见回复里的契约变更请求）。因此 effect.banish 的对象位置只保留描述性占位，不伪造引用。
 * 触发注册路径本身已合入（programs/lifecycle.ts → triggers.ts → pipeline.registerTrigger，
 * `player: "opponent"` 也由 translateTriggerFilter 归一化）；上面两处缺口仍阻止整卡执行。
 * 已支持部分：effect.banish 本体（把锁定的牌放进 Banishment）在 golden 中真实执行。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      // 420.4.a 的打出时点；“an opponent” 是相对能力控制者的玩家选择器，
      // 事件物件限制为被打出的 gear（383.4.a.4：这不是本卡的 Play Effect）。
      filter: {
        event: "card-played",
        object: { type: "gear" },
        player: "opponent"
      }
    },
    optional: true,
    body: [
      {
        id: "ravenbloom-prefect.pay-banish-self",
        // 383.3.b：紧跟 “you may” 的 “banish me” 是该触发能力的基础费用，
        // 必须在 Finalize 支付；banish 付费种类未合入（见 judgeReason 第 1 点）。
        op: "cost.pay",
        args: {
          payments: { kind: "constant", value: [{ kind: "banish", object: "self" }] }
        }
      },
      {
        id: "ravenbloom-prefect.banish-it",
        linkedTo: "ravenbloom-prefect.pay-banish-self",
        // “banish it” = 被放逐自己后否定那张被打出的装备（428.1/428.2）。
        op: "effect.banish",
        args: {
          // 触发事件物件的选择器缺口见 judgeReason 第 2 点：保留描述性占位，
          // 不写运行时 ObjectRef，也不用错误的自指近似 “it”。
          objects: {
            kind: "constant",
            value: { triggerObject: "card-played" }
          },
          amount: { kind: "constant", value: 1 },
          linkKey: { kind: "constant", value: "banishedGear" }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-d634172fb2585ee4db78e68c349e431e5825d5f5ef9f9bc7e4ce2f3904a44e74",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1)「banish me」按 383.3.b/383.3.b.1 是触发能力的指令内基础费用（428.5），" +
    "但 cost/plan-values.ts 的非标准费用只支持 exhaust/discard/recycle/kill/reveal/spend-buff，没有 banish 付费种类，" +
    "且契约 3.1 的 TriggeredAbility 没有 cost 字段（RIFT-89）；程序按契约形状保留 cost.pay，不在卡里手改状态。" +
    "(2)「banish it」的 “it” 是触发事件里的那张被打出的装备，而冻结的 ObjectSelector 只有 self/source/target/pick/linked，" +
    "没有触发事件物件的选择器（同 ogn/back-alley-bar 的记录，已登记契约变更请求），因此只保留描述性占位；" +
    "触发注册路径本身已合入（programs/lifecycle.ts → triggers.ts → pipeline.registerTrigger，`player: \"opponent\"` 也由 " +
    "translateTriggerFilter 归一化）；触发事件的物件选择器仍是缺口，已登记契约变更请求。" +
    "已支持部分：effect.banish 本体（锁定的牌进入 Banishment）在 golden 中真实执行；383.3.a 的 “you may” 决定由 " +
    "ability.optional 表达（不再重复 choice.optional 包装）。",
  abilities,
  sourceText: "When an opponent plays a gear, you may banish me to banish it."
} satisfies CardProgram;
