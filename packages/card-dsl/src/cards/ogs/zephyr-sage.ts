import type { CardProgram } from "../../ir/index.js";

/**
 * Zephyr Sage (ogs-005-024).
 * CR v1.5 814.1.b.3: omitted Shield value defaults to 1; 814.1.c/814.1.d.1:
 * the bonus applies only while maintaining the Defender designation.
 * The card declares only the keyword, with summed stacking per 814.2.
 *
 * status = judge-required（复核 2026-10-17/18，缺口已实测）：Shield 展开
 * （static continuous.might + compare(object-property(self, "designation"),
 * eq, "defender")）、814.2 叠加（与印刷 Shield 来源合并为单个值）与生产静态绑定
 * 均已合入。仍不能执行的两条实测缺口：(1) 展开条件读的 designation 不在
 * ObjectSnapshot（契约 3.8 只有 combatRole），生产 binder 求值时抛
 * MissingInformation 后 fail-closed，真实防守单位不吃 +1；RIFT-711 的 expr-ext
 * 已实现 designation→combatRole 读取，但按该模块 README 的集成边界，默认解释器
 * （effects/interpreter/expr.ts）与 programs/statics.ts 尚未 dispatch，生产条件路径
 * 拿不到映射。(2) combatRole 本身也没有战斗流程生产方：combat/flow.ts 的角色事务
 * 仍抛 combat-start-transaction（CR 466.2/814.1.d），真实对局中没有 Defender
 * designation。控制组 golden 证明字段对齐后同一生产路径在防守时给出 +1（6→7）。
 */
const zephyrSage = {
  canonicalCardId:
    "card.hash-2b68503e65fe0121f9346680649fa82fb83b4edc1e53b3a7416db4848ce941c6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "复核 2026-10-17/18（均为实测）：Shield 展开（effects/keywords/Shield.ts：static continuous.might + compare(object-property(self, 'designation'), eq, 'defender')）、" +
    "814.2 同名叠加（与印刷 Shield 来源合并为单值 1）与生产静态绑定均已合入，`combat/derived-might.ts` 的纯数据窄路径也确实为真实防守单位给出 +1，但该路径不消费本卡的 EffectIR 静态条件。" +
    "整卡仍不可执行，实测缺口两条：(1) 展开条件读的 designation 不在 ObjectSnapshot（契约 3.8 只有 combatRole），生产 binder 求值抛 MissingInformation「Unavailable characteristic: designation」后 fail-closed，" +
    "真实防守快照 Might 仍 6；RIFT-711 的 expr-ext 已把 designation/object-designation 映射到 combatRole（evaluateExtendedExpression 实测 defender/attacker/null），但其 README 的集成边界写明默认解释器（effects/interpreter/expr.ts）与 programs/statics.ts 尚未 dispatch 该扩展。" +
    "(2) combatRole 本身没有战斗流程生产方：combat/flow.ts 的角色事务仍抛 TurnCombatBlockedError('combat-start-transaction')（CR 466.2/814.1.d），真实对局中无 Defender designation（RIFT-124 后续）。" +
    "把展开条件 property 改为 combatRole 的控制组在同一生产 binder 上防守 6→7、攻击/无战斗保持 6。依赖：expr-ext 到默认解释器/静态条件的 dispatch、战斗 designation 的生产方。不近似实现。",
  abilities: [{ kind: "keyword", keyword: "shield" }],
  sourceText: "[Shield] (+1 :rb_might: while I'm a defender.)"
} satisfies CardProgram;

export default zephyrSage;
