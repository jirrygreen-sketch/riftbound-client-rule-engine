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
 *   没有 permission 字段）。该静态效果的消费方（Finalize 的打出位置校验）尚未接线，
 *   且「你正在攻击的战场」需要攻击者与战场的关联谓词。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。RIFT-257 已提供关键词展开
 * （programs/keywords.ts expandProgram 调 KeywordDef.expand）与速度推导（abilitySpeed），
 * 但三个缺口都还在：
 * - [Reaction]：展开仍是 continuous.timing 静态能力，没有消费方把它注册进图层，
 *   chain.canAct()（契约 3.5 的唯一时机许可查询）只做真值表
 *   （layers/rules/query.ts canAct 需要调用方显式传 registry；chain/engine.ts 的 canAct
 *   不读任何图层许可），因此 closed-state 打出许可不生效；
 * - [Assault 2]：KeywordDef 与 Assault 展开已合入（RIFT-81），但 (a) 卡牌 keyword 能力要
 *   经 expandProgram 展开后才成为 static continuous.might，而生产路径没有把 
 *   CardProgram 展开结果注册进图层的消费方（static 绑定仍是 ProgramStaticBinder 回调，
 *   programs statics.ts 默认 noop）；(b) 展开的 condition 是
 *   compare(object-property(self, "designation") eq "attacker")，而 ObjectSnapshot 只有
 *   combatRole（契约 3.8）没有 designation 字段，layers/engine.ts 的 conditionMatches
 *   也不求值 compare（未知 kind 一律返回 true）——直接注册会无条件 +2 Might；
 * - 打出位置许可需要 static 消费方（Finalize 位置校验）与「你正在攻击的战场」谓词，
 *   现有 programs/filters.ts translateObjectFilter 会以 judge-required 拒绝 
 *   battlefield/attacking 这类字段。
 * 依赖：RIFT-81/85/91（关键词展开→图层注册消费）、链时机许可与 Finalize 位置校验接线、
 * 攻击者-战场谓词（designation/combatRole 落地）。不近似实现（不把许可写成 restriction，
 * 也不手改打出位置）。
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
    "[Reaction]（813.1）与 [Assault 2]（807.1.b/.c）的关键词展开都已合入，RIFT-257 的 programs/keywords.ts " +
    "expandProgram/abilitySpeed 也提供了从卡牌 keyword 到展开结果的路径，但仍无可执行消费方：" +
    "(1) [Reaction] 展开为 continuous.timing 静态能力，layers/rules 的 canAct() 需要调用方显式传入注册表，" +
    "chain.canAct()（契约 3.5 的唯一时机许可查询）不读图层许可，closed-state 打出许可不生效；" +
    "(2) [Assault 2] 展开为 static continuous.might + condition，但卡牌展开结果的图层注册消费方仍是 " +
    "ProgramStaticBinder 回调（programs/statics.ts 默认 noop，生产路径无调用者），且展开条件读 " +
    "object-property(self, \"designation\")（对象快照只有契约 3.8 的 combatRole），layers/engine.ts 的 conditionMatches " +
    "不求值 compare（未知 kind 返回 true），直接注册会无条件 +2 Might；" +
    "(3)「I can be played to a battlefield you're attacking」是 static 打出位置许可（349、355.17.b），" +
    "Finalize 位置校验的 static 消费方尚未接线，且「你正在攻击的战场」需要攻击者-战场关联谓词" +
    "（programs/filters.ts 对 battlefield/attacking 字段以 judge-required 拒绝）。" +
    "依赖：RIFT-81/85/91（关键词展开→图层注册消费）、链时机许可与 Finalize 位置校验接线、攻击者-战场谓词。" +
    "不近似实现（不把手牌许可写成 restriction，也不手改打出位置）。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve, including to a battlefield you control.)\n" +
    "[Assault 2] (+2 :rb_might: while I'm an attacker.)\n" +
    "I can be played to a battlefield you're attacking."
} satisfies CardProgram;

export default program;
