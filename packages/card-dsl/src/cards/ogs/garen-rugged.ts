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
 * status = judge-required（复核 2026-10-17/18）：见 judgeReason —— Assault.ts /
 * Shield.ts 的 KeywordDef 展开、expandProgram 的同名叠加（807.2/814.2）、卡牌程序
 * 静态绑定与 chain 生命周期都已合入且经 golden 实测；仍不能宣称整卡可执行的是两处
 * 已实测缺口：(1) 展开条件读的 designation 特征在 ObjectSnapshot（契约 3.8）上不存在，
 * 求值抛 MissingInformation 后被 programs/statics.ts fail-closed；(2) 战斗角色
 * designation 没有生产方（combat/flow.ts 抛 combat-start-transaction，CR 466.2）。
 * RIFT-711 的 expr-ext 已实现 designation→combatRole 读取，但按该模块 README 的集成
 * 边界，默认解释器与静态绑定尚未 dispatch；控制组 golden 证明字段对齐后同一生产路径
 * 立即给出印刷加成。不近似实现。
 */
const garenRugged = {
  canonicalCardId:
    "card.hash-4cb8d7a21af85e64b1351cadd5764e7d72532c46a93c2c85289c8c4351c33818",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "复核 2026-10-17/18（均为实测）：Assault/Shield 的 KeywordDef 展开（effects/keywords/Assault.ts、Shield.ts：" +
    "static continuous.might + compare(object-property(self, 'designation'), eq, ...)）、expandProgram 的同名叠加" +
    "（CR 807.2/814.2：印刷 + 授予来源相加，golden 实测 2+2 展开为单个 Assault 4）、卡牌静态绑定与图层求值路径" +
    "（programs/statics.ts 把 ability.condition 包成函数交给 layers/engine.ts 的 conditionMatches 求值）都已合入。" +
    "整卡仍不可执行，实测缺口两条：(1) 展开读的 designation 不在 ObjectSnapshot（契约 3.8 只有 combatRole），" +
    "求值抛 MissingInformation「Unavailable characteristic: designation」、binder fail-closed，真实攻击者快照 Might 仍 5" +
    "（golden 断言 registry 1 条、condition(snapshot)=false）；RIFT-711 的 expr-ext 已把 designation/object-designation" +
    "映射到 combatRole（evaluateExtendedExpression 实测 attacker/defender），但其 README 的集成边界写明默认解释器" +
    "（effects/interpreter/expr.ts）与 programs/statics.ts 尚未 dispatch 该扩展，生产条件路径拿不到映射；" +
    "把展开条件 property 改为 combatRole 的控制组在同一生产 binder 上攻击者 5→7、防守者/无角色保持 5（Shield 反之）。" +
    "(2) combat/flow.ts 的战斗角色事务仍抛 TurnCombatBlockedError('combat-start-transaction')（CR 466.2/807.1.d/814.1.d），" +
    "没有任何生产方写 combatRole，真实对局中「我是攻击者/防守者」不成立（RIFT-124 后续）。" +
    "另：本印刷是 Assault 与 Shield 合并提醒的复合文本，duel/assault-description-v1 与 duel/shield-description-v1 的整条能力匹配" +
    "都将其判为 unknown（ability-not-pure-assault / ability-not-pure-shield），combat/derived-might.ts 的窄路径只覆盖它自有的" +
    "指定语义、不消费本卡程序。（golden 里直接注册原始对象条件证明 layers/engine.ts 自身不求值未识别条件，但生产绑定总是发函数形态，" +
    "因此该形状不是本卡阻塞项。）依赖：expr-ext 到默认解释器/静态条件的 dispatch、战斗 designation 的生产方。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "assault", value: 2 },
    { kind: "keyword", keyword: "shield", value: 2 }
  ],
  sourceText: "[Assault 2], [Shield 2] (+2 :rb_might: while I'm an attacker or defender.)"
} satisfies CardProgram;

export default garenRugged;
