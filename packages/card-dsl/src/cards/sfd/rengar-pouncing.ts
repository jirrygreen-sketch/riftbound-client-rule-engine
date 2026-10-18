import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Rengar, Pouncing (sfd-025-221) — Unit, Fury, Cat/Rengar/Ixtal/Champion.
 * energy 3, power 1 (Fury), Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-025-221，逐字，含换行）:
 *   "[Reaction] (Play any time, even before spells and abilities resolve, including to a battlefield you control.)\n"
 *   "[Assault 2] (+2 :rb_might: while I'm an attacker.)\n"
 *   "I can be played to a battlefield you're attacking."
 *
 * 规则依据（CR v1.5）:
 * - [Reaction]（813.1）：许可类关键词，只在卡文件里声明（契约 3.7）；其展开由
 *   effects/keywords/Reaction.ts 交给 continuous.timing 静态能力。
 * - [Assault 2]（807.1.b/807.1.c）：带数值的被动关键词，声明 `value: 2`；展开由
 *   effects/keywords/Assault.ts 负责，卡内不重写 +2 Might 逻辑。
 * - "I can be played to a battlefield you're attacking."：349/355.17.b 的打出位置
 *   许可——把「你正在攻击的战场」加入本单位的合法打出位置；同型已合入写法见
 *   sfd/dauntless-vanguard（"You may play me to an occupied enemy battlefield."），
 *   用 static + ContinuousEffect 表达（契约 3.1 的 play ability 只有 restriction，
 *   没有 permission 字段）。默认 static/Finalize 查询已存在；该描述性 kind 及「你正在攻击的战场」
 *   仍需攻击者与战场的关联谓词和具体位置适配。
 *
 * Current review (re-checked 2026-10-17):
 * CR v1.5 813.1: Reaction speed is derived by the program binder, and the
 * printed Fury payment plan is accepted by the chain (the reference TestWorld
 * retains the Power snapshot after its legacy `pay` action; the production pay
 * action settles real resources).
 * CR 807.1.c/.d.1: Assault 2 applies only while attacking. The merged expansion
 * gates on object-property(self, "designation"), and the merged static binder
 * evaluates that condition through evaluateCondition — but the base evaluator
 * (effects/interpreter/condition.ts -> expr.ts) has no "designation" property,
 * so the lookup throws MissingInformation and the binder's catch-all converts it
 * to false. The extended evaluator that maps designation to combatRole
 * (expr-ext/evaluate.ts) is not on the binder path, so a real attacker still
 * reads its printed Might. Measured: Might 3 with combatRole attacker.
 * CR 349/355.17.b: the last sentence grants a play destination. The declared
 * `play-location-permission` static kind is not a kind the production binder
 * supports ("Static ability kind play-location-permission has no layer
 * mapping"), and ChainEngine.playDestinationIsLegal only consumes the
 * continuous.location permission/restriction categories — it has no
 * attacking-player/battlefield predicate for a hand-zone permission.
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "reaction" },
  { kind: "keyword", keyword: "assault", value: 2 },
  {
    kind: "static",
    effect: {
      kind: "play-location-permission",
      value: {
        kind: "constant",
        value: {
          zone: "battlefield",
          battlefield: { attacking: true, controller: "controller" },
          appliesTo: "self"
        }
      },
      duration: "while-in-hand"
    }
  }
];

const program = {
  canonicalCardId: "card.hash-11c2deae61a7e5098515aef9a7b5595b0b6430fc0efebc22147404611ccebbc9",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处当前缺口，均不近似实现（复核 2026-10-17）：" +
    "(1)「I can be played to a battlefield you're attacking」缺 CR v1.5 349/355.17.b 的攻击方—战场打出位置许可：" +
    "play-location-permission 不是 createEngineStaticBinder 支持的静态 kind（实测 bindStatic 抛 \"Static ability kind play-location-permission has no layer mapping\"），" +
    "ChainEngine.playDestinationIsLegal 只消费 continuous.location 的 permission/restriction 类别（permissions/restrictions 均为空时直接放行），" +
    "既没有手牌许可的静态绑定，也没有「攻击方正在攻击的战场」谓词。" +
    "(2)[Assault 2]（807.1.c/.d.1）展开的 compare(object-property(self, 'designation')) 由默认 static binder 经 evaluateCondition 求值，" +
    "但基础求值器（effects/interpreter/condition.ts → expr.ts）没有 designation 属性，抛 MissingInformation 后被 binder 的 catch-all 当作 false；" +
    "把 designation 映射到 combatRole 的扩展求值器（expr-ext/evaluate.ts）不在该路径上，实测 attacker 仍保持印刷 Might 3，故还没有可执行的 attacker 判定。" +
    "已合入部分：Reaction 时机由 binder 推导并经真实 Closed Chain 验证；印刷 3 Energy/Fury 费用被链接受并执行领域分配" +
    "（参考 TestWorld 的 pay 动作不回写 Power 快照，生产 pay 动作真实结算资源）。" +
    "依赖：手牌打出位置许可的静态绑定与攻击方战场谓词/Finalize 接线、Assault 的 designation/combatRole 对齐。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve, including to a battlefield you control.)\n" +
    "[Assault 2] (+2 :rb_might: while I'm an attacker.)\n" +
    "I can be played to a battlefield you're attacking."
} satisfies CardProgram;

export default program;
