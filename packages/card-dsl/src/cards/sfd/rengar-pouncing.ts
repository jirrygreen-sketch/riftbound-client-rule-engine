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
 * Current review:
 * CR v1.5 813.1: Reaction speed is derived by the program binder.
 * CR 807.1.c/.d.1: Assault 2 applies only while attacking; the current keyword
 * expansion still reads designation instead of combatRole.
 * CR 349/355.17.b: the last sentence grants a play destination, requiring an
 * attacking-player/battlefield predicate rather than a restriction or a Move.
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
    "「I can be played to a battlefield you're attacking」缺 CR v1.5 349/355.17.b 的攻击方—战场打出位置许可：play-location-permission 不是 createEngineStaticBinder 支持的静态 kind，ChainEngine.playDestinationIsLegal 目前只消费 continuous.location 的 base/battlefield 类别限制，未按具体战场与攻击方校验手牌许可。[Assault 2]（807.1.c/.d.1）的展开条件仍读取 designation，而 ObjectSnapshot 提供 combatRole；默认 static binder 已能求值 compare，但该字段缺失会使条件不成立。Reaction 时机已有真实 Closed Chain 查询证据；完整打出支付还受 effects/testing/test-kernel.ts 的 pay 未消费 Power 所阻，Fury 扣除断言保留为 TODO。依赖：攻击方战场谓词/手牌许可与 Finalize 接线、Assault 的 designation/combatRole 对齐及 Power 支付执行载体。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve, including to a battlefield you control.)\n" +
    "[Assault 2] (+2 :rb_might: while I'm an attacker.)\n" +
    "I can be played to a battlefield you're attacking."
} satisfies CardProgram;

export default program;
