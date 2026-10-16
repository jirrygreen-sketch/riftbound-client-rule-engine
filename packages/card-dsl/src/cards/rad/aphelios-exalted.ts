import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Aphelios, Exalted (rad-179-167) — Unit, 4 energy + 1 Calm power, 4 Might。
 *
 * 原文（本地 deck-catalog，逐字；Choice 的三条指令连排，无空格）：
 *   "When you attach an Equipment to me, choose one that hasn't been chosen this turn —\n" +
 *   "Ready 2 runes.Channel 1 rune exhausted.[Buff] a friendly unit."
 *
 * 规则依据（CR v1.5）：
 * - "When you attach an Equipment to me"：Attach 动作完成后发出 object-attached
 *   （435.1 / 435.1.g / 435.3：成功附着到新的 Top-Most Card 才算；重复附着当前对象不发出）。
 * - "choose one that hasn't been chosen this turn —"：对三条指令作模式选择，并带"本回合未选过"
 *   的跨触发记忆（303 / 319 的选择记录；RIFT-9 调研为 rad-043-167 与 rad-179-167 规划的
 *   原语是 `choice.exclusive-once-per-turn`）。IR 的 `choice.mode`（契约 3.9）只保证单次结算内
 *   count=1 / different=true，不能承载本回合历史。
 * - "Ready 2 runes"：416.1 Readying 是非法术 Board 对象的状态动作；符文位于基地的 rune-zone
 *   （timing-points.ts 的 object-enters-rune-zone 说明）。
 * - "Channel 1 rune exhausted"：431.1（从符文牌库顶取符文放上 board）、431.2（效果可规定入场状态，
 *   "exhausted" 即其例证）、431.3（不足则尽量多）、431.5（格式 "Channel X rune(s)"）；
 *   effect.channel 原语已合入（amount 1 + exhausted true，与 sfd grand-duelist 同型）。
 * - "[Buff] a friendly unit"：427.1（把 Buff counter 放到单位上）、702.2.a、427.3（格式
 *   "Buff [one or more units]"）；effect.buff 的 buff 模式已合入。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。四处缺口：
 * 1. "hasn't been chosen this turn" 的跨触发选择记忆需要未注册的 choice.exclusive-once-per-turn
 *    （choice.mode 只有单次结算内的 different=true）；
 * 2. 模式选择发生在触发结算中，而 chain/engine.ts 的 assertFinalizationSurface 对
 *    choice.mode 直接抛 ChainContractBlockedError（"Mode choices require a Finalize/Resolve
 *    choice-plan adapter"），即生产链路还没有模式选择的接线；
 * 3. object-attached 的触发载荷不携带附着宿主（events/action-adapter.ts 的 attach 分支只填
 *    object = 被附着的装备），所以 "to me"（附着到本病源）无法在触发过滤里表达；
 * 4. "Ready 2 runes" 的 rune-zone 目标合法性在 Finalize 侧还需 target 系统对 rune-zone 的
 *    明确支持（355.9.a.1 说明 "rune" 默认指 Board 上的对象）。
 * 已合入的三条子指令（effect.ready / effect.channel / effect.buff）在 golden 测试里用解释器 +
 * 参考内核真实执行；不近似实现（不删"本回合未选过"限制、不把 rune 的 readying 写成其他动作）。
 */

const RUNES = "aphelios-exalted.runes";
const FRIENDLY_UNIT = "aphelios-exalted.friendly-unit";

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-attached",
      // 触发条件里的装备过滤（435.1 的 Attach 是 Equipment 附着的动作）。
      // "to me" 需要 object-attached 载荷携带宿主，当前 action-adapter 未提供（见 judgeReason）。
      filter: {
        event: "object-attached",
        object: { type: "gear", tags: ["Equipment"] }
      }
    },
    optional: false,
    body: [
      {
        id: "aphelios-exalted.choose",
        op: "choice.mode",
        args: {
          count: { kind: "constant", value: 1 },
          different: { kind: "constant", value: true },
          prompt: { kind: "constant", value: "Choose one that hasn't been chosen this turn." },
          // 本回合未选过的收据由 choice.exclusive-once-per-turn 承担（未注册，见 judgeReason）。
          modes: {
            kind: "constant",
            value: [
              {
                id: "aphelios-exalted.ready-mode",
                body: [
                  {
                    id: "aphelios-exalted.ready-2-runes",
                    op: "effect.ready",
                    args: {
                      objects: { kind: "constant", value: { kind: "target", id: RUNES } },
                      amount: { kind: "constant", value: 2 },
                      linkKey: { kind: "constant", value: "readiedRunes" }
                    },
                    targets: [
                      {
                        id: RUNES,
                        // 符文位于基地的 rune-zone（timing-points.ts 的 rune-zone 语义）。
                        filter: { type: "rune", controller: "controller", zone: "rune-zone" },
                        // "Ready 2 runes"：印刷数量固定为 2（355.9 / 355.8）；不是 "up to 2"。
                        min: 2,
                        max: 2,
                        selection: "any"
                      }
                    ]
                  }
                ]
              },
              {
                id: "aphelios-exalted.channel-mode",
                body: [
                  {
                    id: "aphelios-exalted.channel-1-exhausted",
                    op: "effect.channel",
                    args: {
                      amount: { kind: "constant", value: 1 },
                      exhausted: { kind: "constant", value: true }
                    }
                  }
                ]
              },
              {
                id: "aphelios-exalted.buff-mode",
                body: [
                  {
                    id: "aphelios-exalted.buff-friendly-unit",
                    op: "effect.buff",
                    args: {
                      mode: { kind: "constant", value: "buff" },
                      target: { kind: "constant", value: FRIENDLY_UNIT }
                    },
                    targets: [
                      {
                        id: FRIENDLY_UNIT,
                        filter: { type: "unit", controller: "controller", zone: "board" },
                        min: 1,
                        max: 1,
                        selection: "one"
                      }
                    ]
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-8e991cc75af9556291dd53b72f5d4d31cf399f8ee8e457c8eb20631bc18ff2d1",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "四处缺口：(1) 「choose one that hasn't been chosen this turn」需要跨触发的本回合选择记忆，" +
    "RIFT-9 调研为 rad-179-167 规划的 choice.exclusive-once-per-turn 未注册，choice.mode 只保证" +
    "单次结算内 different=true；(2) 模式选择在触发结算中执行，chain/engine.ts 的 assertFinalizationSurface " +
    "对 choice.mode 抛 ChainContractBlockedError（模式选择缺 Finalize/Resolve choice-plan 接线）；" +
    "(3) object-attached 载荷不带附着宿主，events/action-adapter.ts 只填 object=被附着的装备，" +
    "无法表达 「to me」；(4) 「Ready 2 runes」的 rune-zone 目标合法性（355.9.a.1 的 rune 默认指 Board 对象）" +
    "需要 target 系统对 rune-zone 的明确支持。依赖：choice.exclusive-once-per-turn（无已分配任务号，" +
    "RIFT-9 第 4 节新增原语）+ chain 模式选择接线（RIFT-120 后继）+ object-attached 载荷扩展" +
    "（契约变更请求）+ RIFT-90 target 系统。已合入的 effect.ready / effect.channel（431.2 exhausted）/ " +
    "effect.buff 三条子指令在 golden 测试中真实执行；不近似实现。",
  abilities,
  sourceText:
    "When you attach an Equipment to me, choose one that hasn't been chosen this turn —\n" +
    "Ready 2 runes.Channel 1 rune exhausted.[Buff] a friendly unit."
} satisfies CardProgram;

export default program;
