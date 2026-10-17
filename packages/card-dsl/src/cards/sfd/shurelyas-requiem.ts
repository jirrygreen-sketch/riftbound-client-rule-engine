import type { CardProgram } from "../../ir/index.js";

/**
 * Shurelya's Requiem (sfd-192-221) — Gear, 4 Energy + 2 Power, Might 2
 * (Calm/Mind), tags Ornn / Equipment / Signature.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-192-221，逐字）:
 *   [Unique] (Your deck can have only 1 card with this name.)
 *   [Equip] :rb_rune_rainbow: (:rb_rune_rainbow:: Attach this to a unit you control.)
 *   When you play this, ready your units.
 *
 * 规则依据（CR v1.5）：
 * - 825.1/825.2/825.3：[Unique] 是 Deck Constraint Permission（同名每副牌组 1 张），
 *   825.4 明确本体游戏过程中没有额外效果。
 * - 818.1/818.1.b/818.1.b.1/818.1.c.2：[Equip] 是启动式能力关键词，功能等价于
 *   「[费用]：把此装备附着到你控制的一个单位」；印刷费用 1 点 :rb_rune_rainbow: 是
 *   135.2.e.5/163.2.b 的任意域（Universal）Power [A]。选择的单位是 Target（契约 3.6）。
 * - "When you play this, ready your units." 是打出效果（383.4.a.1/383.4.a.2："When you
 *   play this" 在该牌 Finalize 并进场后进链），在 card-played 时点用本卡身份过滤；
 *   "your units" 是 programmatic set（355.10.d："Ready all …" 不由玩家选择目标），
 *   因此指令不声明 TargetSpec，而用 effect.ready 的 `{ kind: "query", filter }` 形状
 *   读取当前控制者的场上单位；"ready" 是 416.1/416.1.c 的就绪动作（已合入 effect.ready）。
 *
 * status = judge-required（README 第 2 节；逐项列出缺口，不近似实现）：
 * - [Unique] 无已合入 KeywordDef，也没有 continuous.deck 消费方（effects/keywords/registry.generated.ts
 *   的 26 项不含 Unique；契约 3.1/3.3 没有构筑期限制的语义位置，只有未定义语义的
 *   deckbuilding?: DeckbuildingDecision[] 形状），卡内自造限制会发明语义。这同时是 §3.7 的
 *   展开级缺口：programs/keywords.ts 的 expandProgram 对未注册关键词直接抛
 *   ProgramBindingError（"Keyword unique has no executable KeywordDef"），整个程序的展开与
 *   触发注册都会停在这一条上（golden 实测），所以即使打出触发本身可执行也注册不了。
 * - [Equip] 的 [A] 任意域 Power 在契约层不可表示：契约与内核的 Domain 是六域封闭集合，
 *   effect.resources 明确记录 Universal Power 不可表达、绝不用某个域近似；本卡以描述性
 *   记号 costDomain: "rainbow" 记录印刷费用。
 * - [Equip] 的费用管线缺口：已合入的 Equip 展开声明 payments: [{ kind: "equip" }]，
 *   而 cost/plan-values.ts 的支付种类不含 equip（进行中的 RIFT-261），启动费用无法在 Finalize 支付。
 * - 打出触发的注册方已合入（RIFT-257，programs/triggers.ts）：把 [Unique] 声明移出后，
 *   绑定层能把 card-played 触发注册成 TriggerRegistration 并解析 object: { canonicalCardId }
 *   过滤（golden 实测），所以这一项不再独立构成缺口——触发注册只在 [Unique] 展开恢复后才谈得上。
 *
 * golden 测试真实执行已合入的触发本体（effect.ready 的 query 形状：就绪我方单位、
 * 不动对手单位）与 Equip 展开的 effect.attach 本体；其余缺口写成 test.todo。
 */
const abilities = [
  // 825.1：“[Unique]” 的构筑限制声明；KeywordId 对齐印刷名（小写）。
  { kind: "keyword", keyword: "unique" },
  // 818.1.c.2：费用 1 点 [A]。六域封闭集合无 Universal 值，costDomain 只作描述性记录。
  { kind: "keyword", keyword: "equip", value: 1, costDomain: "rainbow" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      // 383.4.a.1：“When you play this” 指本卡自身的打出事件（EventPattern.object）。
      filter: {
        event: "card-played",
        object: {
          canonicalCardId:
            "card.hash-d0752a11e22119fd9d027e757d45f90d57f3fb9dd7fb884daa19a97b0566dad3"
        }
      }
    },
    optional: false,
    body: [
      {
        id: "shurelyas-requiem.ready-units",
        op: "effect.ready",
        args: {
          // 355.10.d："your units" 是 programmatic set，不是目标选择；
          // 416.1/416.1.c 的就绪动作由已合入的 effect.ready 执行。
          objects: {
            kind: "constant",
            value: {
              kind: "query",
              filter: { type: "unit", controller: "self", zone: "board" }
            }
          }
        }
      }
    ]
  }
] as const;

const program = {
  canonicalCardId:
    "card.hash-d0752a11e22119fd9d027e757d45f90d57f3fb9dd7fb884daa19a97b0566dad3",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处缺口，均不近似实现：" +
    "（1）[Unique] 是 825.1/825.3 的 Deck Constraint Permission（825.4：本体无额外效果），但 effects/keywords/registry.generated.ts 的 26 项不含 Unique，" +
    "也没有 continuous.deck 消费方；契约 3.1/3.3 没有构筑期限制的语义位置（只有未定义语义的 deckbuilding?: DeckbuildingDecision[] 形状）。这也是展开级缺口：" +
    "programs/keywords.ts 的 expandProgram 对未注册关键词直接抛 ProgramBindingError（\"Keyword unique has no executable KeywordDef\"），整个程序的展开与触发注册都会停在" +
    "这一条上（golden 实测）。" +
    "（2）[Equip] 的印刷费用 :rb_rune_rainbow: 是 135.2.e.5/163.2.b 的 [A] 任意域（Universal）Power，" +
    "而契约与内核的 Domain 是 Fury/Calm/Mind/Body/Chaos/Order 六域封闭集合，effect.resources 明确记录 Universal Power 不可表达、绝不近似成某个具体域；" +
    "本卡以描述性记号 costDomain: \"rainbow\" 记录印刷费用。" +
    "（3）已合入的 Equip 展开声明 payments: [{ kind: \"equip\" }]，而 cost/plan-values.ts 的支付种类不含 equip，该启动费用目前无法在 Finalize 支付（进行中的 RIFT-261）。" +
    "（4）打出触发的注册方不再构成缺口：RIFT-257（programs/triggers.ts）已合入，把 [Unique] 声明移出后，绑定层能把 card-played 触发注册成 TriggerRegistration，" +
    "并原样解析 object: { canonicalCardId } 过滤（golden 实测）；触发体本身的语义（effect.ready 的 { kind: \"query\" } 集合形状，416.1/416.1.c）也已由 golden 真实执行。" +
    "依赖：关键词展开工作流（kw-unique，continuous.deck）、RIFT-261（费用支付种类）；[A] 属契约级缺口。",
  abilities,
  sourceText:
    "[Unique] (Your deck can have only 1 card with this name.)\n" +
    "[Equip] :rb_rune_rainbow: (:rb_rune_rainbow:: Attach this to a unit you control.)\n" +
    "When you play this, ready your units."
} satisfies CardProgram;

export default program;
