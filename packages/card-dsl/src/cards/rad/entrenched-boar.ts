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
 * 1. 入场改写本身已可用：RIFT-260 合并了 replacement.enter 的绑定与执行
 *    （src/replacement/bind.ts 把声明改写成入场方向，本卡的 golden 用真实事件管线
 *    执行了“就绪进场、不产生 object-readied 时点”）。仍未解决的是印刷的
 *    “you may have me enter ready” 这一层可选性：IR 的 ReplacementAbility 没有 optional
 *    字段，而把 choice.optional 放进替代体会被替代规划器拒绝
 *    （BlockedReplacementError: Unsupported replacement opcode: choice.optional），
 *    该决定必须在替代登记层作出（RIFT-257 卡牌程序绑定）。
 * 2. “I can't move this turn” 用已合入的 continuous.restrict 注册（RIFT-259）；
 *    但移动系统仍不消费它：layers/rules/query.ts 的 movement() 只读 movement 效果的
 *    restrictions，registered 的 kind "restriction" 记录只有 restrictions() 能列出，
 *    没有任何 Move/Recall 合法性检查读取该视图，也没有 CardProgram static 能力的
 *    注册接线（RIFT-257）。
 * 依赖：RIFT-257（卡牌程序绑定：替代层可选项与 static 注册）。
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
                // 作用对象写成连续的属性过滤（objectId 之外的锚点由过滤器校验），
                // 消费者的缺失见 judgeReason (2)。
                id: "entrenched-boar.cannot-move",
                op: "continuous.restrict",
                args: {
                  restriction: { kind: "constant", value: "cannot-move" },
                  // "this turn" is the alias continuous.restrict resolves to the
                  // end-of-turn duration (317.2.c); "end-of-turn" is not an
                  // accepted alias for this op.
                  duration: { kind: "constant", value: "this-turn" },
                  appliesTo: {
                    kind: "constant",
                    value: { type: "unit", object: "self" }
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
    "两处缺口，均不近似实现：" +
    "(1) 印刷的「You may have me enter ready」是替代效果本身的可选决定（368.1 的 Passive Ability 作为 Replacement Effect），" +
    "但 IR 的 ReplacementAbility 没有 optional 字段，把 choice.optional 包进替代体会被替代规划器拒绝" +
    "（src/replacement/planner.ts 只支持 effect.ready/exhaust/move/zone/damage/draw/heal/resources/buff/counter），" +
    "必须由替代登记层作出该决定；依赖 RIFT-257 卡牌程序绑定。" +
    "（入场改写本身已可执行：replacement.enter 的绑定（RIFT-260）在 golden 测试中真实执行就绪进场，" +
    "且不产生 object-readied 时点，符合 805.6.a。）" +
    "(2)「I can't move this turn」已用 continuous.restrict 注册（RIFT-259），但移动系统没有消费方：" +
    "layers/rules/query.ts 的 movement() 只读取 movement 效果的 restrictions 列表，kind \"restriction\" 的记录只有 restrictions() 能列出，" +
    "没有任何 Move 合法性检查读取它，也没有 CardProgram static 能力的图层注册接线（RIFT-257）。" +
    "依赖：RIFT-257。不近似实现（不用先横置再 ready，也不用 Buff/Damage 代替禁止）。",
  abilities,
  sourceText: "You may have me enter ready. If you do, I can't move this turn."
} satisfies CardProgram;

export default program;
