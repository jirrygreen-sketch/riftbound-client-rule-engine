import type { CardProgram } from "../../ir/index.js";

/**
 * Garen, Rugged (ogs-007-024) — Unit, 6 Energy, 1 Power (Body), 5 Might, Body,
 * Elite/Garen/Demacia/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogs-007-024）：
 *   [Assault 2], [Shield 2] (+2 :rb_might: while I'm an attacker or defender.)
 *
 * 规则依据（CR v1.5）：
 * - 807.1 / 807.1.a / 807.1.b.1-2：Assault 是被动能力关键词，印刷为 "Assault [X]"，
 *   此处的 X 是印刷值 2；807.1.c：功能上等于「当我是攻击者时 +2 [M]」；
 *   807.1.d / 807.1.d.1：攻击者 = 战斗中取得 Attacker designation（461 / 466.2.c.3），
 *   只在维持该 designation 期间生效。
 * - 814.1 / 814.1.a / 814.1.b.1-2：Shield 同样是被动能力关键词，X = 印刷值 2；
 *   814.1.c：功能上等于「当我是防守方时 +2 [M]」；814.1.d / 814.1.d.1：防守方 = 战斗中
 *   取得 Defender designation，只在维持该 designation 期间生效。
 * - 807.2 / 814.2：同名关键词多个来源的数值相加、合并为一个（stacking: sum，
 *   由关键词文件声明）；807.3 / 814.3：是否拥有该关键词是可被引用的特征。
 * - 原文的 "] (+2 :rb_might: while I'm an attacker or defender.)" 是同时覆盖两个关键词的
 *   合并提醒文本，不是第三个能力：Assault 2 与 Shield 2 各自在自己的 designation 条件下
 *   提供 +2（807.1.c / 814.1.c），卡牌按两个 keyword 能力声明，不合成单一数值。
 *
 * 卡牌只声明关键词（契约 3.1/3.7、README 第 5 节）；展开（static
 * continuous.might + designation 条件）由 effects/keywords/Assault.ts 与
 * effects/keywords/Shield.ts 负责，卡文件不重复实现，也不写单卡结算代码。
 *
 * status = judge-required（复核 2026-10-17）：见 judgeReason —— Assault.ts / Shield.ts
 * 的 KeywordDef 展开、卡牌程序静态绑定与 chain 生命周期都已合入，但展开所读的
 * designation 特征在 ObjectSnapshot 上不存在（只有 combatRole），而绑定后的静态注册
 * 也不求值 compare 条件：layers/engine.ts 的 conditionMatches 把未识别的条件当 true。
 * 缺一即不能宣称整卡可执行。
 */
const garenRugged = {
  canonicalCardId:
    "card.hash-4cb8d7a21af85e64b1351cadd5764e7d72532c46a93c2c85289c8c4351c33818",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Assault/Shield 的 KeywordDef 展开（effects/keywords/Assault.ts、Shield.ts：static continuous.might + " +
    "compare(object-property(self, 'designation'), eq, 'attacker'/'defender')）与卡牌程序静态绑定都已合入，" +
    "但合并内核仍缺两处执行路径：(1) 展开读的是对象属性 'designation'，ObjectSnapshot（契约 3.8）只有 combatRole，" +
    "求值直接抛 \"Unavailable characteristic: designation\"，programs/statics.ts 的 condition 包装捕获异常后 fail-closed，" +
    "所以攻击/防守期间都不会有 +2（golden 用真实 binder + 图层证明 5 Might 未变化）；" +
    "(2) 即便把特征换成 combatRole，layers/engine.ts 的 conditionMatches 也只识别 always/never/type/has-tag/has-keyword，" +
    "未识别的 compare 条件按 true 处理——golden 用真实图层注册证明防守时 +2 会被无条件套用（5 → 7），" +
    "无法分别只在攻击/防守时生效。另：本印刷是 Assault 与 Shield 合并提醒的复合文本，" +
    "duel/assault-description-v1 与 duel/shield-description-v1 的整条能力匹配都将其判为 unknown，" +
    "窄路径（combat/derived-might.ts）只覆盖它自有的指定语义、不消费本卡程序。" +
    "依赖：layers 的 compare 条件消费与 designation 特征暴露。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "assault", value: 2 },
    { kind: "keyword", keyword: "shield", value: 2 }
  ],
  sourceText: "[Assault 2], [Shield 2] (+2 :rb_might: while I'm an attacker or defender.)"
} satisfies CardProgram;

export default garenRugged;
