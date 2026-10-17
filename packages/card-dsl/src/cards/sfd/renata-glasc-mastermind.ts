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
 * Current review:
 * CR v1.5 377.1 / 404.1.a / 415.5: two activated abilities pay the
 * printed Energy/Mind Power costs, with self-exhaust on the scoring ability.
 * CR 377.2.b requires the source to be at a battlefield when activating.
 * Condition restrictions reach Finalize; this location-type restriction still
 * needs an adapter. Draw, Score, and the printed cost plans remain independently
 * executable; the reference TestWorld records Power allocations in the payment
 * receipt even though its legacy `pay` action does not mutate the Power snapshot.
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
    "「Use my abilities only while I'm at a battlefield」仍缺 CR v1.5 377.2.b、107.1.b/198.1 的来源位置类型启动检查：translateRestriction 已能把 Condition 送入 ChainDraft，在 Finalize 检查；当前 use-only-while-at-battlefield 仍是未适配的描述性 kind。object-property(self, \"location\") 只返回整个 Location，没有读取 location.type 的表达式；不能用其它单位在场或结算期 body 条件代替本来源的启动许可。两条打印费用的 cost.modify/cost.pay 已能生成并校验 Energy、Mind Power 及横置计划；参考 TestWorld 的 pay 动作只不回写 Power 快照，但 payment receipt 已提供领域分配证据。依赖：来源位置类型谓词/启动检查适配；不把测试内核的资源投影差异误报为卡牌规则缺口。",
  abilities,
  sourceText:
    ":rb_energy_1::rb_rune_mind:: Draw 1.\n" +
    ":rb_energy_4::rb_rune_mind::rb_rune_mind::rb_rune_mind::rb_rune_mind:, :rb_exhaust:: Score 1 point.\n" +
    "Use my abilities only while I'm at a battlefield."
} satisfies CardProgram;

export default program;
