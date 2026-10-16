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
 * status = judge-required（缺口不近似实现）：
 * - [Ambush] 没有 KeywordDef（effects/keywords/ 下无 Ambush.ts），822.1.b/.c 的合法打出
 *   位置与 Reaction 许可没有展开实现；不能用 [Reaction] 关键词冒充（822.1.b 的 Reaction
 *   只在以 Ambush 方式打出的那一次成立，而 813.1.c 的 [Reaction] 是整张牌的常驻许可）。
 * - 关键词授予没有已注册原语：effects/instructions/ 下没有 continuous.grant-keyword
 *   （或 continuous.keyword）文件，也没有任何消费者把 CardProgram 的 static 能力注册进
 *   layers（registerContinuousEffect 无调用方），因此本条指令当前无法执行；授予后的 Assault
 *   展开还需 807.1.d 的 Attacker designation（不是 ObjectSnapshot 特征，契约 3.8 combatRole
 *   未进 HEAD）。
 *
 * 依赖：RIFT-84（kw-* 展开批次中的 Ambush）、RIFT-81 / RIFT-91（关键词授予与图层接线）、
 * 契约 3.8 的 combatRole 落地、RIFT-120（卡牌触发注册）。
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
        // 801.3.a 的关键词授予（带 end-of-turn 期限）；原语未注册，见 judgeReason。
        op: "continuous.grant-keyword",
        args: {
          keyword: { kind: "constant", value: "assault" },
          // 807.1.b.3：印刷省略数值 → Assault Value 1；不写 value 以免与缺省值冲突。
          duration: { kind: "constant", value: "end-of-turn" },
          // 355.10.d："your other units here" 是程序化集合、不是目标；集合锚点与
          // 排除自身写进 filter（355.9.c 的 "other"，053.3 的 "here"）。
          // args 里的值一律是 Expr（契约 3.2），filter 是 ObjectFilter 常量。
          filter: {
            kind: "constant",
            value: {
              zone: "board",
              type: "unit",
              controller: "self",
              exclude: "self",
              sameLocationAs: "self"
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
    "两处依赖未合入：(1) [Ambush]（822）没有已合入的 KeywordDef——effects/keywords/ 下无 Ambush.ts，" +
    "822.1.b/.c 的“可打到你有单位的战场”位置改写与仅在该次打出时成立的 Reaction 许可没有展开实现；" +
    "不能用 [Reaction] 关键词冒充（813.1.c 的 Reaction 是整张牌的常驻许可，与 822.1.b 的一次性许可不同）。" +
    "(2) 「give your other units here [Assault] this turn」需要卡牌侧的关键词授予原语与期限：" +
    "effects/instructions/ 下没有 continuous.grant-keyword / continuous.keyword 文件，也没有任何消费者把 " +
    "CardProgram 的 static 能力注册进 layers（registerContinuousEffect 无调用方），本条指令当前无法执行；" +
    "授予后的 Assault 展开还需要 807.1.d 的 Attacker designation，而它不是 ObjectSnapshot 特征" +
    "（契约 3.8 combatRole 未进 HEAD）。" +
    "依赖：RIFT-84（kw-* 展开批次中的 Ambush）、RIFT-81 / RIFT-91（关键词授予与图层接线）、" +
    "契约 3.8 的 combatRole 落地、RIFT-120（卡牌触发注册）。不近似实现。",
  abilities,
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "When you play me, give your other units here [Assault] this turn. " +
    "(+1 :rb_might: while they're attackers.)"
} satisfies CardProgram;
