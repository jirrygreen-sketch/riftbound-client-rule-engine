import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Entrenched Boar (rad-026-167) — Unit, 2 energy, no printed Power, 2 Might, no domain.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-026-167）：
 *   You may have me enter ready. If you do, I can't move this turn.
 *
 * 规则依据（CR v1.5）：
 * - “You may have me enter ready.” 是入场状态改写（369.3 的官方示例 “Master Yi, Honed reads
 *   ‘I enter ready.’” 即把横置进场事件替换为就绪进场；单位默认横置进场见 143.4 / 359.2.c）；
 *   “you may” 是替代效果本身的可选决定（368.1 的 Passive Ability 作为 Replacement Effect）。
 * - “If you do, I can't move this turn.” 是被选取（接受替代）后的持续禁止：054 “Can’t beats
 *   Can”、亦见 144.1/144.2（Standard Move 的时机与费用）。“this turn” 的到期见 317.2.c
 *   （回合结束清理时所有 “this turn” 效果同时到期）。
 *
 * status = judge-required（见 judgeReason）：
 * 1. “enter ready” 需要卡牌 IR 可注册的入场替代管线（replacement.enter 家族）；effect.ready
 *    的文档明确它只重置已在场对象、不能模拟 enter ready（不经 “becomes ready” 事件）。
 * 2. IR 的 ReplacementAbility 没有 optional 字段：印刷的 “you may have me enter ready” 是
 *    替代效果本身的可选性，写进替代体内部会在玩家拒绝时仍然改写入场状态，语义错误
 *    （同 The Boss ogn-269-298 / Iron Ballista ogn-017-298 的判定）。
 * 3. “I can't move this turn” 需要持续移动禁止及其消费方：调研表把“不能 / 必须 / 仅可”
 *    归到 continuous.restrict，而该 op 没有已注册原语；没有已合入路径把 CardProgram 的
 *    static 能力注册成 ContinuousEffectSpec。
 * 依赖：RIFT-9（replacement.enter）、RIFT-91（layers-continuous）、RIFT-120（替代注册管线）。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    // “You may have me enter ready.” — 被替代事件是本单位横置进场（369.3 / 359.2.c）。
    replaces: { event: "object-enters-board", filter: { source: "self" } },
    with: [
      {
        id: "entrenched-boar.optional-enter-ready",
        // “You may …” 的可选性：按契约 3.9 用 choice.optional 把被选指令包进 body。
        // ⚠ IR 的 ReplacementAbility 没有 optional 字段，所以这里只能表达替代体内部的
        // 可选性（见 judgeReason (2)）；拒绝时应当完全不替代入场状态，而不是先替代再跳过。
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Have Entrenched Boar enter ready?" },
          body: {
            kind: "constant",
            value: [
              {
                // 入场状态改写（replacement.enter 家族，未合入）：不是“先横置再就绪”
                // 的一次 effect.ready。
                id: "entrenched-boar.enter-ready",
                op: "replacement.enter",
                args: {
                  state: { kind: "constant", value: "ready" },
                  zone: { kind: "constant", value: "board" }
                }
              },
              {
                // “If you do, I can't move this turn.” — 持续移动禁止（continuous.restrict，
                // 调研表第 3 节的“不能 / 必须 / 仅可”族），消费者的缺失见 judgeReason (3)。
                id: "entrenched-boar.cannot-move",
                op: "continuous.restrict",
                args: {
                  restriction: { kind: "constant", value: "cannot-move" },
                  duration: { kind: "constant", value: "end-of-turn" },
                  appliesTo: { kind: "constant", value: "self" }
                },
                linkedTo: "entrenched-boar.enter-ready"
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-83b3503583d3b1c2a4c954330e33aa17c188c4a97ab757da916900476485a9f4",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处依赖未合入：(1)「enter ready」是入场状态改写（CR 369.3 的官方示例即 “I enter ready.”；单位默认横置进场见 143.4/359.2.c），" +
    "需要卡牌 IR 可注册的入场替代管线（replacement.enter 家族，RIFT-9/RIFT-120）；effect.ready 只能重置已在场对象，不能模拟。" +
    "(2) 印刷的「You may …」是替代效果本身的可选决定，但 IR 的 ReplacementAbility 没有 optional 字段；" +
    "把可选性写进替代体内部（choice.optional）在玩家拒绝时仍会改写入场状态，语义错误，故只保留形状、不宣称可执行" +
    "（同 The Boss ogn-269-298 / Iron Ballista ogn-017-298）。" +
    "(3)「I can't move this turn」需要持续移动禁止（调研表把“不能 / 必须 / 仅可”归到 continuous.restrict；该 op 没有已注册原语），" +
    "并且没有已合入路径把 CardProgram 的 static 能力注册成 ContinuousEffectSpec（RIFT-91）。" +
    "依赖：RIFT-9（replacement.enter）、RIFT-91（layers-continuous）、RIFT-120（替代注册管线）。不近似实现。",
  abilities,
  sourceText: "You may have me enter ready. If you do, I can't move this turn."
} satisfies CardProgram;

export default program;
