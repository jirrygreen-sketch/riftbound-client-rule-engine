import type { CardProgram } from "../../ir/index.js";

/**
 * Lacerate (ven-127-166) — Spell, 2 energy + 1 Order power, no tags.
 * Might null（法术无印刷 Might）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-127-166，逐字）:
 *   "Choose a unit. If it's [Empowered], disempower it. Then kill it if it has 3 :rb_might: or less.\n"
 *   "[Flow] :rb_energy_4::rb_rune_order::rb_rune_order: (You may play this from your trash for its Flow cost. Then banish it.)"
 *
 * 规则依据（CR v1.5）：
 * - "Choose a unit"：单位在 Board 上被具体选中，是目标（355.7/355.9.a.1/355.10）；
 *   后续两句的 "it" 都指这同一个被选对象（359.3.e.14 的链接指令）。
 * - "If it's [Empowered], disempower it"：443.1/443.1.a 规定 Disempower 只影响当前 Empowered
 *   的对象，443.1.a.1 明确对**未 Empowered** 的对象执行 Disempower「will do nothing」。
 *   因此这条从句与「无条件 Disempower」在结果上等价：条件是状态门（442.1.a 的二元状态），
 *   而不满足条件时的行为恰好就是 443.1.a.1 的空效果。已合入的 effect.empower 以
 *   mode: "disempower" 提交封闭 GameAction `disempower`，由动作层按 443.1 处理空效果，
 *   卡程序不重复实现该状态判定（也不是 CR 702 的 Buff 计数）。
 * - "Then kill it if it has 3 :rb_might: or less"：429.1.a.1 的主动消灭；"Might" 按 143.2.a.1
 *   指结算时的 Effective Might，条件在该指令执行时判定（契约 3.2 的 instruction.condition），
 *   用已合入的对象属性读取 + compare 表达。
 * - [Flow]（829）：829.1.c 的格式 "Flow [Cost]" 与 829.1.b 的「用 Flow 打出后本卡离开 Chain
 *   时改为放逐」；卡只声明关键词身份（契约 3.7/README 第 5 节）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。唯一未合入的依赖是 [Flow]：
 * 829.1.b/829.1.c 需要 RIFT-261 的费用消费方（暴露可选择的备选费用、保留 null 印刷费用、
 * 记录实付的 Flow 实例）与 RIFT-260 的替代注册/排序路径（并区分本卡自身执行造成的离链），
 * 两者都未合入，关键词展开（keywords/Flow.ts）因此没有可执行链路。
 * 其余两半都是已合入原语并有 golden 执行证据：effect.empower 的 disempower 模式
 * （443.1/443.1.a/443.1.a.1，含未 Empowered 时的空效果）与 effect.kill 的 Might ≤ 3 分支
 * （429.1.a.1 + 143.2.a.1 的 compare）。不近似实现：不把 Disempower 改成 Might/Buff 操作，
 * 也不把 Flow 降级为普通费用。
 */
const lacerate = {
  canonicalCardId: "card.hash-918c7c0acc1cff3bf6bc9579ca9dc1dfeec36e9b894becddb7b0eb8918a44cad",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "唯一未合入的依赖是 [Flow]（829）：829.1.b/829.1.c 的备选费用与「离开 Chain 时改为放逐」替代需要 " +
    "RIFT-261（费用消费方暴露可选择的备选费用、保留 null 印刷费用、记录实付 Flow 实例）与 " +
    "RIFT-260（替代注册/排序，并区分本卡自身执行造成的离链），两者都未合入；" +
    "keywords/Flow.ts 的展开因此没有可执行链路。不把 Flow 降级成普通费用。" +
    "「If it's [Empowered], disempower it」按 443.1.a.1（对未 Empowered 的对象执行 Disempower " +
    "什么也不发生）与无条件 Disempower 结果等价，已由已合入的 effect.empower（mode: disempower）" +
    "执行；「kill it if it has 3 :rb_might: or less」用 429.1.a.1 的 effect.kill 加上 143.2.a.1 的 " +
    "Effective Might compare 条件执行。两条都有 golden 真实执行证据（含未 Empowered 的空效果与 " +
    "Might > 3 不消灭的边界）。",
  abilities: [
    { kind: "keyword", keyword: "flow" },
    {
      kind: "play",
      body: [
        {
          // 「If it's [Empowered], disempower it」：443.1/443.1.a 的 Disempower；
          // 443.1.a.1 让未 Empowered 的情形本身就是空效果，无需另写状态谓词。
          id: "lacerate.disempower",
          op: "effect.empower",
          args: {
            mode: { kind: "constant", value: "disempower" },
            // effect.empower 的选择器形状是 { kind: "target", id }（见原语文档）。
            objects: { kind: "constant", value: { kind: "target", id: "lacerate.unit" } }
          },
          targets: [
            {
              id: "lacerate.unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 「Then kill it if it has 3 :rb_might: or less」：同一个被选单位；
          // 条件按 143.2.a.1 读 Effective Might，在该指令执行时判定。
          id: "lacerate.kill-if-small",
          op: "effect.kill",
          args: { target: { kind: "constant", value: "lacerate.unit" } },
          condition: {
            kind: "compare",
            left: { kind: "object-property", object: { target: "lacerate.unit" }, property: "might" },
            operator: "lte",
            right: { kind: "constant", value: 3 }
          }
        }
      ]
    }
  ],
  sourceText:
    "Choose a unit. If it's [Empowered], disempower it. Then kill it if it has 3 :rb_might: or less.\n" +
    "[Flow] :rb_energy_4::rb_rune_order::rb_rune_order: (You may play this from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;

export default lacerate;
