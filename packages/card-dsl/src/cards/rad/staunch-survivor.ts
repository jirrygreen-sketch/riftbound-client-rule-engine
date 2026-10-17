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
 * status = judge-required：Assault/Shield 的 KeywordDef 展开已合入（keywords/Assault.ts、
 * keywords/Shield.ts 输出 static continuous.might + compare 条件），但整卡仍无可执行路径：
 * - 没有生产方把卡牌的 keyword 能力解析为 KeywordDef 展开并注册成 continuous 效果
 *   （契约 3.5/3.7）：layers/engine.ts 的 registerContinuousEffect 没有卡牌侧调用方
 *   （RIFT-257 卡牌程序绑定仍在进行），ResolveContext.addContinuous 只被指令原语调用。
 * - 展开里的 designation 条件在真实图层计算中不可求值：契约 3.8 已给 ObjectSnapshot 增加
 *   combatRole，但 Assault/Shield 条件读的是 object-property "designation"，而
 *   layers/engine.ts 的 conditionMatches 只识别 always/never/type/has-tag/has-keyword，
 *   未识别的 compare 条件按 true 处理，接线后两个 +2 会被无条件套用，无法分别在
 *   攻击/防守身份下生效（layers 条件求值缺口）。
 * 依赖：RIFT-257（卡牌关键词/静态能力绑定）与 layers 的 designation/combatRole 条件求值；
 * 不近似实现。
 */
const staunchSurvivor = {
  canonicalCardId:
    "card.hash-ef096ceda83997abf3d3e76dcd5774b08b5953e2f94e648a0d5942172d6eac39",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Assault/Shield 关键词的整卡可执行路径（CR 807.1.c/807.1.d.1、814.1.c/814.1.d.1）：" +
    "(1) 没有已合入的生产方把卡牌的 keyword 能力解析为 KeywordDef 展开（static continuous.might）并注册成 continuous 效果" +
    "（契约 3.5/3.7）：layers/engine.ts 的 registerContinuousEffect 没有卡牌侧调用方，" +
    "ResolveContext.addContinuous 只被指令原语调用、读不到卡牌程序的关键词能力（RIFT-257 仍在进行）；" +
    "(2) 807.1.d/814.1.d 的 Attacker/Defender designation 虽已按契约 3.8 进入 ObjectSnapshot.combatRole，" +
    "但 keywords/Assault.ts 与 keywords/Shield.ts 的展开条件读的是 object-property \"designation\"，" +
    "layers/engine.ts 的 conditionMatches 只识别 always/never/type/has-tag/has-keyword，未识别的 compare 条件按 true 处理，" +
    "所以接线完成后两个 +2 都会被无条件套用、无法分别在攻击/防守时生效。" +
    "依赖：RIFT-257（卡牌关键词→图层注册）与图层 designation/combatRole 条件求值；不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "assault", value: 2 },
    { kind: "keyword", keyword: "shield", value: 2 }
  ],
  sourceText: "[Assault 2], [Shield 2] (+2 :rb_might: while I'm an attacker or defender.)"
} satisfies CardProgram;

export default staunchSurvivor;
