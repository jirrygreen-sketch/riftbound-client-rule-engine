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
 * - [Shield 3] 814：带数值的被动关键词（814.1.c 在防守时 +3 Might；814.2 多来源相加）；
 *   按契约 3.7 由 keywords/Shield.ts 展开，卡程序只声明值 3。
 * - [Tank] 815：被动关键词（815.1.b 战斗伤害分配顺序）；无已合入的 KeywordDef 文件。
 * - 383.1："When an opponent moves to a battlefield other than mine, draw 1." 是
 *   触发能力；"moves" 对应 421.1 / 449.1 的 Move（时点 "object-moved"，
 *   421.1/449.1/449.2/458），"other than mine" 以来源当前位置为锚点比较。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - Tank 没有 KeywordDef（effects/keywords/ 无 Tank.ts），战斗伤害分配里也没有
 *   读取 Tank、Backline 等分配优先级要求（combat/base-combat-allocation.ts 第 63 行
 *   明确「No Tank/Backline/other assignment-priority requirement is bound here」）。
 * - "When an opponent moves to a battlefield other than mine" 需要（a）object-moved
 *   时点的发射方（由事件管线的 action 适配器按 move-location 发出，但真实移动流程
 *   zones/movement 尚未接入事件管线）、（b）"对手"过滤（filter 的 controller 可以
 *   表达 opponent，触发扫描按控制者匹配）、（c）"other than mine" 的位置比较——
 *   需要在结算时把"我的战场"与事件载荷的目的地比较；已合入的 TriggerSpec 过滤只按
 *   对象特征/事件载荷字段匹配，没有"事件目的地 ≠ 来源当前位置"的形状。
 * 依赖：Tank 关键词展开与战斗伤害分配（combat 工作流）、移动时点接线与位置比较谓词。
 * filter 里的 `movedToOtherThanSourceLocation` 是**占位描述键**（与 yone-blademaster 的
 * `battlefieldWas`、grand-duelist 的 `becameMighty` 同款约定）：它标记缺口所在，
 * 已合入的触发匹配没有消费方，不构成可执行语义。
 * golden 测试真实执行 draw 指令。不近似实现（不把 Tank 写成静态数值、不把"other than mine"删掉）。
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
    "三处依赖未合入：（1）[Tank]（815）没有 KeywordDef 文件，且战斗伤害分配不读取分配" +
    "优先级要求——combat/base-combat-allocation.ts 明确未绑定 Tank/Backline 等要求" +
    "（815.1.b/815.1.c.2 因此无法执行）。（2）“When an opponent moves…”（383.1；" +
    "421.1/449.1 的 Move）需要移动流程把 move-location 接入事件管线的 object-moved 时点；" +
    "zones/movement 尚未接线。（3）“to a battlefield other than mine” 需要在触发判定时比较" +
    "事件目的地与来源当前位置：已合入的 TriggerSpec EventPattern 只按事件载荷字段与对象特征" +
    "匹配（trigger-spec.ts 的字段集），没有“目的地 ≠ 来源位置”的形状；程序中的 " +
    "movedToOtherThanSourceLocation 只是占位描述键（同 yone-blademaster 的 battlefieldWas），" +
    "没有消费方，不代表已实现语义。依赖：Tank 关键词与战斗分配（combat 工作流）、" +
    "移动时点接线、位置比较谓词。" +
    "[Shield 3] 按 814 只声明关键词与数值。golden 测试用 effect.draw 原语真实执行 draw 1。不近似实现。",
  abilities,
  sourceText:
    "[Shield 3] (+3 :rb_might: while I'm a defender.)\n" +
    "[Tank] (I must be assigned combat damage first.)\n" +
    "When an opponent moves to a battlefield other than mine, draw 1. (Bases are not battlefield.)"
} satisfies CardProgram;

export default program;
