import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Volibear, Imposing (ogn-158-298) — Unit（能量 12，力量 2，Might 10，Body；Volibear/Freljord/Champion）。
 *
 * 原文：
 *   [Shield 3] (+3 :rb_might: while I'm a defender.)
 *   [Tank] (I must be assigned combat damage first.)
 *   When an opponent moves to a battlefield other than mine, draw 1. (Bases are not battlefield.)
 *
 * 规则依据（CR v1.5）：
 * - [Shield 3] 814.1.c/814.1.d.1：只在维持 Defender designation 时 +3 Might；
 *   814.2 多来源数值相加。按契约 3.7 由 keywords/Shield.ts 展开，只声明值 3。
 * - [Tank] 815.1.b/815.1.c.2：先给同控制者的 Tank 单位分配致命伤害，才能分配给
 *   非 Tank 单位。由 keywords/Tank.ts 展开为 static continuous.combat。
 * - 383.1："When an opponent moves to a battlefield other than mine, draw 1." 是
 *   触发能力；"moves" 对应 421.1 / 449.1 的 Move（时点 "object-moved"，
 *   421.1/449.1/449.2/458），"other than mine" 以来源当前位置为锚点比较。
 *
 * 复核后的边界（cards/README.md 第 2 节）：judge-required。
 * - programs/triggers.ts 已提供 CardProgram → TriggerRegistration 注册，filters.ts
 *   也会转译 { event, filter }；不能再把通用绑定列为未合入依赖。
 * - Shield 展开读取 object-property "designation"，ObjectSnapshot 却只有 combatRole；
 *   programs/statics.ts 的条件包装捕获求值异常后返回 false，防守时的 +3 尚不生效。
 * - Tank 的 continuous.combat damage-assignment/priority:first 尚无图层/战斗消费方；
 *   combat/base-combat-allocation.ts 不读取该优先级要求。
 * - 提交 move-location 已由 events/action-adapter.ts 发射 object-moved；zones/movement
 *   的 Standard Move group 返回 events/requiresMoveTriggers，duel/standard-move-executor-v2
 *   已提供等待完整触发结算的入口，仍缺此 CardProgram 的移动触发处理接线。
 * - 触发判定还需比较目的战场与来源当前位置，排除 Base（原文）与 Recall（458.1）。
 *   movedToOtherThanSourceLocation 保留为不可执行的占位描述键：programs/filters.ts
 *   拒绝它，TriggerSpec/EventPattern 没有相对位置不等谓词，EventPattern 枚举也未包含
 *   object-moved。不能删掉 "other than mine" 后宣称整卡可执行。
 * golden 真实执行 effect.draw 和原始 body，并验证已提交移动动作的事件发射及位置快照；
 * 这些子路径不构成 Shield、Tank 或完整移动触发的执行证据。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "shield", value: 3 },
  { kind: "keyword", keyword: "tank" },
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: {
        event: "object-moved",
        filter: { type: "unit", controller: "opponent", movedToOtherThanSourceLocation: true }
      }
    },
    optional: false,
    body: [
      {
        id: "volibear.draw-1",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-b57666e4f1117003af3567a39c4c880bafc5ff8b149545385d26dfe3ad0db3c4",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "[Shield 3] 的防守条件（CR v1.5 814.1.c/814.1.d.1）仍需修正：keywords/Shield.ts 读取 " +
    "designation，但 ObjectSnapshot 暴露 combatRole，programs/statics.ts 捕获求值异常后使 +3 Might 不生效。" +
    "[Tank] 的 continuous.combat damage-assignment/priority:first 尚无图层/战斗消费方，" +
    "combat/base-combat-allocation.ts 未绑定致命伤害优先分配要求（815.1.b/815.1.c.2）。" +
    "object-moved 触发（383.1；421.1/449.1/449.2）仍缺目的地为战场且不同于来源当前位置的动态比较：" +
    "movedToOtherThanSourceLocation 只是占位键，programs/filters.ts 会拒绝，TriggerSpec/EventPattern " +
    "没有该相对位置谓词，EventPattern 枚举也未包含 object-moved；须排除 Base 与 Recall（458.1）。" +
    "zones/movement 的 Standard Move group 返回 events/requiresMoveTriggers，" +
    "duel/standard-move-executor-v2.ts 已有等待整组触发结算的入口，仍需绑定此 CardProgram 的真实移动触发处理。",
  abilities,
  sourceText:
    "[Shield 3] (+3 :rb_might: while I'm a defender.)\n" +
    "[Tank] (I must be assigned combat damage first.)\n" +
    "When an opponent moves to a battlefield other than mine, draw 1. (Bases are not battlefield.)"
} satisfies CardProgram;

export default program;
