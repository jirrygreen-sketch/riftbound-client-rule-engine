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
 * 1. 目标合法性限制的静态绑定已随 RIFT-258 合入（programs/statics.ts → attachProgramLifecycle
 *    把 static 能力绑成 ability 层注册），但 continuous.target-restriction 的 forbids/by/unless
 *    形状没有读侧消费方：layers/rules/query.ts 的 restrictions() 只读 restriction 类别的
 *    actions/restriction/cancels，target/target-plan.ts 的 ruleRestrictions 消费方也依赖该形状，
 *    且生产链路没有给 TargetCandidateOptions 传 ruleRegistry，“限制被选为目标”仍不可判定。
 * 2. "unless I'm in combat" 的例外要读战斗指定：ObjectSnapshot.combatRole 字段已进
 *    effects/contract.ts（契约 3.8），但 466.2 的宣告事务被 combat/flow.ts 阻塞，该字段
 *    还没有填充者，例外仍不可求值。
 * 3. 临时 Might +2 的 continuous.might 原语已随 RIFT-258 合入（golden 真实执行），触发注册的
 *    静态路径（programs/triggers.ts → registerProgramTriggers）也已随 RIFT-257 合入。
 * 4. 触发注册在更早阶段失败：events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 没有
 *    object-moved，registerProgramTriggers 对该 filter 抛 TriggerSpecValidationError /
 *    invalid-event-type；在补齐该事件类型及其 object-moved 载荷适配前，能力无法进入生产管线。
 * 依赖：新的 target-restriction 读侧消费方任务（forbids/by/unless 形状）、宣告事务与
 * combatRole 填充任务（466.2）、object-moved 事件枚举与载荷适配任务。
 * 不近似实现：不把禁止改写成“选择后无效”，也不把临时 Might 写成 Buff 计数器。
 */
const abilities: Ability[] = [
  {
    // 静态绑定已随 RIFT-258 合入（programs/statics.ts → attachProgramLifecycle）；
    // 缺的是 continuous.target-restriction 的读侧消费方（见 judgeReason）。
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
    "\u4e09\u5904\u7f3a\u53e3\uff0c\u5747\u4e0d\u8fd1\u4f3c\u5b9e\u73b0\uff1a(1)\u300cI can't be chosen by enemy spells and abilities\u300d\u662f 355.9.b \u7684\u76ee\u6807\u5408\u6cd5\u6027\u9650\u5236\uff0c" +
    "\u9759\u6001\u80fd\u529b\u7ecf programs/statics.ts \u2192 attachProgramLifecycle \u7ed1\u5165\u56fe\u5c42\uff08RIFT-258\u5df2\u5408\u5165\uff09\u540e\u843d\u5728 ability \u5c42\uff0c" +
    "\u4f46 continuous.target-restriction \u7684 forbids/by/unless \u5b57\u6bb5\u6ca1\u6709\u8bfb\u4fa7\u6d88\u8d39\u65b9\uff1alayers/rules/query.ts \u7684 restrictions() " +
    "\u53ea\u8bfb restriction \u7c7b\u522b\u7684 actions/restriction/cancels\uff0ctarget/target-plan.ts \u7684 ruleRestrictions \u6d88\u8d39\u65b9\u4e5f\u4f9d\u8d56\u8be5\u5f62\u72b6\uff0c" +
    "\u4e14\u751f\u4ea7\u94fe\u8def\u6ca1\u6709\u7ed9 TargetCandidateOptions \u4f20 ruleRegistry\uff0c\u201c\u9650\u5236\u88ab\u9009\u4e3a\u76ee\u6807\u201d\u4ecd\u4e0d\u80fd\u8fdb\u5165\u76ee\u6807\u5408\u6cd5\u6027\uff1b" +
    "(2)\u300cunless I'm in combat\u300d\u7684\u4f8b\u5916\u7a97\u53e3\u8981\u8bfb 442.1.a \u7684\u6218\u6597\u6307\u5b9a\uff1aObjectSnapshot.combatRole \u5b57\u6bb5\u5df2\u8fdb " +
    "effects/contract.ts\uff0c\u4f46 466.2 \u7684\u5ba3\u544a\u4e8b\u52a1\u88ab combat/flow.ts \u4ee5 TurnCombatBlockedError('combat-start-transaction') " +
    "\u963b\u585e\uff0c\u8be5\u5b57\u6bb5\u8fd8\u6ca1\u6709\u586b\u5145\u8005\uff0c\u4f8b\u5916\u4ecd\u4e0d\u53ef\u6c42\u503c\uff1b" +
    "(3)\u300cgive me +2 :rb_might: this turn\u300d\u7684 continuous.might \u539f\u8bed\u5df2\u968f RIFT-258 \u5408\u5165\uff08golden \u771f\u5b9e\u6267\u884c +2 \u5e76\u7ecf layers \u5f15\u64ce" +
    "\u6295\u5f71\u51fa\u6709\u6548 Might 4\u21926\uff09\uff0c\u89e6\u53d1\u6ce8\u518c\u7684\u9759\u6001\u8def\u5f84\u4e5f\u5df2\u968f RIFT-257 \u5408\u5165\uff0c\u4f46\u8be5\u89e6\u53d1\u7684\u4e8b\u4ef6\u8fc7\u6ee4\u5728\u6ce8\u518c\u65f6\u88ab\u62d2\u7edd\uff1a" +
    "events/trigger-spec.ts \u7684 EVENT_PATTERN_TYPES \u4e0d\u5305\u542b object-moved\uff0cregisterProgramTriggers \u629b TriggerSpecValidationError / invalid-event-type\uff1b" +
    "\u8865\u9f50\u4e8b\u4ef6\u679a\u4e3e\u3001object-moved \u8f7d\u8377\u548c\u7ba1\u7ebf\u9002\u914d\u524d\u65e0\u6cd5\u8fdb\u5165\u751f\u4ea7\u8ba2\u9605\u3002" +
    "\u4f9d\u8d56\u65b0\u7684 target-restriction \u8bfb\u4fa7\u6d88\u8d39\u65b9\u4efb\u52a1\u3001\u5ba3\u544a\u4e8b\u52a1/combatRole \u586b\u5145\u4efb\u52a1\u4e0e object-moved \u4e8b\u4ef6\u9002\u914d\u4efb\u52a1\u3002" +
    "\u4e0d\u8fd1\u4f3c\u5b9e\u73b0\uff1a\u4e0d\u628a\u7981\u6b62\u6539\u5199\u6210\u201c\u9009\u62e9\u540e\u65e0\u6548\u201d\uff0c\u4e5f\u4e0d\u628a\u4e34\u65f6 Might \u5199\u6210 Buff \u8ba1\u6570\u5668\u3002",
  abilities,
  sourceText:
    "I can't be chosen by enemy spells and abilities unless I'm in combat.\n" +
    "When I move to a battlefield, give me +2 :rb_might: this turn."
} satisfies CardProgram;
