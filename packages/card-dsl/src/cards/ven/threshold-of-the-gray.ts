import type { CardProgram } from "../../ir/index.js";

/**
 * Threshold of the Gray (ven-166-166) — Battlefield, Colorless.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-166-166，逐字）：
 *   "When combat starts here, the attacker and defender each [Add] :rb_energy_1:."
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.1："When combat starts …" 是触发能力（Condition 以 When 开头）；封闭时点
 *   events/timing-points.ts 的 combat-start（规则引用 466.1 / 466.2.b）即「战斗开启并执行
 *   战斗开始效果」的时刻，其时点定义已声明载荷字段
 *   ["combatId", "battlefieldId", "attackerId", "defenderId"]，因此 "the attacker and
 *   defender" 指的正是本次战斗的攻守双方（466.2.c.1 / 466.2.c.2 的指定，
 *   466.2.c.3 让玩家取得 Attacker / Defender 身份）。
 * - 053.3："here" 指本战场；190.6.a / 190.6.d：战场能力的控制者是它的控制者
 *   （本条效果的接收者是攻守双方，而不是必然的能力控制者）。
 * - 430.1 / 430.2 / 430.5：Adding 是把资源放进 Rune Pool；"Add" 能力在打出时立即
 *   finalize 并结算、不传递 Priority / Focus（该时序归链引擎），格式为 "Add [resources]。"
 *   因此 "each [Add] :rb_energy_1:" 是两条各自加 1 点 Energy 的指令，
 *   分别落在攻方与守方身上；不涉及 Power，也不涉及目标选择（355.5.a：按条件作用到玩家的
 *   效果不进行选择）。
 * - 已合入原语：effect.resources 提交 gain-energy / gain-power 并把实际增加量写进链接值，
 *   缺省接收者是 ctx.controller；本条需要显式指名攻守双方，而冻结 IR 没有读取触发事件
 *   参与者的选择器（events/trigger-spec.ts 的 PlayerSelector 只有 self / opponent / any /
 *   {playerId}；effect.resources 只接受求值为 PlayerId 的 Expr 或对象控制者），
 *   也没有把时点载荷暴露给卡程序的通道，程序里的 "event-combat-attacker" /
 *   "event-combat-defender" 是缺事件参与者选择器的占位值，不是伪造的席位。
 *
 * status = judge-required（复核 2026-10-16；缺口在触发与接收者绑定，不近似实现）：
 * 1. 没有事件参与者选择器："the attacker and defender" 是本次战斗的两个事件参与者，
 *    冻结 IR 的 PlayerSelector 只有 self/opponent/any/{playerId}，effect.resources 也只接受
 *    求值为 PlayerId 的 Expr 或对象控制者，没有把 combat-start 载荷（attackerId/defenderId）
 *    暴露给卡程序的通道；ObjectSnapshot.combatRole 已进入 effects/contract.ts，但战斗
 *    designation 的写入方仍未实现（combat/flow.ts 的 start 事务会抛
 *    combat-start-transaction）。
 * 2. combat-start 时点仍未发射：combat/flow.ts 的战斗开始事务尚未实现（主动抛出
 *    combat-start-transaction），事件管线只在收到该时点时递增战斗计数；
 *    docs/rules/timing-point-producers.md 仍将该时点标为"待后续"。
 *    RIFT-257 的卡牌程序绑定（src/programs/triggers.ts）已能注册 CardProgram 的
 *    triggered ability，190.6 的战场能力控制者解析仍未接线；filter 的 here: true 是
 *    053.3 的战场指代占位（静态 filter 读不到事件出的战场，且会被 programs/filters.ts
 *    以 judge-required 拒绝，fail closed）。
 * 3. 已支持部分由 golden 真实执行：effect.resources 的"各加 1 Energy、不加 Power"语义
 *    （在补齐攻守席位绑定后）与占位状态下的"不静默加资源"。
 * 依赖：战斗开始/designation 事务（combat-start 发射）、事件参与者选择器（契约变更请求）、
 * 053.3 here 锚点 / 190.6 战场能力绑定。
 */
export default {
  canonicalCardId: "card.hash-f3d497c8272c7189495fd4ff73a5a4450b60af7a9e559bdf73d4c3e1380bfcc3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 「the attacker and defender」是本次战斗的两个事件参与者（466.2.c.1/466.2.c.2 指定、" +
    "466.2.c.3 取得身份），而冻结 IR 没有事件参与者选择器：events/trigger-spec.ts 的 PlayerSelector 只有 " +
    "self/opponent/any/{playerId}，effect.resources 只接受求值为 PlayerId 的 Expr 或对象控制者，" +
    "也没有把 combat-start 时点载荷（attackerId/defenderId）暴露给卡程序的通道；契约 3.8 的 ObjectSnapshot.combatRole " +
    "虽已进入 engine-core 的 effects/contract.ts，但 combat designation 的写入方仍未实现（combat/flow.ts 的战斗开始事务主动抛 " +
    "combat-start-transaction；同 ogn/obelisk-of-power、rad/rakelstake 的缺口）。" +
    "程序中的 \"event-combat-attacker\"/\"event-combat-defender\" 是缺选择器的占位值，不可执行。" +
    "(2) combat-start 时点（466.1/466.2.b）仍未发射：combat/flow.ts 的战斗开始事务尚未实现（主动抛 combat-start-transaction），" +
    "事件管线仅在该时点递增战斗计数，docs/rules/timing-point-producers.md 仍标为待后续；RIFT-257 的卡牌程序绑定" +
    "（src/programs/triggers.ts）已能注册 CardProgram 的 triggered ability，190.6 的战场能力控制者解析仍未接线；" +
    "filter 的 here: true 是 053.3 的占位（静态 filter 读不到事件出的战场），会被 programs/filters.ts " +
    "以 judge-required 拒绝（fail closed）。" +
    "(3) 效果本体已合入：effect.resources 的「各加 1 Energy、不加 Power」（430.1/430.2/430.5）在 golden 中于补齐两个席位后真实执行；" +
    "占位状态下不静默加任何资源。依赖：战斗开始/designation 事务（combat-start 发射）、事件参与者选择器（契约变更请求）、" +
    "053.3 here 锚点 / 190.6 战场能力绑定。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "combat-start",
        // "here" 是本战场（053.3），触发者是本次战斗（466.2.b）；
        // 同类战场程序沿用同一处占位写法，等待战斗触发接线落地。
        filter: { event: "combat-start", here: true }
      },
      optional: false,
      body: [
        {
          // "the attacker … [Add] :rb_energy_1:"（430.5）：占位席位表示缺事件参与者选择器，
          // 不是伪造的玩家 id（见 judgeReason）。
          id: "threshold-of-the-gray.add-attacker",
          op: "effect.resources",
          args: {
            energy: { kind: "constant", value: 1 },
            player: { kind: "constant", value: "event-combat-attacker" }
          }
        },
        {
          // "… and defender each [Add] :rb_energy_1:"：第二条独立指令，接收者是守方。
          id: "threshold-of-the-gray.add-defender",
          op: "effect.resources",
          args: {
            energy: { kind: "constant", value: 1 },
            player: { kind: "constant", value: "event-combat-defender" }
          }
        }
      ]
    }
  ],
  sourceText: "When combat starts here, the attacker and defender each [Add] :rb_energy_1:."
} satisfies CardProgram;
