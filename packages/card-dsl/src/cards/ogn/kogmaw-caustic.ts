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
 * status 判定（README 第 2 节）：judge-required。缺的是 Deathknell 关键词展开的运行时：
 * `effects/keywords/Deathknell.ts` 展开出的 object-killed 能力仍引用未注册的
 * `trigger.leave` 原语；object-killed 上“死亡被替代则移出链 / 换区前保存最后已知信息”的
 * 808.1.d.1–d.3 流程也没有卡牌可用路径。即使该触发路径补齐，生产目标翻译还会拒绝
 * 正文所需的 `sameLocationAs` 锚点。显式正文的 effect.damage 已可执行，但不能把它当作
 * 已经完成 Deathknell 的替代实现。
 * 效果正文本身（effect.damage + sameLocationAs 锚点在来源最后已知地点）已合入并在
 * golden 中真实执行。依赖：`trigger.leave` 原语落地与完整的 object-killed/LKI 处理。
 * 关键词展开可用之前，本卡不得按 “explicit trigger 能跑” 记 executable。
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
    "Deathknell 关键词展开不可执行：effects/keywords/Deathknell.ts 展开出的触发能力使用 " +
    "未注册的 trigger.leave 原语，" +
    "object-killed 触发收集、808.1.d.1 死亡被替代时移出链、808.1.d.3 换区前记录最后已知信息" +
    "也都没有卡牌可用路径；生产目标翻译还不接受正文的 sameLocationAs 锚点。" +
    "依赖：trigger.leave 原语、完整的 object-killed/LKI 处理与 sameLocationAs 目标绑定。" +
    "效果正文本身的 effect.damage 已合入，golden 测试用解释器 + 参考内核真实执行。不近似实现。",
  abilities,
  sourceText:
    "[Deathknell] — Deal 4 to all units at my battlefield. (When I die, get the effect.)"
} satisfies CardProgram;

export default program;
