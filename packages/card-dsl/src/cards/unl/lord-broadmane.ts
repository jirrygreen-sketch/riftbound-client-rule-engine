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
 * status = judge-required（按当前合入源码复核；缺口不近似实现）：
 * - [Ambush] 的 KeywordDef 已合入，展开为 play-location-permission 与
 *   continuous.timing 两个静态声明；通用 continuous.timing 的 actionTimings/canAct 查询已合入，
 *   但 Ambush 的条件战场范围仍未接入：Finalize 没有把 play-location-permission 转成地点合法性，
 *   static binder 也不能绑定带 appliesTo: ["card"] 和 location 条件的 continuous.timing。
 * - 「give your other units here [Assault] this turn」的授予本身已可执行：
 *   continuous.grant-keyword 接受 objects/query 选择形状并在 ability 图层登记，
 *   golden 用链适配器 + 图层引擎执行卡程序原始 body。
 * - 授予后的 Assault 不会变成 +1 Might：Assault.ts 展开的条件读 host 的 "designation" 特征，
 *   而 ObjectSnapshot 只提供 combatRole（契约 3.8），layers/engine.ts 的 conditionMatches
 *   不评估 compare 条件、未识别时按 true（exp22 实测：无指定也 +2），因此授予在没有攻击者
 *   判定的情况下不是可执行语义。
 * 依赖：Ambush 条件地点权限的 Finalize/static-binder 接线，以及图层 compare 条件与 designation/combatRole 对齐。
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
    "两处缺口，均不近似实现（已按当前合入源码复核）：" +
    "(1) [Ambush]（822.1.b/822.1.c）的 KeywordDef 已合入（effects/keywords/Ambush.ts），展开为 " +
    "play-location-permission 与 conditional continuous.timing 静态声明；通用 actionTimings/canAct 时机查询已合入，" +
    "但 Finalize 没有把 play-location-permission 转成地点合法性，static binder 也不能绑定 appliesTo: [\"card\"] " +
    "与 location 条件，所以 Ambush 的条件战场范围和该次打出的 Reaction 许可仍未闭合。" +
    "(2) 「give your other units here [Assault] this turn」的 continuous.grant-keyword 已合入，" +
    "golden 用链适配器 + 图层引擎真实执行卡程序 body 并断言 only-other、here、end-of-turn 三个维度；" +
    "但授予后的 Assault 还不是可执行语义：Assault.ts 展开读宿主 " +
    "\"designation\"（807.1.d），ObjectSnapshot 只有 combatRole（契约 3.8），且 layers/engine.ts 的 " +
    "conditionMatches 不评估 compare 条件、未识别时按 true（实测无指定也会 +2 Might），因此现在绑定会把 " +
    "「仅攻击者 +1」变成常驻 +1。" +
    "依赖：Ambush 条件地点权限的 Finalize/static-binder 接线，以及图层 compare 条件与 designation/combatRole 对齐。",
  abilities,
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "When you play me, give your other units here [Assault] this turn. " +
    "(+1 :rb_might: while they're attackers.)"
} satisfies CardProgram;
