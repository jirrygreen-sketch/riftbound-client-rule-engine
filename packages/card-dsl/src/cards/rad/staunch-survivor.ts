import type { CardProgram } from "../../ir/index.js";

/**
 * Staunch Survivor (rad-088-167) — Unit, 2 Energy, 1 Power (Body), 2 Might, Body.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-088-167）：
 *   [Assault 2], [Shield 2] (+2 :rb_might: while I'm an attacker or defender.)
 *
 * 规则依据（CR v1.5）：
 * - 807.1 / 807.1.a：Assault 是被动能力关键词，出现在单位上；807.1.b / 807.1.b.1-2：
 *   印刷为 "Assault [X]"，此处的 X 是印刷值 2（Assault Value）；807.1.c：功能上等于
 *   「当我是攻击者时 +2 [M]」；807.1.d / 807.1.d.1：攻击者 = 战斗中取得 Attacker
 *   designation（461 / 466.2.c.3），只在维持该 designation 期间生效。
 * - 814.1 / 814.1.a：Shield 同样是被动能力关键词，出现在单位上；814.1.b / 814.1.b.1-2：
 *   X = 印刷值 2（Shield Value）；814.1.c：功能上等于「当我是防守方时 +2 [M]」；
 *   814.1.d / 814.1.d.1：防守方 = 战斗中取得 Defender designation，只在维持该
 *   designation 期间生效。
 * - 807.2 / 814.2：同名关键词多个来源的数值相加、合并为一个（stacking: "sum"，由
 *   关键词文件声明）；807.3 / 814.3：是否拥有该关键词是可被引用的特征。
 * - 原文中合并写的 "(+2 :rb_might: while I'm an attacker or defender.)" 是同时覆盖两个
 *   关键词的提醒文本，不是第三个能力：Assault 2 与 Shield 2 各自在自己的 designation
 *   条件下提供 +2（807.1.c / 814.1.c），卡牌按两个 keyword 能力声明，不合成单一数值。
 *
 * 卡牌只声明关键词（契约 3.1/3.7、README 第 5 节）；展开（static continuous.might +
 * designation 条件）由 effects/keywords/Assault.ts 与 effects/keywords/Shield.ts 负责，
 * 卡文件不重复实现，也不写单卡结算代码。
 *
 * status = judge-required：Assault/Shield 的 KeywordDef 展开与生产绑定链均已合入
 * （keywords/Assault.ts、keywords/Shield.ts 输出 static continuous.might + compare 条件；
 * programs/keywords.ts 的 expandProgram 经 keywordDefinitionsById 展开卡牌 keyword 能力，
 * lifecycle/statics 把展开注册进图层），但整卡仍无可执行路径：
 * - 展开里的 designation 条件在真实图层计算中不可求值：契约 3.8 已给 ObjectSnapshot 增加
 *   combatRole，但 Assault/Shield 条件读的是 object-property "designation"（快照没有该
 *   属性）。解释器求值实测抛 MissingInformation（Unavailable characteristic: designation），
 *   bindStaticToLayers 的条件包装捕获异常后恒返回 false，接线后两个 +2 永不生效；
 *   把判别式换成 combatRole 的 condition.predicate 在同一快照上实测 true，说明缺口只是
 *   属性名（该判别式属 engine-core 的 keywords 文件，范围外）。
 * 依赖：keywords/Assault.ts 与 keywords/Shield.ts 的 designation/combatRole 判别式修正；
 * 不近似实现。
 */
const staunchSurvivor = {
  canonicalCardId:
    "card.hash-ef096ceda83997abf3d3e76dcd5774b08b5953e2f94e648a0d5942172d6eac39",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Assault/Shield 关键词的整卡可执行路径（CR 807.1.c/807.1.d.1、814.1.c/814.1.d.1）仍缺一环：" +
    "KeywordDef 展开（static continuous.might）与卡牌程序绑定（programs/keywords.ts → lifecycle/statics）已合入，" +
    "但 807.1.d/814.1.d 的 Attacker/Defender 判别式读的是 object-property " +
    "\"designation\"，而合并的 ObjectSnapshot 只暴露 combatRole：解释器求值返回 MissingInformation，" +
    "bindStaticToLayers 的条件包装捕获异常后恒返回 false，两个 +2 永不生效、无法分别在攻击/防守时生效。" +
    "依赖：keywords/Assault.ts 与 keywords/Shield.ts 的 designation/combatRole 判别式修正（engine-core 范围外）；" +
    "不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "assault", value: 2 },
    { kind: "keyword", keyword: "shield", value: 2 }
  ],
  sourceText: "[Assault 2], [Shield 2] (+2 :rb_might: while I'm an attacker or defender.)"
} satisfies CardProgram;

export default staunchSurvivor;
