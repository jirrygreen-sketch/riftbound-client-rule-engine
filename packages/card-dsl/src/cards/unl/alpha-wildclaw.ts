import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Alpha Wildclaw (unl-057-219) — Unit, 6 Energy + 2 Calm Power, Might 7，Calm，
 * tag Cat/Freljord。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-057-219，逐字，含换行）：
 *   [Tank] (I must be assigned combat damage first.)
 *   Your units here with less Might than me can't be chosen by enemy spells and abilities.
 *
 * 规则依据（CR v1.5）：
 * - 815.1 / 815.1.b/.c：印刷的 [Tank]，展开（continuous.combat 的分配优先级）由已合入的
 *   effects/keywords/Tank.ts 负责，卡牌只声明 keyword。
 * - 756 / 757 / 757.1 / 758："can't be chosen by enemy spells and abilities" 是声明
 *   对象 Untargetable 的被动能力；这类能力通常写作 "[Game Object] can't be chosen by
 *   [Category] spells and abilities"（757.1）。
 * - 355.9.b：Untargetable 的对象不是合法目标（758）；355.9.a.1/355.9.b 的"unit"指 Board 上
 *   的单位，"here" 是来源所在地点（359.3.f.1 的 referent）。
 * - 758.1 / 758.2 / 758.2.a：这类能力在结算时重新判定是否会失去可被指定（本卡的示例
 *   对象正是 Alpha Wildclaw/Vilemaw），即限制随 Might 与位置的动态变化生效。
 *
 * status = judge-required（缺口不近似实现）：
 * - continuous.restrict 的 static binder 与 rules query 已合入，但本卡的 filter 含
 *   source-relative `mightLt`；`programs/statics.ts` 目前拒绝该字段，因此这条
 *   Untargetable 限制还不能注册到 LayerEngine/target legality。
 * - "with less Might than me" 是候选单位与来源的**关系比较**（355.9.b 的 targeting restriction）：
 *   ObjectFilter/TargetSpec 的取值是静态数据，没有"与另一对象（来源）比较 Might"的写法，
 *   condition 从句只作用于整条指令、不能过滤选择集合的成员。程序用 mightLt 占位键记录
 *   该谓词（合并的匹配器不读该键——ogn/kadregrin-the-infernal、sfd/sandshifter 记录同一
 *   静默忽略行为），因此该过滤绝不能当作已求值语义。
 * - 依附缺口：[Tank]（815.1.c 的分配优先级）的消费方（战斗伤害分配）也未合入，故关键词声明
 *   也不能算整卡可执行。
 * golden 只做校验、结构断言与缺口 todo，不为任一缺口写执行用例。
 *
 * 依赖：source-relative Might 关系谓词与 static binder 支持（RIFT-359）、目标合法性判定对
 * Untargetable 的消费，以及战斗伤害分配批次。
 */

const abilities: Ability[] = [
  // 815.1：印刷的 [Tank]；卡只声明，不重写展开。
  { kind: "keyword", keyword: "tank" },
  {
    // 757 / 757.1：声明被保护对象的被指定限制（Untargetable）。
    kind: "static",
    effect: {
      kind: "continuous.restrict",
      operation: "choose-as-target",
      forbidden: true,
      // 758：被声明为 Untargetable 的对象不是合法目标。
      chooser: "opponent",
      appliesTo: "spells-and-abilities",
      filter: {
        // 355.9.a.1 / 355.9.b / 359.3.f.1："Your units here"。
        type: "unit",
        zone: "board",
        controller: "controller",
        sameLocationAs: "self",
        // "with less Might than me"：与来源的关系比较；合并的过滤器不读该键，
        // 这里仅作待接线的谓词名（见 judgeReason）。
        mightLt: { kind: "self" }
      }
    }
  }
];

export default {
  canonicalCardId:
    "card.hash-d607ab71a12af3a735123e958143ee249c28c5acdc5a7f29812a4e46de002d6f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：（1）『can't be chosen by enemy spells and abilities』是 756/757/757.1/758 的 Untargetable 被动能力：" +
    "continuous.restrict 的 static binder 与 rules query 已合入，但本卡 appliesTo: spells-and-abilities 不符合 staticTarget 的选择形状，filter 的 source-relative mightLt 也不受支持，" +
    "所以该限制还不能注册到 LayerEngine，也不能进入 target legality。" +
    "（2）『with less Might than me』是候选单位与来源的关系比较（355.9.b 的 targeting restriction）：" +
    "ObjectFilter/TargetSpec 的取值是静态数据，没有与另一对象（来源）比较 Might 的写法，" +
    "condition 从句只作用于整条指令、不能过滤选择集合成员；程序用 mightLt 占位键记录该谓词，" +
    "合并匹配器不读该键（ogn/kadregrin-the-infernal、sfd/sandshifter 记录同一静默忽略行为），绝不能当作已求值语义。" +
    "（3）[Tank]（815.1.c）的展开文件已合入，但战斗伤害分配的消费方尚未合入。" +
    "依赖：source-relative Might 关系谓词（RIFT-359）、向 rules query 的 actions/restriction 与敌方 chooser 语义转换、" +
    "以及战斗伤害分配批次。本卡所有效果都依赖上述缺口，golden 只做校验、结构断言与缺口 todo。",
  abilities,
  sourceText:
    "[Tank] (I must be assigned combat damage first.)\n" +
    "Your units here with less Might than me can't be chosen by enemy spells and abilities."
} satisfies CardProgram;
