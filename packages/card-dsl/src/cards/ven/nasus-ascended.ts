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
 * 复核：Deflect 与 Empower 的 KeywordDef 均已合入；印刷费用与目标税接线仍缺，见 judgeReason。
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
 * - Conquer Effect 的事件模式使用 "conquered"（events/trigger-spec.ts 的允许值），由
 *   pipeline-match.ts 映射到封闭的 conquer 时点（468.5.d/471.1/473.2.a）。
 * - filter 用契约 3.6 的符号选择器 { source: "self" } 指向能力来源，不写运行时
 *   ObjectRef，也不写死玩家 id。
 * - 本条依赖能力以 trigger.condition 读取 Empowered 状态（828.1.c），
 *   在触发扫描时检查，不在结算时重新检查（727.1.c.1.b）。
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
      filter: { event: "conquered", filter: { source: "self" } },
      condition: {
        kind: "compare",
        left: { kind: "object-property", object: "self", property: "empowered" },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
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
  judgeReason: "当前缺口：(1) Empower 的 KeywordDef 已合入，programs/keywords.ts 仍未传 params.cost，不能绑定印刷的 8 Energy 启动费用（827.1.c.1）。参考内核的 empowered 计数可被 compare 读取，但 ObjectSnapshot 契约尚未声明该特征；征服触发用该条件保留 828.1.c / 727.1.c.1 门槛。(2) Deflect 2 已展开为 target.tax，但 programs/statics.ts 没有该 kind 的映射；target/tax/collect.ts 的显式收集器尚未接入链的默认目标选择，chain/engine.ts 收到目标税后仍将其记为 Energy，未按 809.1.c.1 收取任意域 Power。(3) turn/flow.ts 的 conquer 生产只有 player / battlefieldId，没有单位 object；本卡 source:self 的 383.4.c 征服触发仍缺在场单位匹配接线。effect.score 本体已真实执行，不近似实现。",
  abilities,
  sourceText:
    "[Deflect 2] (Opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "[Empower] :rb_energy_8: (:rb_energy_8:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] When I conquer, you score 1 point."
} satisfies CardProgram;
