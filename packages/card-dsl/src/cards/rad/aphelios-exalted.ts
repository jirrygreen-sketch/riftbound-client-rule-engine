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
 * status = judge-required（2026-10-17 源码复核）：
 * - choice.mode 只有单次不同选项约束；缺跨触发的本回合模式收据，
 *   choice.exclusive-once-per-turn 未注册。
 * - object-attached 有真实动作生产者，但不在 EVENT_PATTERN_TYPES。
 * - 附着宿主已在事件 object.attachedTo 与 action.host 中保留；真正缺口是
 *   programs/filters.ts 不支持 attachedTo: self 的符号关系过滤，以及“you attach”归属。
 * - ChainEngine 的 Finalize 仍对 choice.mode 抛 ChainContractBlockedError。
 * 三种模式的原语、符文目标翻译和局部模式派发均已有执行证据。
 */

const RUNES = "aphelios-exalted.runes";
const FRIENDLY_UNIT = "aphelios-exalted.friendly-unit";

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-attached",
      // 触发条件里的装备过滤（435.1 的 Attach 是 Equipment 附着的动作）。
      // "to me" 的宿主已有 object.attachedTo，仍缺来源关系过滤（见 judgeReason）。
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
    "(1)「hasn't been chosen this turn」缺跨触发模式收据；choice.mode 的 different 仅约束单次选择，choice.exclusive-once-per-turn 未注册（CR 303 / 319）。" +
    "(2) object-attached 不在 EVENT_PATTERN_TYPES，无法订阅（435.1 / 435.3）。" +
    "(3) 附着宿主已有事件 object.attachedTo / action.host；缺的是 translateObjectFilter 对 attachedTo: self 的来源关系过滤及「you attach」归属绑定，不是宿主事实缺失。" +
    "(4) ChainEngine.assertFinalizationSurface 对 choice.mode 抛 ChainContractBlockedError，模式仍缺 Finalize/Resolve 选择计划适配。",
  abilities,
  sourceText:
    "When you attach an Equipment to me, choose one that hasn't been chosen this turn —\n" +
    "Ready 2 runes.Channel 1 rune exhausted.[Buff] a friendly unit."
} satisfies CardProgram;

export default program;
