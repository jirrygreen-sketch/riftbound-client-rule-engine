import type { CardProgram } from "../../ir/index.js";

/**
 * Upstage Comedy (unl-009-219) — Spell, 2 energy, Might null, Power null, Fury。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-009-219，逐字）：
 *   [Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)
 *   Ready a unit.
 *
 * 规则依据（CR v1.5）：
 * - [Repeat]（820.1.a/820.1.c）：可选附加费用关键词，印刷格式 “Repeat [Cost]”，付费后
 *   结算时把该链项的指令额外执行一次（820.1.d.1），可重新做选择（820.2/820.2.a）。
 *   按 README 第 5 节“关键词只声明”，本卡只声明 keyword: "repeat"；展开归
 *   effects/keywords/Repeat.ts（已合入），不在卡文件里手写 repeat.cost 或固定次数的重复执行。
 * - “Ready a unit”：416.1–416.3 的重置。355.9.a.1 的 “unit” 指 Board 上的单位；355.10.g 的对照
 *   例子区分了 “Ready your legend.”（不选目标）与 “Ready a friendly legend.”（选目标），本句写的是
 *   “a unit” 而不是 “your unit”，因此是目标选择 → TargetSpec（与已合入 ven/matriarch-of-war 的
 *   “Ready a unit” 同形）。effect.ready 的 objects 用契约 3.6 的 { target } 选择符。
 *
 * status = judge-required（复核 2026-10-17；缺口不近似实现）：
 * - [Repeat] 的关键词展开和 effect.repeat 解释器已合入，但卡牌侧仍没有把印刷附加费用接入
 *   Finalize，也没有把“已支付实例数”接到
 *   解释器 repeat 指令的打出管线。因此不在 body 里写固定 count 的 effect.repeat——固定次数的
 *   额外执行会把“未支付也重复”写成事实，属于禁止的近似实现；820.3.a（重复执行不等于再次打出）
 *   也由该管线负责。
 * - KeywordAbility（契约 3.1）只有 keyword/value 两个字段，印刷参数 “:rb_energy_2:” 无处承载
 *   （契约 3.8.3 的 params 只加在 KeywordDef.expand 的入参上）；同 ven/grumpy-rockbear 记录的
 *   同一缺口，见任务回复的契约变更请求。
 * “Ready a unit” 半段只用已合入的 effect.ready，golden 用解释器 + 参考内核真实执行。
 */
const upstageComedy = {
  canonicalCardId: "card.hash-f114e7d87a034d2ab43ead3320c3723924539deedb6f03584549c1f824a5c6c5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Repeat]（820.1.a/820.1.c：“Repeat [Cost]” 的可选附加费用，付费后结算时额外执行一次，820.1.d.1/820.2.a）" +
    "没有完整的可执行接线：Repeat.ts 的展开（static repeat.cost）和 effect.repeat 已合入，但卡牌侧仍没有把印刷 additional-cost 接进 Finalize，" +
    "也没有任何已合入路径把“已支付的 Repeat " +
    "实例数”接到解释器 repeat 指令的 count 上（后续 RIFT-349）；本卡因此不写固定 count 的额外执行（会近似成未付费也重复）。" +
    "另：印刷参数 :rb_energy_2: 无法挂在 CardProgram 的 KeywordAbility 上（契约 3.1 只有 keyword/value，" +
    "契约 3.8.3 的 params 只覆盖 KeywordDef.expand 入参）。" +
    "“Ready a unit”（416.1–416.3 + 355.9.a.1 的目标选择）本身只用已合入的 effect.ready，" +
    "golden 真实执行；不构成整卡证据。",
  abilities: [
    { kind: "keyword", keyword: "repeat" },
    {
      kind: "play",
      // 印刷基础费用 2 Energy（力量无印刷值 → 不声明 power，null 不改写为 0）。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "upstage-comedy.ready-unit",
          op: "effect.ready",
          args: {
            objects: {
              kind: "constant",
              value: { kind: "target", id: "upstage-comedy.unit" }
            },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "upstage-comedy.unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Ready a unit."
} satisfies CardProgram;

export default upstageComedy;
