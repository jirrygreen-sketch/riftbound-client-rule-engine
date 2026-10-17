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
 * status = judge-required（README 第 2 节）：
 * - [A] 任意域 Power 在契约层仍不可表示：契约与内核的 Domain 是 Fury/Calm/Mind/Body/
 *   Chaos/Order 六域封闭集合（effects/contract.ts 的 Domain），effect.resources 的文件头
 *   明确记录 163.2.b 的 Universal Power 不可表达、绝不用某个域近似；本程序以描述性记号
 *   power: ["rainbow"] 保留印刷形状（原语对它返回 negated(impossible)，golden 锁定该负向证据），
 *   费用侧的 cost.pay 对该域同样抛 CostPlanError("invalid domain")，两条路径都不近似。
 * - 费用与时机两半可执行：kill + exhaust 的 nonstandard 支付、activated.timing =
 *   "reaction" 的声明、以及 430.3 的 Reaction Add 支付窗口都已合入；golden 经卡牌程序绑定
 *   describeActivate 真实执行费用计划与支付回执（含 token 进入 Trash）。
 * - 另外，Token 的 token 定义表（effect.token 的 frozen 定义）刻意不含 Gold
 *   （"definitions requiring other abilities, including Gold, remain blocked/judge-required"），
 *   因此“造出 Gold”的来源仍属该原语的既有缺口，与本卡自身的程序无关。
 *
 * 依赖：[A] 任意域 Power 的契约表示（契约变更请求：Domain 增补 Universal 或新增
 * gain-universal-power 动作）。本卡不近似实现。
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
        // 430.1/430.5："[Add] :rb_rune_rainbow:." —— 1 点 [A]。六域封闭集合下
        // 没有可执行值，保留描述性记号；绝不写成某个具体域。
        op: "effect.resources",
        args: {
          power: { kind: "constant", value: ["rainbow"] }
        }
      }
    ]
  }
] as const;

const program = {
  canonicalCardId:
    "card.hash-6249df4367d0a2e088c8eb1117ef59430f0d7dad4bf0fcf8a01d7f0415f4d511",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "唯一剩余缺口是任意域（Universal）Power [A] 的契约表示：[Add] :rb_rune_rainbow: 是 135.2.e.5 / 163.2.b 的 [A] Power，" +
    "但契约与内核的 Domain 是 Fury/Calm/Mind/Body/Chaos/Order 六域封闭集合（effects/contract.ts），" +
    "effect.resources 明确记录 Universal Power 不可表达、绝不近似成某个具体域；" +
    "本卡以 power: [\"rainbow\"] 保留记号，原语返回 negated(impossible)（effect.resources 的 isPower 只接受六域），" +
    "费用侧 cost/plan-values.ts 的 domains() 也对同一记号抛 CostPlanError(invalid-cost-plan)——golden 同时锁定这两条负向证据。" +
    "费用与时机两半不缺口：kill + exhaust 的 nonstandard 支付（377.1 / 415.5 / 429.6 / 357.2）与 " +
    "activated.timing = \"reaction\"（813.1.c.2）经卡牌程序绑定 describeActivate 真实执行（token 进入 Trash，" +
    "第二次启动以 cannot-pay-cost 失败）；430.3 的 Reaction Add 支付窗口由链侧 activateAddDuringPayment 提供。" +
    "另记：本地 effect.token 的 frozen 定义表刻意不含 Gold 装备 token（需其它能力的 token 一律 blocked/judge-required），" +
    "因此“造出 Gold”的来源仍属该原语的既有缺口，与本卡程序无关。" +
    "依赖：契约变更（Domain 增补 Universal 或新增 gain-universal-power 动作）。不近似实现。",
  abilities,
  sourceText:
    "Kill this, :rb_exhaust:: [Reaction] — [Add] :rb_rune_rainbow:. " +
    "(Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;

export default program;
