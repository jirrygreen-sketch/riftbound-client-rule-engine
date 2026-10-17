import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Nasus, Ascended (ven-046-166) — Unit, Calm, Dog/Shurima/Nasus/Champion.
 *
 * 原文：
 *   [Deflect 2] (Opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose
 *   me with a spell or ability.)
 *   [Empower] :rb_energy_8: (:rb_energy_8:: Empower me. Use only if not
 *   Empowered.)
 *   [Empowered][>] When I conquer, you score 1 point.
 *
 * 复核（RIFT-337）：Deflect 的 KeywordDef 已随 RIFT-84 合入，但 Empower / Empowered
 * 仍缺 KeywordDef（keywords/registry.generated.ts 的 26 个已注册关键词里没有它们），
 * 且 static → layers 的注册方与 target.tax 的卡牌接线仍未合入，见 judgeReason。
 *
 * 规则依据（Core Rules v1.5）：
 * - 809 Deflect：Passive Ability 关键词（809.1）；格式 "Deflect [X]"，X 是
 *   Deflect Value（809.1.b.2），省略时按 1（809.1.b.3）；809.1.c 功能上等价于
 *   "对手选择我时，其法术 / 能力的施放费用额外增加 X Power（任意域，809.1.c.1）"，
 *   属强制附加费用（809.1.d）。按契约 3.7 只声明
 *   { kind: "keyword", keyword: "deflect", value: 2 }，展开（target.tax 静态
 *   效果）由 effects/keywords/Deflect.ts 负责，卡牌不重写。
 * - 827 Empower：Activated Ability 关键词（827.1）；格式 "Empower [Cost]"
 *   （827.1.c），本卡费用为 8 Energy；827.1.c.1 功能上等价于
 *   "[8]: Empower this. Play only if not Empowered."（442 定义 Empower 动作；
 *   827.1.b.1 明确来源本身不是目标）。按契约 3.7 只声明关键词与印刷费用。
 * - 828 Empowered：Dependent Keyword（828.1）。"[Empowered][>]" 起至句末是
 *   Dependent Ability（828.1.b），其条件为"只要我拥有 Empowered 状态"
 *   （828.1.b.1/828.1.c）；本体能力按 727.1.b.1 仍然写在卡上，是否 Active 由
 *   关键词系统按条件判定，不是卡程序自己手写的门控。
 * - 383.4.c / 383.4.c.1 / 383.4.c.2.a："When I conquer" 是 Conquer Effect
 *   （触发式能力），在单位于战场在场且玩家因征服得分后进链；即使得分被替代，
 *   该触发仍然进链（383.4.c.2.c），所以本触发不以得分动作成功为条件。
 * - "you score 1 point" = effect.score（194.1.c 的得点与 470.1-3 的计分定义；
 *   已合入原语）。"you" 指能力控制者（190.6.d 的隐含指向），故不写 player，
 *   由原语缺省为 ctx.controller。
 *
 * 结构说明：
 * - Conquer Effect 用封闭时点枚举里的 "conquer"（events/timing-points.ts，
 *   ruleRefs 468.5.d/471.1/473.2.a）。
 * - filter 用契约 3.6 的符号选择器 { source: "self" } 指向能力来源，不写运行时
 *   ObjectRef，也不写死玩家 id。
 * - 本条依赖能力的 Empowered 门控（828.1.c）随关键词系统落地；本程序不平铺成
 *   无条件能力，只在 judgeReason 里登记缺口（见下）。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "deflect",
    value: 2
  },
  {
    kind: "keyword",
    keyword: "empower",
    value: 8
  },
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      filter: { event: "conquer", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "nasus-ascended.score",
        op: "effect.score",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-2df5544ffea6f698095320fc6fa4ee6de200fc1053c9c5737ca847fc57e18b35",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「[Empower] 8」与「[Empowered][>]」依赖尚未合入的关键词展开：effects/keywords/ 中没有 " +
    "Empower / Empowered 的 KeywordDef（827.1.c.1 的 cost.activated + effect.empower + " +
    "“Use only if not Empowered” 限制、828.1.c 的 Empowered 状态门控都无实现），ObjectSnapshot / " +
    "Condition 也没有 Empowered 谓词，RIFT-257 的 expandProgram 会以 “Keyword empower has no " +
    "executable KeywordDef” 拒绝（依赖新的 Empower/Empowered 关键词任务与 RIFT-87 条件/谓词）。" +
    "「[Deflect 2]」的 KeywordDef 已合入（effects/keywords/Deflect.ts，RIFT-84），但展开出的 static " +
    "target.tax 既没有图层消费者（layers/engine.ts 无该分支），也没有把它接到 target-plan 的 " +
    "Deflect 附加费上（RIFT-90 的 TargetTaxAdapter 只由调用方提供），且 static 效果进图层的注册方" +
    "（RIFT-257 的 binder 接线）仍未合入。" +
    "征服触发的 effect.score 原语已合入并单独可执行；不近似实现缺口的费用改写与状态门控。",
  abilities,
  sourceText:
    "[Deflect 2] (Opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "[Empower] :rb_energy_8: (:rb_energy_8:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] When I conquer, you score 1 point."
} satisfies CardProgram;
