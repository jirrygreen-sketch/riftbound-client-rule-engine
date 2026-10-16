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
 *   （the Boss / Detonation Amplifier 用 other: true 的同一写法）；"a gear" 由能力控制者
 *   选择，属 Target（355.7 / 355.9.a.1：未特别说明时 "gear" 指 Board 上的 gear）。
 *   已合入的 effect.empower 原语即该动作（它把【成为 Empowered 的对象】交给动作层与
 *   442.1.c 的"已 Empowered 时什么也不发生"处理）。
 * - 括号里的 "(It becomes Empowered if it's not already.)" 是 442.1.c 的提示文字，不构成
 *   第二条能力。
 *
 * status = judge-required（缺口在入场替代与触发的可执行路径，不近似实现）：
 * 1. "This enters exhausted" 需要入场替代的注册与执行：契约 3.1 的 replacement 能力是纯数据，
 *    已合入的 events/pipeline.ts 以 ReplacementRegistration（调用方提供 matches/apply 代码）
 *    注册替代，没有任何路径把 CardProgram 的 replacement 数据接进管线；也没有
 *    replacement.enter 这类面向卡牌 IR 的入场状态原语（同 ogn/iron-ballista、sfd/breakneck-mech
 *    的缺口，依赖 RIFT-120 后续）。
 * 2. 启动能力本身只用已合入结构（cost 的 exhaust 费用 + effect.empower 的 target 选择），
 *    但它的注册路径同样缺失（没有 CardProgram → chain/TriggerRegistration 的接线），
 *    所以整卡不标 executable；其 body 由 golden 以调用方提供的 Finalize 目标真实执行。
 */
const abilities: Ability[] = [
  {
    // 359.2.d 的"就绪入场"被替换为"横置入场"。replaces 指向本卡自己的入场事件
    // （369.3 的入场替代族）；with 里的 op 是契约 3.4/3.5 的替代族命名，当前无注册方。
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
            // "another"（740.1.a 的 friendly + other: true）：限本卡控制者控制的另一件 gear。
            filter: { type: "gear", controller: "self", zone: "board", other: true },
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
    "两处缺口，均不近似实现：(1) 『This enters exhausted』是入场状态替代（369.1/369.3；" +
    "359.2.d 让非单位 Gear 默认就绪入场）：已合入的 events/pipeline.ts 用 ReplacementRegistration" +
    "（调用方提供 matches/apply 代码）注册替代，没有任何路径把 CardProgram 的 replacement 数据接进管线，" +
    "也没有面向卡牌 IR 的入场状态原语；effect.exhaust 文档明确『入场即横置不是一次横置动作』" +
    "（先入场再补横置会多出一次成为横置事件并错过入场替代，对照 805.6），故不近似实现" +
    "（同 ogn/iron-ballista、sfd/breakneck-mech 的缺口，依赖 RIFT-120 后续）。" +
    "(2) 启动能力本体只用已合入结构（exhaust 费用 + effect.empower 的 target 选择，355.7/" +
    "355.9.a.1/442.1），但没有 CardProgram → chain 的注册接线，card-played/启动都不会从卡牌数据发生；" +
    "golden 以调用方提供的 Finalize 目标真实执行该 body。",
  abilities,
  sourceText:
    "This enters exhausted.\n" +
    ":rb_exhaust:: Empower another gear. (It becomes Empowered if it's not already.)"
} satisfies CardProgram;
