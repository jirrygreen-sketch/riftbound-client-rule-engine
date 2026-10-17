import type { CardProgram } from "../../ir/index.js";

/**
 * Nine-Tailed Fox (ogn-255-298) — Legend, Calm/Mind, Ahri.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-255-298，逐字）：
 *   When an enemy unit attacks a battlefield you control, give it -1 :rb_might:
 *   this turn, to a minimum of 1 :rb_might:.
 *
 * 规则依据（CR v1.5）：
 * - 383.1 / 383.2.a：“When an enemy unit attacks …” 是触发条件；封闭时点表用
 *   "attack-declared"（323.2 / 383.4.e / 466.2.c）。事件对象是攻击单位，filter 取
 *   unit 且 controller 为 opponent。
 * - “a battlefield you control”：需要攻击事件所处战场及其控制状态；attack-declared
 *   载荷只有 combatId/battlefieldId/attackerId/defenderId，控制者由 scoring/ 的
 *   控制状态提供，尚未进入触发过滤。
 * - “give it -1 Might this turn, to a minimum of 1”：临时 Might 修正与下限钳制。
 *   effect.buff 明确把临时 Might 归 layers 的 continuous.might；契约 3.6 的封闭
 *   GameAction 集合没有 might 修改动作，"to a minimum of 1"（见 CR 478.1.c 例）也没有
 *   钳制实现。
 * - “it” 指触发事件里的攻击单位：合并 IR 的 ObjectSelector 只有 self/source/target/pick/
 *   linked，没有“触发事件的物体”选择器；这里用 TargetSpec attacking-unit 保留形状，
 *   真正的绑定必须由触发系统按 383.2.c.3.b / 359.3.f.3 锁定事件信息。
 *
 * status = judge-required（复核后仍有两个缺口，都不近似实现）：
 * - 临时 Might 修正与下限钳制已合入：continuous.might 支持 amount/duration
 *   （this-turn → end-of-turn 到期）与 minimum（buildMightSpec 会在注册时快照
 *   钳制增量，layers/ops 的 applyMightMinimums 按 478.1.c 逐步钳制），golden 用
 *   真实原语执行并断言 -1 与 minimum 1 的注册形状；
 * - 但仍不能接线：(1) attack-declared 没有任何产生方——combat/flow.ts 的
 *   combat-start 事务会抛 TurnCombatBlockedError（CR 466.2）；(2) “a battlefield
 *   you control” 的控制状态不在事件载荷（只有 combatId/battlefieldId/attackerId/
 *   defenderId，需 details 维度）中；(3) “it” 需要一个事件对象选择器（383.2.c.3.b /
 *   359.3.f.3），ObjectSelector 只有 self/source/target/pick/linked；当前程序绑定
 *   已能注册该触发，仍缺事件物体到目标的运行时锁定。
 * 依赖：攻击/战斗时点产生方（RIFT-124 已合入，但 combat/flow.ts 的 combat-start
 * 事务仍抛 TurnCombatBlockedError）、触发事件物体选择器
 * 与 attack-declared 载荷的战场控制状态。
 */
const nineTailedFox = {
  canonicalCardId:
    "card.hash-1e014c6eec053a33481b4f7adeabd0de2ec5684e450291208a419881b3d6aa9c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "临时 Might 修正已合入（continuous.might 的 amount/duration/minimum 与 layers/ops 的 applyMightMinimums，" +
    "按 478.1.c 逐步钳制；golden 已用真实原语执行并断言注册形状），整卡仍不可执行的原因在触发侧：" +
    "(1) attack-declared 没有任何产生方——RIFT-124 与 RIFT-270 均已合入，但 combat/flow.ts 的 combat-start 角色事务仍未实现（抛 TurnCombatBlockedError，CR 466.2）；" +
    "(2) attack-declared 载荷（combatId/battlefieldId/attackerId/defenderId）不带“该战场由你控制”的控制状态，触发过滤无从判定；" +
    "(3) “it” 需要触发事件物体选择器（383.2.c.3.b / 359.3.f.3），合并 ObjectSelector 只有 self/source/target/pick/linked。" +
    "依赖：combat 事务的时点产生方、载荷控制状态维度与事件物体选择器。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: {
          event: "attack-declared",
          object: {
            type: "unit",
            controller: "opponent"
          }
          // “a battlefield you control” 的控制状态不在事件载荷中；见 judgeReason。
        }
      },
      optional: false,
      body: [
        {
          id: "nine-tailed-fox.debuff-attacker",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -1 },
            duration: { kind: "constant", value: "this-turn" },
            minimum: { kind: "constant", value: 1 },
            target: { kind: "constant", value: "attacking-unit" }
          },
          targets: [
            {
              id: "attacking-unit",
              // “it” = 触发事件的攻击单位；此 TargetSpec 是形状保留，运行时必须绑定事件物体，
              // 不允许重新自由选择敌方单位（见 judgeReason）。
              filter: { type: "unit", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "When an enemy unit attacks a battlefield you control, give it -1 :rb_might: this turn, " +
    "to a minimum of 1 :rb_might:."
} satisfies CardProgram;

export default nineTailedFox;
