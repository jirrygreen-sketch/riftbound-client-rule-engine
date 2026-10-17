import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Pickpocket (sfd-074-221) — Unit, Mind, Zaun.
 * energy 3, power: none printed, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-074-221，逐字）:
 *   "When you play me, you may kill a gear with Energy cost no more than :rb_energy_1:. If you do,
 *   play a Gold gear token exhausted."
 *
 * 规则依据（CR v1.5）:
 * - "When you play me"（383.4.a/420.4.a）：Play Effect，时点 card-played，{ source: "self" }。
 * - "you may kill a gear"（403.1、契约 3.9）：被选指令包进 choice.optional 的 body，不是
 *   choice + linkedTo。355.12 要求 may-action 的全部选择随该动作一并做出，因此 TargetSpec 挂在
 *   choice.optional 节点上随打出 Finalize 锁定（同已合入的 ogn/salvage、sfd/disarming-rake）。
 * - "a gear"（355.9.a.1：未特别说明时指 Board 上的对象）未限定友敌，355.10 的例外均不适用，
 *   故双方控制者的 gear 都合法（355.7 的目标选择）。消灭本体是 429 的 Active Kill，交给已合入的
 *   effect.kill。
 * - "with Energy cost no more than :rb_energy_1:"（206：费用判定用印刷/复制费用）是目标合法性
 *   限制（355.9.b 型的阈值限制），写在 TargetSpec.filter 上。
 * - "If you do, play a Gold gear token exhausted"：359.3.e.14.b 规定「If you do」直接引用前一条
 *   指令执行的游戏动作；"play ... exhausted" 是 440.2.c/185.2.a 的链上创建 + 打出流程，
 *   "exhausted" 是入场状态规定（184.1/185.2.d）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，三处依赖仍未合入，均不近似实现：
 * - 缺印刷费用上限谓词：冻结 ObjectFilter 没有费用键，已合入的过滤器（layers/filter.ts 的
 *   matchesObjectFilter 与测试内核 matchesFilter）只按 type/zone/controller/owner/tags 等匹配，
 *   未知键被静默忽略——把它当已实现会让 Pickpocket 能消灭任意费用的 gear（sfd/sandshifter 的
 *   mightLte 记录同一缺口）；206 的印刷费用读取与 355.9.b 的阈值限制属目标/图层批次（RIFT-90）。
 * - 「If you do」需要前一条消除动作的回执（359.3.e.14.b 的直接引用游戏动作条件，调研记为
 *   condition.result）：冻结 IR 没有该绑定，token 指令无法按 kill 实际发生开闸；不加恒真条件、
 *   也不把费用/动作改写成效果（linkedTo 的 ignored/negated 传播不区分「直接引用动作」，见
 *   interpreter README 的链接语义）。
 * - Gold gear token（CR 187.5：domainless gear token，自带 "[Reaction][>] Kill this, [E]: [Add] [A]"）
 *   仍不在 effect.token 的已实现定义表；虽然 mode: "play" 已支持链上创建 + 打出，
 *   Gold 的能力定义与 exhausted 入场规定尚未实现。
 * effect.kill 与 choice.optional 已合入并被 golden 真实执行（接受/拒绝/目标失效三分支）。
 * 依赖：RIFT-90（目标过滤的印刷费用谓词）、frozen IR 的 condition.result 动作回执契约缺口、
 * Gold 定义与入场状态（token 原语任务）。RIFT-257 触发绑定已合入，但 programs/filters.ts
 * 在注册时直接拒绝未知的 costEnergyLte 字段，因此该过滤不是可执行路径。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        id: "pickpocket.may-kill-gear",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Kill a gear with Energy cost 1 or less?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "pickpocket.kill-gear",
                op: "effect.kill",
                args: { target: { kind: "constant", value: "pickpocket.cheap-gear" } }
              },
              {
                // 440.2.c / 185.2.a：被表述为 "play" 的 token 先在链上创建再由打出流程接手；
                // 184.1/185.2.d："exhausted" 是入场状态规定，不是事后的 effect.exhaust。
                // 359.3.e.14.b 的「If you do」闸门缺失（见 judgeReason），故不加恒真条件。
                id: "pickpocket.play-gold-token",
                op: "effect.token",
                args: {
                  token: { kind: "constant", value: "gold" },
                  amount: { kind: "constant", value: 1 },
                  mode: { kind: "constant", value: "play" },
                  location: { kind: "constant", value: { type: "base", player: "controller" } },
                  entersExhausted: { kind: "constant", value: true },
                  linkKey: { kind: "constant", value: "goldToken" }
                }
              }
            ]
          }
        },
        targets: [
          {
            id: "pickpocket.cheap-gear",
            // costEnergyLte 是**描述性**的费用上限记录：没有已合入过滤器读取该键，
            // 不构成可执行限制（见 judgeReason），不得当作已实现。
            filter: { type: "gear", zone: "board", costEnergyLte: 1 },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-f3ac5fe953d58a49296d503b4ab1e9969bdcae7211e65966f5d4e0d68a8426ab",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处依赖仍未合入，均不近似实现：(1)「a gear with Energy cost no more than :rb_energy_1:」需要 206 的印刷费用上限比较作为目标合法性限制" +
    "（355.9.b 型阈值）：冻结 ObjectFilter 没有费用谓词，且 RIFT-257 的 programs/filters.ts 会在注册时直接拒绝未知的 " +
    "costEnergyLte 字段（Unsupported filter field），TargetSpec 也没有可执行的费用上限——" +
    "把它当已实现会让 Pickpocket 消灭任意费用的 gear（同 sfd/sandshifter 的 mightLte 缺口）。" +
    "(2)「If you do」是 359.3.e.14.b 的直接引用游戏动作条件（调研记为 condition.result）：冻结 IR 没有动作/费用回执绑定，" +
    "Gold token 指令无法按 kill 实际发生开闸；linkedTo 的传播不区分「直接引用动作」（negated 时仍会放行），故不伪造该闸门。" +
    "(3) Gold gear token（CR 187.5，自带 Reaction/Kill/[E]: [Add] [A] 能力）仍不在 effect.token 的已实现定义表；" +
    "mode: play 的链上创建 + 打出路径已合入，但 Gold 定义与 exhausted 入场状态仍不支持。effect.kill 与 choice.optional 已合入，" +
    "golden 用锁定目标真实执行 kill 半段。依赖：RIFT-90（目标过滤印刷费用谓词）、" +
    "frozen IR 的 condition.result 动作回执契约缺口、Gold 定义与入场状态（token 原语任务）；" +
    "RIFT-257 触发绑定已合入，但 filters.ts 对 costEnergyLte 直接报错关闭。",
  abilities,
  sourceText:
    "When you play me, you may kill a gear with Energy cost no more than :rb_energy_1:. " +
    "If you do, play a Gold gear token exhausted."
} satisfies CardProgram;

export default program;
