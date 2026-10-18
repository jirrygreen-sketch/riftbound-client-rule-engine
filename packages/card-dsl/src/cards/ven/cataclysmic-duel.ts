import type { CardProgram } from "../../ir/index.js";

/**
 * Cataclysmic Duel（ven-090-166）— Spell，8 Energy + 3 Body Power，领域 Body。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-090-166，逐字）：
 *   "Each player chooses a unit they control. Kill the rest."
 *
 * 规则依据（Core Rules v1.5）：
 * - 355.10.e："Each player kills a unit they control" 一类文本不构成 Target，规则原文的例子
 *   直接给出了本条的两句结构——"Each player, including the one who played the spell, chooses a
 *   unit to kill as the spell or ability resolves"；因此被各玩家选中的单位是结算期的非目标选择
 *   （355.7 的 "Pick" 分支、355.18），不是 TargetSpec。
 * - 139 / 108.1："they control" 指各单位当前的控制者，每个玩家（含施放者）各自选择自己控制的一个单位。
 * - "Kill the rest."：被消灭的是**没有被任何玩家选中**的其余单位，即所选集合的补集；429.1 的 Kill 是
 *   永久物从场上进入弃牌堆的动作，已合入的 effect.kill 原语承载该动作（429.6 的格式与 429.5 的归因）。
 *
 * 复核（2026-10-17，M2 覆盖率复核）：逐项对照当前源码，两处缺口仍然成立，但描述按实测细化。
 *
 * status = judge-required（两处缺口，均不近似实现）：
 * 1. 缺多玩家顺序选择的原语／控制结构：已注册指令表（effects/instructions/registry.generated.ts，
 *    实测 42 个 op）没有 choice.each-player / choice.each-other-player；契约 3.6 的 choose 只支持
 *    单个 chooser（ChoiceRequest.chooser 是单个 PlayerId），IR 也无法命名运行时玩家 id。
 *    chain/engine.ts 的 `assertFinalizationSurface` 只拒绝嵌套 targets / choice.mode，不会替本卡的
 *    未注册 op 兜底；实测 describePlay 会把 `choice.each-player` 原样带进链，运行期没有解释器分支。
 *    本仓 ogn-244-298 Divine Judgment、ogn-237-298 King's Edict 记录同一缺口。
 * 2. "Kill the rest" 需要补集选择：已合入的 effect.kill 只接受 target（目标）/ picks（已选定引用）/
 *    self（另加 count 做子集选择）；没有任何原语表达"除各玩家所选之外的全部单位"，也没有
 *    跨玩家累计已选集合的读数。chain/picks/plan.ts 的有序 pick 只服务于 zoneSlice / linked 来源，
 *    不产出补集。
 * 依赖：多玩家选择原语与结算期补集选择（同一批 target.player / 多玩家选择协调）。
 * golden 覆盖校验、身份与结构；kill 本体（effect.kill）在本卡 golden 里由真实内核执行（含所选集合
 * 与空集边界），但两处依赖未合入，故不做整卡执行。
 */
const cataclysmicDuel = {
  canonicalCardId: "card.hash-52ee12e5ff701518b1a9805038c94f6a69d57289e478e7dc7d6e55ecdc1858e9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口：(1)「Each player chooses a unit they control」需要多玩家顺序选择原语：已注册指令表 " +
    "（effects/instructions/registry.generated.ts，实测 42 个 op）没有 choice.each-player / choice.each-other-player 的注册实现，" +
    "契约 3.6 的 choose 只支持单个 chooser（ChoiceRequest.chooser 是单个 PlayerId）且 IR 无法命名运行时玩家 id" +
    "（同 ogn-244-298 Divine Judgment / ogn-237-298 King's Edict 记录，依赖 target.player 与多玩家选择协调）；" +
    "355.10.e 明确这类选择不是 Target，故也不能用 TargetSpec 表达。实测 describePlay 会把未注册的 choice.each-player " +
    "原样带进链，运行期没有解释器分支。(2)「Kill the rest」需要补集选择：已合入的 effect.kill 只有 target/picks/self" +
    "（另加 count 做子集选择），没有任何原语能表达「除各玩家所选之外的全部单位」，也没有跨玩家累计已选集合的读数；" +
    "chain/picks/plan.ts 的有序 pick 只服务 zoneSlice / linked 来源，不产出补集。" +
    "程序里的描述性节点与 PickSpec 保持原意的可审查形状，未注册、不执行；golden 用真实内核执行 kill 本体（含空集边界），" +
    "但不构成整卡证据。不近似实现。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        // 印刷费用 8 Energy + 3 Body Power（catalog energy=8, power=3, domains ["Body"]）。
        energy: { kind: "constant", value: 8 },
        power: { kind: "constant", value: 3 }
      },
      body: [
        {
          // "Each player chooses a unit they control."：每个玩家（含施放者）在结算时各选一个自己控制的
          // 单位；355.10.e 明确这不是 Target。该控制结构没有已注册实现（见 judgeReason 第 1 条）。
          id: "cataclysmic-duel.each-player-chooses",
          op: "choice.each-player",
          args: {
            choosers: { kind: "literal", value: "each-player" },
            setKey: { kind: "literal", value: "cataclysmic-duel-kept" },
            choose: {
              kind: "literal",
              value: { filter: { type: "unit", controller: "controller" }, count: 1 }
            }
          },
          picks: [
            {
              id: "cataclysmic-duel-kept-units",
              // 运行时集合由各玩家在结算时确定；静态 IR 只标记供给方，不写运行时引用。
              options: ["dynamic:units-chosen-by-each-player"],
              min: 1,
              max: 1,
              selection: "one",
              filter: { type: "unit", controller: "controller" }
            }
          ]
        },
        {
          // "Kill the rest."：所选集合的补集；effect.kill 只有 target/picks/self，补集选择没有生产者
          // （见 judgeReason 第 2 条），故该指令保持未执行状态。
          id: "cataclysmic-duel.kill-the-rest",
          op: "effect.kill",
          linkedTo: "cataclysmic-duel.each-player-chooses",
          args: {
            picks: { kind: "literal", value: "cataclysmic-duel-rest-units" }
          },
          picks: [
            {
              id: "cataclysmic-duel-rest-units",
              options: ["dynamic:units-not-chosen-by-any-player"],
              min: 0,
              max: null,
              selection: "any",
              filter: { type: "unit" }
            }
          ]
        }
      ]
    }
  ],
  sourceText: "Each player chooses a unit they control. Kill the rest."
} satisfies CardProgram;

export default cataclysmicDuel;
