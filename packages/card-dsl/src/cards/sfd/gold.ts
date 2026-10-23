import type { CardProgram } from "../../ir/index.js";

/**
 * Gold (sfd-t03) — Gear token (Colorless, tag Token), no printed Energy / Power /
 * Might（本地 deck-catalog 为 energy:null / power:null / might:null，表示没有印刷值，
 * 本程序绝不改写成 0）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-t03，逐字）:
 *   Kill this, :rb_exhaust:: [Reaction] — [Add] :rb_rune_rainbow:.
 *   (Abilities that add resources can't be reacted to.)
 *
 * 规则依据（CR v1.5）：
 * - 377.1 / 404.1.a：冒号之前是启动能力的费用——"Kill this"（429.6 的 "Kill this, [cost]:"
 *   格式；429.2.a 说明从 Board 进入 Trash）加上 :rb_exhaust:（135.2.e.2 / 415.5
 *   "Exhaust this"）。费用管线（cost/plan-values.ts）支持 nonstandard 的 kill 与 exhaust。
 * - 357.2：非标准费用按控制者选择的顺序支付；golden 测试按发布的顺序
 *   payments: [{ kind: "exhaust" }, { kind: "kill" }] 真实支付（先横置、再消灭），
 *   并通过链上草稿（describeActivate）跑完真实支付回执。
 * - 813.1/813.1.c.2：能力上的 [Reaction] 是 Closed State 启动许可；IR 用
 *   activated.timing = "reaction" 声明（卡只声明自己的速度，契约 3.5）。
 * - 430.1/430.5：[Add] :rb_rune_rainbow: 是 1 点任意域（Universal）Power [A]
 *   （135.2.e.5 / 163.2.b）。括号里 "Abilities that add resources can't be reacted to"
 *   是 430.2.a 的说明文字（Add 能力 Finalize 后立即结算、不传递 Priority/Focus），
 *   不是另一条能力；430.3 允许带 Reaction 的 Add 在支付费用时启动。
 *
 * [A] 使用 RIFT-958 已合入的规范化 Universal Power 来源 "universal"。默认
 * describeActivate 将它识别为 Add，并立即走 CR 430.2.a/430.3；付费时该来源保持
 * Universal，由费用层用它支付命名域或 [A] 需求（135.2.e.5.b / 163.2.b）。
 */
const abilities = [
  {
    kind: "activated",
    // 813.1.c.2：“[Reaction] —” 是能力自身的 Closed State 启动许可。
    timing: "reaction",
    cost: {
      kind: "activated",
      // 377.1 / 429.6："Kill this, :rb_exhaust:" 是费用（先横置、再消灭；357.2 的顺序
      // 由控制者选择，这里以可审查的固定顺序声明并由 golden 真实支付）。
      payments: [
        { kind: "exhaust", object: "self" },
        { kind: "kill", object: "self" }
      ]
    },
    body: [
      {
        id: "gold.add-universal-power",
        // 430.1/430.5："[Add] :rb_rune_rainbow:." —— 1 点 [A]。使用契约的
        // 规范化 Universal 来源，绝不写成某个具体域。
        op: "effect.resources",
        args: {
          power: { kind: "constant", value: ["universal"] }
        }
      }
    ]
  }
] as const;

const program = {
  canonicalCardId:
    "card.hash-6249df4367d0a2e088c8eb1117ef59430f0d7dad4bf0fcf8a01d7f0415f4d511",
  rulesetVersion: "core-1.5" as const,
  status: "executable" as const,
  abilities,
  sourceText:
    "Kill this, :rb_exhaust:: [Reaction] — [Add] :rb_rune_rainbow:. " +
    "(Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;

export default program;
