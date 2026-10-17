import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Lord Broadmane (unl-012-219) — Unit, 5 Energy + 1 Fury power, Might 5, Fury,
 * tag Noxus.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-012-219，逐字）：
 *   "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n"
 *   "When you play me, give your other units here [Assault] this turn. "
 *   "(+1 :rb_might: while they're attackers.)"
 *
 * 规则依据（CR v1.5）：
 * - [Ambush]（822）：822.1 是被动能力关键词；822.1.b 功能上等价于 "I may be played to a
 *   battlefield where you control Units" 与 "I have Reaction while being played this way"；
 *   822.1.c 说明它给单位的合法打出位置增加选项；822.2 多个实例冗余；822.4 这是可引用特征。
 * - "When you play me"：383.4.a 的 Play Effect（383.4.a.1 的 "When you play me…" 形式），
 *   在打出完成、永久物进场后进链（383.4.a.2），时点为 card-played 且事件对象是本卡。
 * - "give your other units here [Assault] this turn"：
 *   · "your other units" 是按特征程序化选定的集合（355.10.d：不是目标选择），"other"
 *     排除来源自身（355.9.c），"here" 是 053.3 的位置限定，用契约 3.6 的 sameLocationAs
 *     锚点指向来源；
 *   · 授予 [Assault]（807 的关键词实例，本例无数值时 Assault Value = 1）到本回合结束，
 *     属 ability 图层的持续关键词授予（801.3.a：其他效果可以授予关键词；801.3.a.2：
 *     授予方必须给出持续期限）。
 *   · "(+1 :rb_might: while they're attackers.)" 是授予后 Assault 的关键词展开结果
 *     （807.1.c），提醒文本本身不是第三条能力。
 *
 * status = judge-required（2026-10-17 按当前合入源码复核，缺口实测，不近似实现）：
 * 1. [Ambush] 的 KeywordDef 已合入，展开为 play-location-permission 与 conditional
 *    continuous.timing 两个静态声明；但 programs/statics.ts 的 layerFor 对
 *    play-location-permission 抛 "no layer mapping"，对第二条的 appliesTo: ["card"] 抛
 *    "Unsupported static appliesTo"（两条都实测）。Finalize 的 playDestinationIsLegal 只消费
 *    continuous.location 的 base/battlefield 类别限制，也没有 822.3 的条件战场复核。
 * 2. 「give your other units here [Assault] this turn」的授予本身已可执行：
 *    continuous.grant-keyword 接受 objects/query 选择形状并在 ability 图层登记，
 *    golden 用链适配器 + 图层引擎执行卡程序原始 body（other / here / end-of-turn 三个维度）。
 * 3. 授予后的 Assault 仍不是可执行语义：Assault.ts 展开的条件读宿主 "designation"，而
 *    ObjectSnapshot 提供的是 combatRole。programs/statics.ts 把条件包成 evaluateCondition 并
 *    在 MissingInformation 时返回 false，所以这次不会再把「仅攻击者 +1」误当成常驻 +1——
 *    但也意味着已声明 attacker 的单位同样拿不到 +1（实测打印 Might 3 的攻击者仍是 3）。
 * 依赖：play-location-permission 的静态图层/Finalize 接线（含 822.3 复核）与
 * designation/combatRole 的字段对齐。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "ambush" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      // 383.4.a.1："When you play me" 是本卡的 Play Effect。
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "lord-broadmane.grant-assault",
        // 801.3.a 的关键词授予（带 end-of-turn 期限），由已合入的 continuous.grant-keyword 执行。
        op: "continuous.grant-keyword",
        args: {
          keyword: { kind: "constant", value: "assault" },
          // 807.1.b.3：印刷省略数值 → Assault Value 1；不写 value 以免与缺省值冲突。
          duration: { kind: "constant", value: "end-of-turn" },
          // 355.10.d："your other units here" 是程序化集合、不是目标；集合锚点与
          // 排除自身写进 query 过滤（355.9.c 的 "other"，053.3 的 "here"）。
          // 合并原语的选择形状是 objects 描述符；裸 filter 会被当 Expr 求值而失败。
          objects: {
            kind: "constant",
            value: {
              kind: "query",
              filter: {
                zone: "board",
                type: "unit",
                controller: "self",
                exclude: "self",
                sameLocationAs: "self"
              }
            }
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-7fca30537894dafdae14a16780cb746b71b61799934fb26663599e56c55fe2bd",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现（2026-10-17 按当前合入源码实测）：" +
    "(1) [Ambush]（822.1.b/822.1.c）的 KeywordDef 已合入（effects/keywords/Ambush.ts），展开为 " +
    "play-location-permission 与 conditional continuous.timing 两条静态声明；但 programs/statics.ts 的 layerFor " +
    "对 play-location-permission 抛 \"no layer mapping\"，对第二条的 appliesTo: [\"card\"] 抛 \"Unsupported static appliesTo\"（两条都实测），" +
    "所以 Ambush 的条件战场范围与该次打出的 Reaction 许可都还没有绑定；Finalize 的 playDestinationIsLegal 只消费 " +
    "continuous.location 的 base/battlefield 类别限制，也没有 822.3 的即时复核。" +
    "(2) 「give your other units here [Assault] this turn」的 continuous.grant-keyword 已合入，" +
    "golden 用链适配器 + 图层引擎真实执行卡程序 body 并断言 only-other、here、end-of-turn 三个维度；" +
    "但授予后的 Assault 还不是可执行语义：Assault.ts 展开读宿主 \"designation\"（807.1.d），ObjectSnapshot 只有 combatRole（契约 3.8）；" +
    "programs/statics.ts 的静态绑定把条件包成 evaluateCondition 并在 MissingInformation 时返回 false，" +
    "所以不会再误判成常驻 +1，但已声明 attacker 的单位同样拿不到 +1（实测打印 Might 3 的攻击者仍是 3）。" +
    "依赖：play-location-permission 的静态图层/Finalize 接线（含 822.3 复核）与 designation/combatRole 对齐。",
  abilities,
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "When you play me, give your other units here [Assault] this turn. " +
    "(+1 :rb_might: while they're attackers.)"
} satisfies CardProgram;
