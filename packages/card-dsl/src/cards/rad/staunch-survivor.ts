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
 * status = judge-required：见 judgeReason —— Assault/Shield 的展开声明已合入
 * （RIFT-81），但本 worktree 仍缺「卡牌 keyword 能力 → KeywordDef 展开 → 图层注册」
 * 的生产方，且 807.1.d/814.1.d 的 Attacker/Defender designation（契约 3.8 的
 * ObjectSnapshot.combatRole）未进 HEAD，无法只在该身份下 +2 Might。
 */
const staunchSurvivor = {
  canonicalCardId:
    "card.hash-ef096ceda83997abf3d3e76dcd5774b08b5953e2f94e648a0d5942172d6eac39",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Assault/Shield 关键词的整卡可执行路径（CR 807.1.c/807.1.d.1、814.1.c/814.1.d.1）：" +
    "(1) 没有已合入的生产方把卡牌的 keyword 能力解析为 KeywordDef 展开（static continuous.might）并注册成 continuous 效果" +
    "（契约 3.5/3.7）：layers/engine.ts 的 registerContinuousEffect 当前没有任何调用方，" +
    "ResolveContext.addContinuous 只被原语调用、读不到卡牌程序的关键词能力；" +
    "(2) 807.1.d/814.1.d 的 Attacker/Defender designation 不是 ObjectSnapshot 特征" +
    "（契约 3.8 的 combatRole 增补仍未进 HEAD，对应 RIFT-105 分支）；" +
    "(3) layers/engine.ts 的 conditionMatches 只识别 always/never/type/has-tag/has-keyword，" +
    "未识别的 compare 条件按 true 处理，所以关键词展开里的 designation 条件在真实图层计算中恒真，" +
    "接线完成后两个 +2 都会被无条件套用、无法分别在攻击/防守时生效。" +
    "另：duel/assault-description-v1 与 duel/shield-description-v1 的整条能力匹配都要求纯单关键词文本，" +
    "本印刷是 Assault 与 Shield 合并提醒的复合文本，两条窄路径均判为 unknown；" +
    "combat/derived-might.ts 的 self-Assault/self-Shield 路径同样不覆盖该复合印刷，不能作为整卡执行证据。" +
    "依赖：RIFT-81（Assault/Shield 关键词展开，声明部分已合入）、RIFT-91（layers-continuous 条件求值与" +
    "卡牌接线）、契约 3.8 combatRole 落地。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "assault", value: 2 },
    { kind: "keyword", keyword: "shield", value: 2 }
  ],
  sourceText: "[Assault 2], [Shield 2] (+2 :rb_might: while I'm an attacker or defender.)"
} satisfies CardProgram;

export default staunchSurvivor;
