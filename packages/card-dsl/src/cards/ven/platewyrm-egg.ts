import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Platewyrm Egg (ven-075-166) — Gear, 3 Energy, no printed Power, no Might,
 * Body, no tags.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-075-166，逐字）：
 *   "This enters exhausted.
 *    [Empower] — :rb_energy_1:, :rb_exhaust: (Pay the cost: Empower this. Use only if not Empowered.)
 *    [Reaction][>] :rb_exhaust:: [Add] :rb_energy_1:. If this is [Empowered], [Add] :rb_energy_2: instead."
 *
 * 规则依据（Core Rules v1.5）：
 * - 149.1 / 359.2.d：非单位 Gear 默认就绪进场；"This enters exhausted." 是入场状态改写，
 *   属替代族（369.3 的 "as … enters" 写法；effect.exhaust 的文件头明确入场横置不是一次
 *   横置动作，先入场再补 effect.exhaust 会多出一次"成为横置"事件并错过入场替代）。
 * - 827.1.c / 827.1.c.1 / 827.1.c.2：Empower 是启动式能力关键词，功能等价于
 *   "[费用]：Empower this. 仅当未 Empowered 时启动"；费用可含资源费用与非资源费用，
 *   本卡印刷费用为 1 Energy + 横置来源（415.5，"In abilities, the Exhaust symbol
 *   represents the cost 'Exhaust this'"）。827.1.b.1：来源本身不是目标。
 * - 813.1.c.2 / 813.1.d："[Reaction][>]" 是写在能力上的 Reaction 许可，把该启动能力的
 *   时机放宽到 Closed State；契约 3.1 用 activated.timing = "reaction" 记录。
 * - 430.1 / 430.2 / 430.5：[Add] 把资源放进 Rune Pool；启动式 Add 能力 finalize 后立即
 *   结算、不传 Priority/Focus（该时序归链引擎），:rb_energy_1: 即"加 1 Energy"。
 * - 828.1 / 828.1.b / 828.1.b.1 / 828.1.c："If this is [Empowered] … instead" 是
 *   Empowered 状态门控的替换分支：本卡按 Empowered 状态在 1 Energy 与 2 Energy 之间二选一。
 *
 * status = judge-required（复核 2026-10-17；缺口均不近似实现）：
 * 1. replacement.enter 原语与绑定路径已合入（src/replacement/bind.ts，
 *    处理 ready|exhausted 入场状态并拦截 chain→(base|battlefield) 的入场 move），golden 用
 *    bindReplacement + 链引擎全链路执行「This enters exhausted.」。
 * 2. 没有 Empower/Empowered KeywordDef：effects/keywords/registry.generated.ts 没有
 *    "empower"/"empowered" 展开（RIFT-81~88 关键词批次不含），827.1.c.1 的启动费用与
 *    "仅当未 Empowered 时启动"限制、828.1.c 的状态门控都无实现路径。
 * 3. "If this is [Empowered], [Add] 2 instead" 的二选一（instead）没有已合入的运行时分支
 *    形态：契约 3.4 的条件从句只作用于所在的那条指令，可用的分支形状 choice.mode 被
 *    chain/engine.ts 的 assertFinalizationSurface 显式阻断（"Mode choices require a
 *    Finalize/Resolve choice-plan adapter"），且 Empowered 谓词本身未接通。
 * 可执行部分：effect.resources 的 Add 1 / Add 2 Energy 本体（430.1/430.2/430.5）已合入，
 * golden 用真实解释器分别执行两个分支并断言互斥分支不静默加资源。
 * 依赖：新的 Empower/Empowered KeywordDef、Empowered 谓词与 instead 分支运行时接线。
 */
const abilities: Ability[] = [
  {
    // "This enters exhausted." — 入场状态改写，不是一次横置动作（369.3、149.1/359.2.d）。
    // replacement.enter 原语与注册路径已合入（RIFT-257 批次），执行证据见 judgeReason。
    kind: "replacement",
    replaces: { event: "object-enters-board", filter: { source: "self" } },
    with: [
      {
        id: "platewyrm-egg.enter-exhausted",
        op: "replacement.enter",
        args: {
          state: { kind: "constant", value: "exhausted" },
          zone: { kind: "constant", value: "board" }
        }
      }
    ]
  },
  {
    // 827.1.c：印刷费用是 1 Energy + 横置来源；只声明关键词身份，展开归关键词注册表。
    kind: "keyword",
    keyword: "empower",
    value: 1
  },
  {
    kind: "activated",
    // "[Reaction][>]"：能力级许可关键词（813.1.c.2/813.1.d），契约 3.1 记在 timing。
    timing: "reaction",
    // ":rb_exhaust::" — 横置来源作为启动费用（415.3.a/415.5）。
    cost: { kind: "activated", payments: [{ kind: "exhaust", object: "self" }] },
    body: [
      {
        id: "platewyrm-egg.add-1",
        // "[Add] :rb_energy_1:" — 加 1 Energy（430.1/430.2/430.5），接收者缺省为控制者。
        op: "effect.resources",
        args: { energy: { kind: "constant", value: 1 } }
      },
      {
        // "If this is [Empowered], [Add] :rb_energy_2: instead." — Empowered 门控的替换分支。
        // 分支形状与 Empowered 谓词都未合入（见 judgeReason 第 3 条），条件读取缺失的
        // Empowered 状态谓词，不近似实现：不无条件多加 2 Energy，也不把 instead 丢掉。
        id: "platewyrm-egg.add-2-instead",
        op: "effect.resources",
        args: { energy: { kind: "constant", value: 2 } },
        condition: {
          kind: "expression",
          value: { kind: "constant", value: "is-empowered" }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-5d0ab54108afb25c366527426f6c46a04e21256d6701bc128d66dd9ce8860f37",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1)「This enters exhausted.」是入场状态改写（369.3、149.1/359.2.d）；" +
    "replacement.enter 原语与注册路径（src/replacement/bind.ts）已合入，golden 已用 " +
    "bindReplacement + 链引擎真实执行 chain→base 入场并被改写为 exhausted；(2) 缺 Empower/Empowered " +
    "KeywordDef：keywords/registry.generated.ts 没有 \"empower\"/\"empowered\" 展开（RIFT-81~88 关键词批次不含），" +
    "827.1.c.1 的「1 Energy + 横置：Empower this，仅当未 Empowered 时启动」（415.5）与 828.1.c 的状态门控无执行路径；" +
    "(3)「If this is [Empowered], [Add] :rb_energy_2: instead」是 Empowered 状态门控的替换分支：" +
    "契约 3.4 的条件从句只作用于所在指令，可用的 choice.mode 被 chain/engine.ts 的 assertFinalizationSurface 显式阻断" +
    "（\"Mode choices require a Finalize/Resolve choice-plan adapter\"），Empowered 谓词亦未接通。" +
    "可执行部分：effect.resources 的 Add 1 / Add 2 Energy（430.1/430.2/430.5）由 golden 用真实解释器执行，" +
    "未 Empowered 状态下不会静默多加资源。依赖：新的 Empower/Empowered KeywordDef、Empowered 谓词与 instead 分支运行时接线。",
  abilities,
  sourceText:
    "This enters exhausted.\n" +
    "[Empower] — :rb_energy_1:, :rb_exhaust: (Pay the cost: Empower this. Use only if not Empowered.)\n" +
    "[Reaction][>] :rb_exhaust:: [Add] :rb_energy_1:. If this is [Empowered], [Add] :rb_energy_2: instead."
} satisfies CardProgram;
