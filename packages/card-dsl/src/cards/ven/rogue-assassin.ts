import type { CardProgram } from "../../ir/index.js";

/**
 * Rogue Assassin (ven-139-166) — Legend, Fury/Calm, tag Akali.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-139-166，逐字）：
 *   [Empower] :rb_energy_3::rb_rune_rainbow: (:rb_energy_3::rb_rune_rainbow:: Empower
 *   this. Use only if not Empowered.)
 *   [Action][>] :rb_exhaust:: If it's your turn, move a friendly unit in a showdown
 *   to base and if I'm [Empowered], ready it.
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1.a / 827.1.c.1 / 827.1.b.1：[Empower] 是启动能力关键词，功能等价于
 *   「[费用]：Empower this。仅当未 Empowered 时启动」，且来源自身不是目标。
 * - 135.2.e.5.a / 163.2.b：(:rb_rune_rainbow:) 即 [A]，是任意域的 Power。
 * - 806.1.d / 135.2.e.7.b：[Action][>] 是修饰其后启动能力的许可关键词；契约 3.1 用
 *   activated.timing = "action" 记录（与 RIFT-238 的 Defender of Tomorrow 同写法）。
 * - 204.1.b / 415.5：「:」前的 :rb_exhaust: 是启动能力的 Base Cost（Exhaust 此来源）。
 * - 135.2.b.5.b：句首条件从句 “If it's your turn” 作用于同句后续所有指令，第二个条件
 *   “if I'm [Empowered]” 只作用于紧随其后的指令；本卡因此按契约 3.4 把整句包进
 *   sequence（your-turn 条件）→ [effect.move, effect.ready（Empowered 条件）]。
 * - 355.9 / 355.10 / 359.3.e.7：单个 “a friendly unit” 是被选目标，结算时目标失效则 ignored。
 *
 * status = judge-required（复核 2026-10-16；四处缺口均不近似实现）：
 * 1. 仍缺 [Empower] 关键词展开：effects/keywords/ 注册表当前没有 Empower KeywordDef，
 *    827.1.c.1 的启动费用与 “Use only if not Empowered” 限制都没有
 *    可执行展开；按 README 第 5 节本卡只声明关键词，不手写展开。印刷费用里的 [A] 也无法在
 *    六域封闭 Domain 集合中表达（163.2.b；effect.resources 已记录「绝不用某个域近似」）。
 * 2. 仍缺「If it's your turn」的回合归属谓词：Condition / Expr / TriggerSpec 都没有
 *    active-player / turn-owner 测试，程序里以描述性 expression 条件保留从句作用范围。
 * 3. 仍缺「if I'm [Empowered]」的状态谓词：契约的 ObjectSnapshot 不暴露 Empowered 状态
 *    （effect.empower 文档记录同一契约缺口），程序里以描述性 expression 条件保留。
 * 4. 仍缺「a friendly unit in a showdown」的目标维度：ObjectSnapshot 没有 showdown 字段，
 *    ObjectFilter 也没有该键（308.1、310.3–310.4 的 Showdown 是回合状态）；程序里用
 *    描述性键 inShowdown 记录，但 programs/filters.ts 的 translateObjectFilter 会以
 *    judge-required 拒绝未知键（fail closed，不静默放任成普通“战场上的单位”）。
 * 依赖：新增 Empower/Empowered 关键词任务、回合/状态谓词与 showdown 目标维度；
 * effect.move / effect.ready 本体已合入，golden 用真实解释器执行这两个子效果。
 */
const rogueAssassin = {
  canonicalCardId: "card.hash-bcd5741a34d7507d78f17972595d0f2b10828af242bd1268e24b552e6bb95ae3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口：(1) 缺 [Empower] KeywordDef——effects/keywords/ 注册表当前没有 Empower 展开，" +
    "827.1.c.1 的「3 能量 + 1 [A]：Empower this。仅当未 Empowered 时启动」" +
    "与 827.1.b.1 的「来源不是目标」都无执行路径；费用里的 :rb_rune_rainbow: 是任意域 Power [A]" +
    "（135.2.e.5.a、163.2.b），六域封闭 Domain 集合无法表达。" +
    "(2) 缺「If it's your turn」的回合归属谓词：Condition/Expr 没有 active-player / turn-owner 测试" +
    "（135.2.b.5.b 要求该从句作用于同句后续所有指令，程序用 sequence + 描述性 expression 条件保留范围）。" +
    "(3) 缺「if I'm [Empowered]」的状态谓词：契约的 ObjectSnapshot 不暴露 Empowered 状态" +
    "（effect.empower 文档记录同一契约缺口），程序以描述性 expression 条件保留。" +
    "(4) 「a friendly unit in a showdown」不可表达：Showdown 是回合状态（308.1、310.3–310.4），" +
    "ObjectSnapshot/ObjectFilter 都没有 showdown 键，programs/filters.ts 的 translateObjectFilter 会以 " +
    "judge-required 拒绝描述性键（fail closed，不静默当成普通战场单位）。" +
    "依赖新增 Empower/Empowered 关键词任务、回合/状态谓词与 showdown 目标维度；" +
    "effect.move / effect.ready 两个子效果已合入，golden 用真实解释器执行。不近似实现。",
  abilities: [
    // [Empower] :rb_energy_3::rb_rune_rainbow: —— 只声明关键词身份；印刷费用与
    // “Use only if not Empowered” 限制属于缺失的 Empower KeywordDef（827.1.c.1、契约 3.7）。
    { kind: "keyword", keyword: "empower" },
    {
      kind: "activated",
      // [Action][>]：能力级许可关键词（806.1.d）按契约 3.1 记录在 activated.timing。
      timing: "action",
      cost: {
        kind: "activated",
        // 「:rb_exhaust:」= Exhaust 此来源（204.1.b、415.5）。
        payments: [{ kind: "exhaust", object: "self" }]
      },
      body: [
        {
          id: "rogue-assassin.your-turn",
          op: "sequence",
          // 「If it's your turn」：135.2.b.5.b 的句首条件作用于同句后续所有指令，故用
          // sequence 包住两条指令（契约 3.4）；谓词本身尚未合入（见 judgeReason）。
          condition: {
            kind: "expression",
            value: { kind: "constant", value: "your-turn" }
          },
          args: {
            body: {
              kind: "constant",
              value: [
                {
                  id: "rogue-assassin.move",
                  op: "effect.move",
                  args: {
                    objects: {
                      kind: "constant",
                      value: { target: "rogue-assassin.unit" }
                    },
                    // 「move … to base」：Move 的目的地是该单位当前控制者的 Base
                    // （448.3、449.1；effect.move 的 controller-base 语义）。
                    to: { kind: "constant", value: "controller-base" },
                    amount: { kind: "constant", value: 1 },
                    linkKey: { kind: "constant", value: "moved" }
                  },
                  targets: [
                    {
                      id: "rogue-assassin.unit",
                      // 「a friendly unit」：type/zone/controller 是真实过滤字段；
                      // 「in a showdown」只能以描述性键 inShowdown 记录（见 judgeReason）。
                      filter: {
                        type: "unit",
                        zone: "board",
                        controller: "self",
                        inShowdown: true
                      },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                },
                {
                  id: "rogue-assassin.ready",
                  op: "effect.ready",
                  // 「and if I'm [Empowered], ready it」的 “it” 指前一条指令移动的那个单位：
                  // 依赖前序指令结果，因此声明 linkedTo（契约 3.2）；move 被忽略时它同样被
                  // 忽略（359.3.e.14.a），move 只是被否定时仍尽可能执行（359.3.e.14.b）。
                  linkedTo: "rogue-assassin.move",
                  // 「if I'm [Empowered], ready it」：第二个条件只作用于紧随其后的指令
                  // （135.2.b.5.b）；「it」是被移动的那个单位，经前一条指令的 moved
                  // 回执（{ count, objects }）读取（契约 3.6 的 linked 表达式）。
                  condition: {
                    kind: "expression",
                    value: { kind: "constant", value: "is-empowered" }
                  },
                  args: {
                    objects: {
                      kind: "linked-value",
                      instructionId: "rogue-assassin.move",
                      key: "moved"
                    }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Empower] :rb_energy_3::rb_rune_rainbow: (:rb_energy_3::rb_rune_rainbow:: Empower this. Use only if not Empowered.)\n" +
    "[Action][>] :rb_exhaust:: If it's your turn, move a friendly unit in a showdown to base and if I'm [Empowered], ready it."
} satisfies CardProgram;

export default rogueAssassin;
