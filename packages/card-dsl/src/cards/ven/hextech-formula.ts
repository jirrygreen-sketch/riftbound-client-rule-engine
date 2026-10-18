import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Hextech Formula (ven-062-166) — Gear, 2 Energy, power null (no printed
 * Power), Might null (no printed Might), Mind, no tags.
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json, ven-062-166）：
 *   "This enters exhausted.\n"
 *   ":rb_exhaust:: Empower another gear. (It becomes Empowered if it's not already.)"
 *
 * 规则依据（CR v1.5）：
 * - 359.2.d / 149.1：非单位 Gear 默认以就绪状态进入 Board；"This enters exhausted."
 *   改写的是入场状态，因此属入场替代（369.1 的 would/as 族与 369.3 的"描述单位如何
 *   入场"族；契约 3.5 把替代放在动作执行之前）。effect.exhaust 的文件头明确"入场即横置
 *   是入场状态规定，不是一次横置动作"：先入场再补 effect.exhaust 会多出一次"成为横置"
 *   事件并错过入场替代（805.6 的 Accelerate 是同一路径），所以不能用它近似。
 * - 151 / 151.2：第二行是 Gear 的启动能力，可在控制者的 Main Phase 执行；415.5 的
 *   Exhaust 是该能力的启动费用。
 * - 442.1 / 442.2："Empower another gear" 是 Empower 动作（Limited Action，442.3 / 442.3.a）；
 *   740.1.a 的 friendly 与本卡的 "another" 一起限定为"控制者控制的、除本卡以外的 gear"
 *   （用契约 3.6 的 exclude: "self" 锚点表达）；"a gear" 由能力控制者
 *   选择，属 Target（355.7 / 355.9.a.1：未特别说明时 "gear" 指 Board 上的 gear）。
 *   已合入的 effect.empower 原语即该动作（它把【成为 Empowered 的对象】交给动作层与
 *   442.1.c 的"已 Empowered 时什么也不发生"处理）。
 * - 括号里的 "(It becomes Empowered if it's not already.)" 是 442.1.c 的提示文字，不构成
 *   第二条能力。
 *
 * status = judge-required（缺口只剩目标过滤的排除锚点，不近似实现）：
 * 复核（2026-10-17，实测见 test.mjs 的 probe 用例）：
 * 1. "This enters exhausted" 的入场替代已可执行：replacement.enter 原语与生产绑定链
 *    （programs/index.ts 的 createProgramBinding、programs/statics.ts 的
 *    createEngineStaticBinder → replacement/bind.ts）已合入，golden 用真实绑定复刻
 *    ogn/iron-ballista 的入场替代链路（链上 → Board 入场即横置）。
 * 2. 启动能力的生产绑定路径已可产出 ChainDraft（programs/activate.ts），effect.empower
 *    原语与 442.1.c 的"已 Empowered 时什么也不发生"由动作层真实执行；golden 用真实
 *    解释器执行"横置自身并 Empower 另一个 gear"。
 * 3. 剩余缺口："another gear" 的 exclude: "self" 排除锚点（740.1.a）还没有生产消费方：
 *    实测 programs/filters.ts 的 translateObjectFilter 对 exclude 抛 ProgramBindingError
 *    （code "judge-required"，message "Unsupported filter field exclude"），生产绑定因此
 *    fail-closed；目标查询的 layers/filter.ts matchesObjectFilter 也不消费该锚点，无法排除
 *    来源自身。"a gear" 是 355.7/355.9.a.1 的 Target，缺排除锚点即缺整个启动能力，故整卡
 *    不标 executable（契约变更请求：目标过滤 exclude 锚点的生产翻译与目标查询消费）。
 */
const abilities: Ability[] = [
  {
    // 359.2.d 的"就绪入场"被替换为"横置入场"。replaces 指向本卡自己的入场事件
    // （369.3 的入场替代族）；with 里的 op 由 replacement/bind.ts 消费。
    kind: "replacement",
    replaces: {
      event: "object-enters-board",
      filter: { source: "self" }
    },
    with: [
      {
        // "This enters exhausted."——入场状态改写，不是一次横置动作。
        id: "hextech-formula.enter-exhausted",
        op: "replacement.enter",
        args: {
          state: { kind: "constant", value: "exhausted" },
          zone: { kind: "constant", value: "board" }
        }
      }
    ]
  },
  {
    // 151/151.2：Gear 的启动能力，Action 时机。
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      // 415.5：横置自身是该启动能力的费用（对象是能力来源）。
      payments: [{ kind: "exhaust", object: "self" }]
    },
    body: [
      {
        // 442.1/442.2："Empower another gear"——能力控制者的另一个 gear 是目标
        // （355.7/355.9.a.1），effect.empower 的 target 选择即该动作。
        // "already Empowered 时什么也不发生"（442.1.c）由动作层拥有，本卡不重复实现。
        id: "hextech-formula.empower-another-gear",
        op: "effect.empower",
        args: {
          objects: {
            kind: "constant",
            value: { kind: "target", id: "hextech-formula.other-gear" }
          }
        },
        targets: [
          {
            id: "hextech-formula.other-gear",
            // "another"（740.1.a）：用契约 3.6 的 exclude: "self" 限定为另一件 gear。
            filter: { type: "gear", controller: "self", zone: "board", exclude: "self" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-abc384da043315415efa41d8d39f0cf4edbb77f2cbf021c4b7871cdf8732d768",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "入场替代与启动绑定的可执行路径已合入：replacement.enter 原语与生产绑定链" +
    "（createProgramBinding / createEngineStaticBinder → replacement/bind.ts）用真实绑定执行" +
    "『This enters exhausted』（369.1/369.3，359.2.d 默认就绪被改写为横置入场，不是一次横置动作）；" +
    "effect.empower 原语与 442.1.c 的『已 Empowered 时什么也不发生』由动作层真实执行。" +
    "剩余缺口（2026-10-17 复核实测）：『another gear』的 exclude: \"self\" 排除锚点（740.1.a）" +
    "没有生产消费方——programs/filters.ts translateObjectFilter 对 exclude 抛 ProgramBindingError" +
    "（judge-required，\"Unsupported filter field exclude\"），生产绑定 fail-closed；" +
    "layers/filter.ts matchesObjectFilter 也不消费该锚点，无法排除来源自身。『a gear』是 Target" +
    "（355.7/355.9.a.1），缺排除锚点即缺整个启动能力，故整卡保持 judge-required；契约变更请求：" +
    "ObjectFilter 的 exclude 排除锚点需接入生产 translateObjectFilter 与目标查询。" +
    "不近似实现（不把『another』近似成『a gear』，也不在卡内伪造来源排除）。",
  abilities,
  sourceText:
    "This enters exhausted.\n" +
    ":rb_exhaust:: Empower another gear. (It becomes Empowered if it's not already.)"
} satisfies CardProgram;
