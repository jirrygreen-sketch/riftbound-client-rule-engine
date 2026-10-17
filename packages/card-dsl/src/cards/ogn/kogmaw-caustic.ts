import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Kog'Maw, Caustic (ogn-190-298) — Unit, 3 energy + 1 Chaos power, 1 Might.
 *
 * Printed text:
 *   [Deathknell] — Deal 4 to all units at my battlefield. (When I die, get the
 *   effect.)
 *
 * 规则依据（CR v1.5）：
 * - 808.1.c：Deathknell 功能上等同于 “When I die, [Effect].”；触发条件是宿主被消灭
 *   （object-killed，808.1.d / 429.1 / 429.1.a.1.b：“自身死亡触发”在送入 Trash 前
 *   作为 Pending Item 入链）。
 * - 808.1.d.3：进链时记录来源的位置与属性；效果正文读取 “my battlefield” 时必须用
 *   Deathknell 的最后已知地点。本程序用契约 3.6 的符号选择器 `sameLocationAs:
 *   "source"` 表达 “我所在的战场”，由解释器在来源离场后读取 last-known 快照
 *   （interpreter README 的 `source` 行）。
 * - “all units” 是按条件筛选的集合（355.10.d：按特征自动选定的对象不是目标，也
 *   没有可做的选择），因此用 `selection: "all"`、`min: 0`，不是 “up to”。
 * - 伤害来源缺省即本效果（418.6.a），原语 `effect.damage` 已合入并可由解释器执行。
 *
 * status 判定（README 第 2 节，2026-10-17 复核）：judge-required。三处已实测的当前缺口：
 * 1. `effects/keywords/Deathknell.ts` 的展开体引用 `trigger.leave`，而该 op 没有已合入的
 *    InstructionDef（effects/instructions/registry.generated.ts 无 trigger.* 条目）：展开的触发
 *    一旦结算就抛 Unregistered instruction opcode（CR 808.1）。
 * 2. 生产触发生命周期（programs/lifecycle.ts 的 attachProgramLifecycle）在 `object-leaves-board`
 *    发射时即 unregister 该宿主的注册，而一次 Kill 的 `object-killed` 在 leaves-board 之后才
 *    扫描：真实链上复现“注册成功、kill 后触发不进链”（CR 808.1.d.2 的“换区前入链”未完成）；
 *    808.1.d.1（死亡被替代则移出链）同属该管线。
 * 3. 生产目标翻译 programs/filters.ts 的 translateObjectFilter 对正文所需的 `sameLocationAs`
 *    锚点抛 ProgramBindingError（实测 “Unsupported filter field sameLocationAs”），即使前置缺口
 *    补齐，正文的目标也无法经 CardProgram 绑定到 Finalize。
 * 已合入并发可验证的部分：object-killed 事件携带离场前的最后已知快照（808.1.d.3 的 LKI 读取），
 * 解释器按 `sameLocationAs: "source"` 求值的正文（effect.damage）在 golden 中真实执行。
 * 依赖：trigger.leave 原语、死亡触发的生命周期送达与 sameLocationAs 目标绑定。
 * 显式正文可执行不能当作 Deathknell 已完成的替代实现，不近似实现。
 */
const abilities: Ability[] = [
  {
    // [Deathknell] 是触发能力关键词（808.1），只声明，不重写展开（契约 3.7）。
    kind: "keyword",
    keyword: "deathknell"
  },
  {
    kind: "triggered",
    trigger: { at: "object-killed", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "kogmaw-caustic.deal-4",
        op: "effect.damage",
        args: {
          amount: { kind: "constant", value: 4 },
          target: { kind: "constant", value: "units-at-my-battlefield" }
        },
        targets: [
          {
            id: "units-at-my-battlefield",
            // “my battlefield” = 来源的最后已知地点（808.1.d.3、契约 3.6）。
            filter: { type: "unit", sameLocationAs: "source" },
            min: 0,
            selection: "all"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-0f5741c23c7acda9685575d52a79431b6bad15e2c75415c8ecc902943fae6cd1",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处已实测的当前缺口：(1) effects/keywords/Deathknell.ts 的展开体引用 trigger.leave，而该 op 在 " +
    "effects/instructions/registry.generated.ts 中没有已合入的 InstructionDef，展开的触发结算会抛 " +
    "Unregistered instruction opcode（CR 808.1）；(2) 生产触发生命周期 programs/lifecycle.ts 的 " +
    "attachProgramLifecycle 在 object-leaves-board 发射时即取消该宿主的注册，而 Kill 的 object-killed " +
    "在 leaves-board 之后才扫描——真实链上复现“注册成功、kill 后触发不进链”，808.1.d.2 的“换区前入链”" +
    "与 808.1.d.1 的“死亡被替代则移出链”都未完成；(3) programs/filters.ts 的 translateObjectFilter " +
    "对正文的 sameLocationAs 锚点抛 ProgramBindingError（实测），正文目标无法经 CardProgram 绑定到 Finalize。" +
    "已合入并发可验证：object-killed 事件携带离场前的最后已知快照（808.1.d.3 的 LKI），解释器按 " +
    "sameLocationAs: \"source\" 求值的 effect.damage 正文在 golden 中真实执行。" +
    "依赖：trigger.leave 原语、死亡触发的生命周期送达与 sameLocationAs 目标绑定。不近似实现。",
  abilities,
  sourceText:
    "[Deathknell] — Deal 4 to all units at my battlefield. (When I die, get the effect.)"
} satisfies CardProgram;

export default program;
