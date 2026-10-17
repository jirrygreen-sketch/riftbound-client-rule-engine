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
 * status：judge-required。Shield 的 designation 别名已有扩展求值器，
 * 但静态条件仍未接通；Tank 缺 lethal-first 的战斗分配消费方。
 * object-moved 的事件词表、相对目的地谓词、Standard Move 管线接线与
 * 移动原因载荷仍缺，不能丢弃 other than mine、Base 和 Recall 的限制。
 * draw、关键词展开与移动事件的已有子路径测试均保留。
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
    "缺以下生产接线：(1) Shield 3（814.1.c/814.1.d.1）的 designation→combatRole 读取虽有扩展求值器，" +
    "programs/statics.ts 的条件仍调用基础 evaluateCondition，防守 +3 尚未接通；combat/flow.ts 还缺战斗身份原子事务。" +
    "(2) Tank（815.1.b/815.1.c.2）的 continuous.combat 缺 lethal-first 分配消费方，" +
    "combat/base-combat-allocation.ts 的 keywordPriority 只接受 proven-none。" +
    "(3) object-moved 不在 EVENT_PATTERN_TYPES（invalid-event-type）；" +
    "目的战场不同于来源当前位置的谓词缺失，movedToOtherThanSourceLocation 占位键被 programs/filters.ts 拒绝。" +
    "Standard Move 的 requiresMoveTriggers 未经 duel/standard-move-executor-v2.ts → duel/cardplay-unit-v2.ts 发布到 EventPipeline；" +
    "直接提交 move-location 的生产载荷缺 fromKind/fromLocationId/toKind/toLocationId 与移动原因，" +
    "无法可靠排除 Base、Recall（458.1）并判断 other than mine。",
  abilities,
  sourceText:
    "[Shield 3] (+3 :rb_might: while I'm a defender.)\n" +
    "[Tank] (I must be assigned combat damage first.)\n" +
    "When an opponent moves to a battlefield other than mine, draw 1. (Bases are not battlefield.)"
} satisfies CardProgram;

export default program;
