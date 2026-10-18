import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * entrenched-boar — Core Rules v1.5; see judgeReason for the current execution gaps.
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
        // ReplacementAbility 的声明形状只保留此占位；replacement.event 虽能登记
        // 可选替代，仍需把接受后的新入区身份与移动禁止绑定（见 judgeReason）。
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Have Entrenched Boar enter ready?" },
          body: {
            kind: "constant",
            value: [
              {
                // 入场状态改写：RIFT-260 的 replacement.enter 声明形式（369.3 / 805.6）。
                // 不是“先横置再就绪”的一次 effect.ready。
                id: "entrenched-boar.enter-ready",
                op: "replacement.enter",
                args: {
                  state: { kind: "constant", value: "ready" },
                  zone: { kind: "constant", value: "board" }
                }
              },
              {
                // “If you do, I can't move this turn.” — 持续移动禁止，由已合入的
                // continuous.restrict 注册（RIFT-259；契约 3.4 的 Restriction 族）。
                // Resolve an exact identity at execution; an object:self field
                // left inside a literal filter is not consumed by rule queries.
                id: "entrenched-boar.cannot-move",
                op: "continuous.restrict",
                args: {
                  restriction: { kind: "constant", value: "cannot-move" },
                  // "this turn" is the alias continuous.restrict resolves to the
                  // end-of-turn duration (317.2.c); "end-of-turn" is not an
                  // accepted alias for this op.
                  duration: { kind: "constant", value: "this-turn" },
                  appliesTo: {
                    kind: "object-property",
                    object: "self",
                    property: "ref"
                  }
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
    "CR 369.3 / 370.1.b.1 / 317.2.c：缺接受 optional 入场替代后，按新入区身份原子登记本回合 continuous.restrict 的事务。replacement/planner.ts 不能计划 choice.optional / continuous.restrict；replacement.event 的 args.instead 在 bind.ts 只读裸指令数组，与 IR 的 Expr 参数冲突，且可选声明未传入 ReplacementRegistration.optional。condition.predicate 不能代替接受替代与新身份的事务绑定；已有 replacement.enter 与移动限制消费不足以执行整张卡。",
  abilities,
  sourceText: "You may have me enter ready. If you do, I can't move this turn."
} satisfies CardProgram;

export default program;
