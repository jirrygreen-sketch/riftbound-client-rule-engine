import type { CardProgram } from "../../ir/index.js";

/**
 * Chemtech Cask (sfd-063-221) — Gear, 1 energy、power null（无印刷 Power）、领域 Mind、
 * 标签为空。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-063-221）：
 *   "When you play a spell on an opponent's turn, you may exhaust me to play a Gold
 *    gear token exhausted."
 *
 * 规则依据（CR v1.5）：
 * - 383.2.a / 383.4.a：句首的 “When you play a spell …” 是触发条件（383.2.a.1 明确“当…时”
 *   之后的条件从句属于触发条件）；打出法术对应 card-played 时点（359 / 383.4.a / 407），
 *   过滤 spell 且事件玩家是本能力控制者。
 * - 204.1.c / 204.3 / 355.10.c.1：“exhaust me to play …” 是成本内指令（[do X] to [do Y]）；
 *   横置自身是费用、打出 token 是效果，费用必须先支付能力才成立——横置作为费用归
 *   cost.exhaust / 费用计划（415.4/415.5），不是 effect.exhaust。
 * - 187.5：Gold gear token 是 domainless gear token，自带
 *   “[Reaction][>] Kill this, [E]: [Add] [A].”。
 * - 440.2.c / 185.2.a / 186 / 350.2 / 354：“play a … token” 必须先在链上生成再由 play
 *   接手打出；184.1 / 185.2.d 的 “exhausted” 是入场的状态规定（替代入场时的默认状态），
 *   不是入场后再横置。
 * - 315.2.a / 383.2.a：“your turn” 侧的 “on an opponent's turn” 需要在触发时比较事件发生
 *   的回合玩家与能力控制者。
 *
 * status = judge-required（四处缺口，全部不近似实现）：
 * 1. “on an opponent's turn” 无法判定：冻结的 TriggerSpec 只有 at / filter / condition /
 *    once，ObjectFilter/EventPattern 只暴露 object/source/target 的 controller/owner
 *    选择符，没有「事件发生时的回合玩家不是能力控制者」谓词；history 计数也不区分为谁的
 *    回合（同型缺口见 ogn 的 Viktor, Innovator，调研表把它归入 continuous.timing 的
 *    opponent's turn，RIFT-91）。
 * 2. 成本内指令的横置费用没有落地路径：TriggeredAbility 没有 cost 字段，指令层也没有注册的
 *    cost.pay 原语（engine-core instructions 注册表只有 effect.* 与解释器内建的控制/条件
 *    节点），费用计划与 Finalize 收费管线未接通（RIFT-89/90）。
 * 3. Gold gear token 定义（187.5，自带能力）不在冻结的 effect.token 定义表内：实测
 *    effect.token 直接以 blockedReason "token-definition-or-abilities-judge-required"
 *    返回 negated（同型缺口见 sfd 的 Treasure Hoard / rad 的 An Offer You Can't Refuse）。
 * 4. “play a Gold gear token exhausted” 的横置入场是 create-token 的入场改写（184.1 /
 *    185.2.d / 143.4），闭集动作不支持（effect.token 文件头明确 “Entry overrides are not
 *    supported”）；事后补 effect.exhaust 会多产生一次“成为横置”事件并错过入场替代，故不
 *    这样做。此外还缺少卡牌程序 → TriggerRegistration 的接线（契约 3.5）。
 * 依赖：事件载荷/触发器过滤扩展（回合归属，RIFT-91）、cost.pay 与费用管线（RIFT-89/90）、
 * Gold token 定义与入场状态改写（RIFT-81~91 token 批次）。
 */
export default {
  canonicalCardId: "card.hash-b17653c3279ad7444bd22e0e4bbc50082723df4f070dcc8c6ac42259fb58b54e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口：(1)「on an opponent's turn」无法判定——冻结的 TriggerSpec 只有 at / filter / condition / once，" +
    "ObjectFilter/EventPattern 只暴露 object/source/target 的 controller/owner 选择符，没有「事件发生时的回合玩家不是" +
    "能力控制者」谓词，history 计数也不区分回合归属（同型缺口见 Viktor, Innovator；调研表归入 continuous.timing 的 " +
    "opponent's turn，RIFT-91）；(2)「exhaust me to play …」是成本内指令（204.1.c/204.3/355.10.c.1）：" +
    "TriggeredAbility 没有 cost 字段，指令层也没有注册的 cost.pay 原语，费用计划与 Finalize 收费管线未接通（RIFT-89/90）；" +
    "(3) Gold gear token 定义（187.5，自带「[Reaction][>] Kill this, [E]: [Add] [A].」）不在冻结的 effect.token 定义表内，" +
    "实测 effect.token 以 blockedReason \"token-definition-or-abilities-judge-required\" 返回 negated；" +
    "(4)「play a Gold gear token exhausted」的横置入场是 create-token 的入场改写（184.1/185.2.d/143.4），闭集动作不支持" +
    "（effect.token 明确 Entry overrides are not supported），事后补 effect.exhaust 会多产生一次“成为横置”事件并错过入场替代，" +
    "故不近似；此外缺少卡牌程序 → TriggerRegistration 接线（契约 3.5）。依赖：回合归属谓词（RIFT-91）、cost.pay/费用管线" +
    "（RIFT-89/90）、Gold token 定义与入场状态改写。不近似实现。",
  abilities: [
    {
      // 383.2.a / 383.4.a：订阅 card-played（“你打出法术”），事件对象是 spell、事件玩家是控制者。
      // 「on an opponent's turn」需要回合归属谓词（见 judgeReason 第 1 点），这里不写条件，
      // 也不把条件近似成恒真。
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          object: { type: "spell" },
          player: "self"
        }
      },
      // 403.1 的 “you may”：可选触发。
      optional: true,
      body: [
        {
          // 204.3：成本内指令先支付（横置自身），由费用管线接管；当前无 cost.pay 原语。
          id: "chemtech-cask.pay-exhaust",
          op: "cost.pay",
          args: {
            payments: { kind: "constant", value: [{ kind: "exhaust", object: "self" }] }
          }
        },
        {
          // 440.2.c / 185.2.a / 187.5：在链上创建 Gold gear token 并由 play 接手打出。
          // “exhausted” 入场状态与 Gold 定义都无法在 effect.token 里表达（见 judgeReason
          // 第 3、4 点），因此该指令当前不可执行，不会被当成已实现语义。
          id: "chemtech-cask.play-gold-token",
          op: "effect.token",
          linkedTo: "chemtech-cask.pay-exhaust",
          args: {
            token: { kind: "constant", value: "gold" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } },
            linkKey: { kind: "constant", value: "goldToken" }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you play a spell on an opponent's turn, you may exhaust me to play a Gold gear token exhausted."
} satisfies CardProgram;
