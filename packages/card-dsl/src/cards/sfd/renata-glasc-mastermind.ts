import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Renata Glasc, Mastermind (sfd-088-221) — Unit, 5 energy, 无印刷 Power, Might 4，
 * 领域 Mind，标签 Renata Glasc / Zaun / Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json sfd-088-221，逐字）：
 *   ":rb_energy_1::rb_rune_mind:: Draw 1.
 *    :rb_energy_4::rb_rune_mind::rb_rune_mind::rb_rune_mind::rb_rune_mind:, :rb_exhaust:: Score 1 point.
 *    Use my abilities only while I'm at a battlefield."
 *
 * 规则依据（Core Rules v1.5）：
 * - 377.1："："之前是费用、之后是效果，故两条都是 Activated Ability；单位可以有启动能力
 *   （145.1）。文本没有 [Action] / [Reaction]，按 381.1 使用控制者主阶段的默认 Action 时机，
 *   契约 3.1 用 activated.timing = "action" 声明。
 * - 415.5：末尾的 :rb_exhaust: 是费用「横置我」；404.1.a 把冒号前的能量与领域之力一并
 *   作为基础费用。
 *   - 第一条费用：1 Energy + 1 Mind Power（135.2.e 的具名领域符号）。
 *   - 第二条费用：4 Energy + 4 Mind Power + 横置我。4 个同名符文写成一条 amount 4 的
 *     Power 需求并限定 allowedDomains: ["Mind"]（对照已合入的 rad/hexplosives-expert 的
 *     allowedDomains 写法）。
 * - "Draw 1."：effect.draw（414.1/414.3），抽牌者缺省为能力控制者（190.6.d 的隐含 "you"）。
 * - "Score 1 point."：effect.score（194.1.c 的得点，470.1-3 的计分定义），受让者缺省为能力
 *   控制者；它不是 Scoring a Battlefield（470/471-472），不建立控制、不消耗战场计分窗口。
 * - "Use my abilities only while I'm at a battlefield."：377.2.b 规定这是**启动许可条件**
 *   （原文范例正是 Ultrasoft Poro 的同句），必须在启动前为真，而不是结算时的效果。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 两条能力的费用与效果都已用已合入形状写全（费用计划由 cost/ 消费、effect.draw 与
 *   effect.score 都是已注册原语），但「Use my abilities only while I'm at a battlefield」
 *   这条启动条件仍没有可执行路径：
 *   1. 位置类型谓词仍不可表达："I'm at a battlefield" 需要判断来源当前 Location 的类型是
 *      battlefield（107.1.b / 198.1）。冻结 Condition 的 compare 只能做既有两个 Expr 的比较，
 *      object-property(source, "location") 返回的是 Location 对象本身（比较结果不代表
 *      location.type），而 ObjectFilter 的 location/locationType 字段由原语自己消费、
 *      不是 Condition 词表的一部分（sfd/peak-guardian 记录同一缺口）。
 *   2. 生产绑定不再把 restriction 当纯数据：RIFT-257 的 programs/play.ts
 *      translateRestriction 已把 CardProgram 的 restriction 译成 ChainDraft.restrictions，
 *      chain/engine.ts Finalize 会对它求值（实测：Condition 形状的 restriction 会原样进入
 *      ChainDraft 并在 Finalize 被断言）。但本卡的 kind "use-only-while-at-battlefield"
 *      不是 Condition 词表成员，translateRestriction 会以 judge-required 拒绝
 *      （"restriction … kind use-only-while-at-battlefield needs a rules adapter"），
 *      因为缺少消费方：layers/rules 的 canAct() 是纯真值表，chain.canAct() 也不读图层许可。
 * - 因此整卡不宣称 executable；不把该条件改写成 body 里的恒真 condition，也不把两条能力
 *   合并成一条，golden 只对已支持的费用与效果做真实执行。
 * 依赖：位置类型谓词（Condition 词表扩展）与启动许可消费方（layers/rules 的 timing grant
 * 与 by-kind restriction 消费；RIFT-257/258 后仍缺）。
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      energy: { kind: "constant", value: 1 },
      payments: [
        { kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Mind"] }
      ]
    },
    // 377.2.b：启动许可条件（不是结算效果）；形状保留给待合入的启动检查，见 judgeReason。
    restriction: {
      kind: "use-only-while-at-battlefield",
      // 359.3.f.2：引用来源自身的位置信息，在执行（启动）时检查。
      source: "self"
    },
    body: [
      {
        id: "renata-glasc-mastermind.draw-1",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  },
  {
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      energy: { kind: "constant", value: 4 },
      payments: [
        // 4 个 Mind 符文：一条 amount 4 的 Power 需求，allowedDomains 限定 Mind。
        { kind: "power", amount: { kind: "constant", value: 4 }, allowedDomains: ["Mind"] },
        { kind: "exhaust", object: "self" }
      ]
    },
    restriction: {
      kind: "use-only-while-at-battlefield",
      source: "self"
    },
    body: [
      {
        id: "renata-glasc-mastermind.score-1",
        op: "effect.score",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-f5072242d7761ded012359feb98fcc8a89d7c3db8562a68ea71287fefa8f2141",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两条启动能力的费用与效果都已写全（1 Energy + 1 Mind Power → effect.draw；4 Energy + 4 Mind Power + " +
    "横置 → effect.score，404.1.a / 415.5 / 414.3 / 194.1.c），但「Use my abilities only while I'm at a battlefield」" +
    "（377.2.b 的启动许可条件，原文范例即 Ultrasoft Poro 同句）仍没有可执行路径：" +
    "(1) 位置类型谓词不可表达——判断来源当前 Location 类型是 battlefield（107.1.b/198.1）需要 Condition 能读 " +
    "location.type，冻结 Condition 的 compare 只能比较既有两个 Expr（object-property(source, \"location\") 返回 " +
    "Location 对象本身），而 ObjectFilter 的 location/locationType 由原语自己消费、不属于 Condition 词表" +
    "（sfd/peak-guardian 记录同一缺口）；" +
    "(2) 生产绑定已存在但只接 Condition——RIFT-257 的 programs/play.ts translateRestriction 会把 CardProgram 的 " +
    "restriction 译进 ChainDraft.restrictions 并由 chain/engine.ts Finalize 求值，但 kind " +
    "\"use-only-while-at-battlefield\" 不是 Condition 词表成员，translateRestriction 以 judge-required 拒绝" +
    "（\"restriction … kind use-only-while-at-battlefield needs a rules adapter\"）；启动许可也没有消费方：" +
    "layers/rules 的 canAct() 是纯真值表，chain.canAct() 不读图层许可。" +
    "不把该条件改写成 body 里的恒真 condition，也不合并两条能力。" +
    "依赖：位置类型谓词（Condition 词表扩展）与启动许可/按 kind 的 restriction 消费方（RIFT-257/258 后仍缺）。",
  abilities,
  sourceText:
    ":rb_energy_1::rb_rune_mind:: Draw 1.\n" +
    ":rb_energy_4::rb_rune_mind::rb_rune_mind::rb_rune_mind::rb_rune_mind:, :rb_exhaust:: Score 1 point.\n" +
    "Use my abilities only while I'm at a battlefield."
} satisfies CardProgram;

export default program;
