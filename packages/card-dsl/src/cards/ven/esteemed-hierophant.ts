import type { CardProgram } from "../../ir/index.js";

/**
 * Esteemed Hierophant (ven-025-166) — Unit, 5 Energy（无印刷 Power），5 Might,
 * Calm, Shurima。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-025-166，逐字）：
 *   While you control 7 or more runes, prevent all damage that enemy spells and
 *   abilities would deal to me.
 *
 * 规则依据（CR v1.5）：
 * - 438.1 / 438.1.b / 438.2 / 438.7：Prevent 是减少某组对象将要受到的伤害的替代效果，
 *   而且是 Delayed Replacement Effect——在伤害动作执行前拦截并改写。
 * - 438.3.c：Prevent Value 为 “All” 时保持不变，即“prevent all damage”。
 * - “While you control 7 or more runes” 是持续效果的条件从句（363.2.a/383.2.b 的条件式持续
 *   能力）：条件为控制者符文区中的 Rune 数量 ≥ 7（133.5.a.1/431.1：已 channel 的 Rune 在
 *   控制者的 rune zone）。
 * - 418.6.b.2/418.6.b.3：来源是“敌方法术与能力”的伤害——需要区分伤害动作的施加者来源类型，
 *   这属于事件/动作层面的分类信息。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. replacement.prevent 尚未被替代 body planner 消费，当前程序无法把“prevent all”转成伤害事件的
 *    0 值改写；替代生命周期注册本身已经合入。
 * 2. 伤害来源分类不可判定：冻结的 damage GameAction 只有 { source, target, amount, combat }，
 *    “spell and ability damage” 与战斗伤害、与其它来源的伤害无从区分（438.1.b 的 source 定义），
 *    层 / 动作层面没有该判别式。
 * 3. 替代条件的 controller:self count 尚缺相对玩家归一化（RIFT-359）。
 * 条件形状（“7 or more runes”）本身绑定具体玩家后，用 condition.predicate 在 golden 中真实求值
 * （同已合入的 ven/sacred-protector 的做法）。
 */
export default {
  canonicalCardId: "card.hash-f580f1b022b337a29509e9df000540117dd9fd09ef728fb8fc82f34c6bfe8807",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺口：(1)「prevent all damage …」（438.1/438.1.b/438.2/438.3.c/438.7 的 Delayed Replacement Effect）" +
    "的 replacement.prevent body planner 尚未合入；" +
    "(2)「enemy spells and abilities」的来源分类不可判定——冻结的 damage GameAction 只有 " +
    "{ source, target, amount, combat }，缺少法术/能力伤害来源的分类与敌我过滤消费。" +
    "(3) 替代条件中 controller:self 的符文 count 尚缺相对玩家求值绑定（RIFT-359，133.5.a.1/431.1）。不近似实现。",
  abilities: [
    {
      // 438.7 / 契约 3.1 的 replacement 能力形状：拦截“敌方法术与能力对我造成的伤害”并全部预防。
      // 替代生命周期已合入；预防 body planner 与来源分类仍缺（见 judgeReason）。
      kind: "replacement",
      replaces: {
        event: "damage",
        filter: {
          // “to me”：被伤害的对象是能力宿主自身。
          target: "self",
          // “enemy spells and abilities”：伤害来源的分类判别式（描述性键；
          // 冻结的 damage 动作不带该信息，见 judgeReason 第 2 条）。
          sourceKind: ["spell", "ability"],
          controller: "opponent"
        }
      },
      // “While you control 7 or more runes”：持续窗口的条件从句（363.2.a、383.2.b）。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "runes-you-control",
          filter: { type: "rune", zone: "rune-zone", controller: "self" }
        },
        operator: "gte",
        right: { kind: "constant", value: 7 }
      },
      with: [
        {
          // 438.2/438.3.c：预防全部伤害（Prevent Value "All"）——把该伤害事件改写为 0。
          // 原语未合入（见 judgeReason 第 1 条）。
          id: "esteemed-hierophant.prevent-all-damage",
          op: "replacement.prevent",
          args: {
            amount: { kind: "constant", value: "all" }
          }
        }
      ]
    }
  ],
  sourceText:
    "While you control 7 or more runes, prevent all damage that enemy spells and abilities would deal to me."
} satisfies CardProgram;
