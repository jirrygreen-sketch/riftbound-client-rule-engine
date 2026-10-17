import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Akali, Silent (ven-038-166) — Unit, Calm, 4 Energy + 1 Calm Power, Might 4,
 * tag Ionia/Akali/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-038-166，逐字）：
 *   I can't be chosen by enemy spells and abilities unless I'm in combat.
 *   When I move to a battlefield, give me +2 :rb_might: this turn.
 *
 * 规则依据（Core Rules v1.5）：
 * - 355.9.b 及其例（"A unit that reads 'I can’t be chosen by enemy spells and abilities.'
 *   is not a valid target for any enemy spell or ability, even if it meets other targeting
 *   restrictions."）：这是**目标合法性限制**，属于被动/持续限制；054/054.1（Can't beats Can）
 *   说明禁止只移除选项、不授予许可。
 * - 355.7 / 355.10 / 355.10.a.1：目标选择发生在 Finalize，Board 是公开区域，因此该限制由目标
 *   计划在锁定时读取；"unless I'm in combat" 是例外窗口（战斗由 461–468 的 Combat 流程指定
 *   Attacker/Defender 身份，契约 3.8 增补的 ObjectSnapshot.combatRole 即承载该指定）。
 * - 383.1 / 421.1 / 449.1 / 449.2："When I move to a battlefield" 是移动触发；封闭时点
 *   object-moved，"to a battlefield" 用 EventPattern 的 toZone: "battlefield" 表达，
 *   "When I move" 用内层锚点 source: "self" 指称本卡（同 sfd/corinna-veraza 的写法）。
 * - "give me +2 :rb_might: this turn" 是带回合期限的临时 Might 修正，属 layers 的 arithmetic
 *   层（143.2/143.2.a、479）；effect.buff 的边界注释明确临时 Might 不进入 Buff 计数器。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. 目标合法性限制没有消费方：契约 3.6 的封闭 GameAction 集合没有“限制被选为目标”的动作，
 *    target/target-plan.ts 只按调用方显式传入的 isLegal/taxAdapter 工作、不从特征派生；
 *    也没有已合入路径把 CardProgram 的 static 能力注册成 ContinuousEffectSpec（RIFT-357 待合入）。
 * 2. "unless I'm in combat" 的例外需要战斗指定读数：契约 3.8 增补的 ObjectSnapshot.combatRole
 *    尚未进入 engine-core 的 effects/contract.ts（同 ogn/obelisk-of-power、rad/rakelstake）。
 * 3. 临时 Might +2 的 continuous.might 原语已随 RIFT-258 合入（golden 真实执行），仍缺移动触发接线。
 * 4. object-moved 触发缺可判定载荷：events/action-adapter.ts 为 move-location 生成的事件不填
 *    toZone/toKind，内层锚点 source: "self" 也没有消费方（events/pipeline-match.ts 只读
 *    EventPattern 的 object/source/target/player/fromZone/toZone/amount/details）。
 * 依赖：RIFT-90/RIFT-91（目标限制与图层接线）、契约 3.8 的 combatRole 落地、RIFT-87（条件）、
 * RIFT-120（移动时点载荷与卡牌触发注册）。不近似实现：不把禁止改写成“选择后无效”，
 * 也不把临时 Might 写成 Buff 计数器。
 */
const abilities: Ability[] = [
  {
    // 消费者是目标计划，当前没有已合入路径把 static 能力注册成持续效果（见 judgeReason）。
    kind: "static",
    effect: {
      kind: "continuous.target-restriction",
      // 054/054.1：这是“不能被选择”的禁止，不授予任何许可。
      forbids: "chosen-as-target",
      by: "enemy-spells-and-abilities",
      // "unless I'm in combat" 的例外窗口（461–468 的战斗指定；契约 3.8 的 combatRole）。
      unless: "self-in-combat",
      appliesTo: "self"
    }
  },
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      // "When I move to a battlefield"：终点是战场（449.1/449.2 用起止地点定义 Move）。
      filter: { event: "object-moved", toZone: "battlefield", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "akali-silent.might-this-turn",
        // 临时 Might +2（this turn）；continuous.might 已随 RIFT-258 合入。
        // 不写成 Buff 计数器（702/703 的 Buff 不是 Might 变化）。
        op: "continuous.might",
        args: {
          mode: { kind: "constant", value: "add" },
          amount: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "this-turn" },
          appliesTo: { kind: "constant", value: "self" }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-cbfb311a21f9513fabec6e5988abd82142daa5583c2f6638ef10ecc4244c44bc",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1)「I can't be chosen by enemy spells and abilities」是 355.9.b 的目标合法性限制，" +
    "但契约 3.6 的封闭 GameAction 集合没有“限制被选为目标”的动作，target/target-plan.ts 只按调用方显式传入的 isLegal/taxAdapter 工作、" +
    "不从对象特征派生，也没有已合入路径把 CardProgram 的 static 能力注册成 ContinuousEffectSpec（RIFT-357 待合入）；" +
    "(2)「unless I'm in combat」的例外需要战斗指定读数：契约 3.8 增补的 ObjectSnapshot.combatRole 尚未进入 engine-core " +
    "的 effects/contract.ts（同 ogn/obelisk-of-power、rad/rakelstake）；" +
    "(3)「give me +2 :rb_might: this turn」的 continuous.might 原语已随 RIFT-258 合入（golden 真实执行 +2 并经 layers 引擎" +
    "投影出有效 Might 4→6、duration 落为 end-of-turn 即 this-turn 别名），仍缺 object-moved 触发接线：" +
    "events/action-adapter.ts 为 move-location 生成的事件不填 toZone/toKind，内层锚点 source: \"self\" 也没有消费方（RIFT-120）。" +
    "依赖 RIFT-357（位置选择）、RIFT-90、契约 3.8 的 combatRole 落地、RIFT-359（条件）与 RIFT-120。",
  abilities,
  sourceText:
    "I can't be chosen by enemy spells and abilities unless I'm in combat.\n" +
    "When I move to a battlefield, give me +2 :rb_might: this turn."
} satisfies CardProgram;
