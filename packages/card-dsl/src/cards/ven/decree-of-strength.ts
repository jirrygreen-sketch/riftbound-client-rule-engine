import type { CardProgram } from "../../ir/index.js";

/**
 * Decree of Strength（ven-085-166）— Spell，1 Energy，无印刷 Power，领域 Body。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-085-166，逐字）：
 *   "Choose an opponent. They reveal their hand and you choose a Mind
 *    (:rb_rune_mind:) card from it. They recycle that card."
 *
 * 规则依据（Core Rules v1.5）：
 * - "Choose an opponent."：355.7 让被点名的玩家成为 Target（355.9.a 明确把 "a player" 列为
 *   合法目标类别），在 Finalize 由施放者选择（355.5 / 355.8）。
 * - "They reveal their hand"：effect.reveal 的整区形态（425.1 / 425.3.a：省略张数即展示该区域
 *   当时的全部牌；425.1.a.2：被展示的牌留在原区域）。
 * - "you choose a Mind (:rb_rune_mind:) card from it"：手牌不是公开区域（108.4 / 128），按 355.10.a
 *   的例外（"You may play a unit from your hand … does not target"）不是 Target；它是结算时的
 *   非目标选择（355.18；355.7 的 "Pick" 分支），且带 "Mind card" 限制。:rb_rune_mind: 是 Mind 域
 *   的 Power 符号（135.2.e.4 + 134.2.c），此处描述该牌的域。
 * - "They recycle that card."：417.1.a / 417.1.c 把牌放到其拥有者主牌库底部（按拥有者路由，
 *   所以回收者是谁不影响目的地）；"They" 是第 1 句选中的对手。
 *
 * status = judge-required（三处缺口，均不近似实现）：
 * 1. 缺玩家目标形态：IR 的 TargetSpec.filter 是 ObjectFilter（对象集合），ResolveContext 只有
 *    ctx.targets(specId): ObjectRef[]（契约 3.6），没有 target.player / 玩家目标到后续指令的绑定
 *    （与本仓 ogn-155-298 Sabotage、ogn-177-298 Blind Fury 记录同一缺口，依赖 RIFT-9 target.player）。
 *    程序按既有写法保留 "opponent" 占位，golden 用具体对手执行展示半段。
 * 2. effect.recycle 没有结算期非目标选择描述符：已合入形态只有 target（目标）/ objects（已选定引用）/
 *    from{zone,owner,amount}（由区域拥有者选择、无卡牌过滤），无法表达"由本法术控制者从已展示手牌里
 *    挑一张"（与本仓 Sabotage 记录同一缺口）。
 * 3. "a Mind card" 的域谓词不可表达：已合入的过滤器（layers/filter.ts 的 matchesObjectFilter、参考内核的
 *    matchesFilter）只匹配 type/types/zone/location/controller/owner/states/tags/characteristics，
 *    没有"牌的域含 Mind"的读数（characteristics 按对象字段做等值/数组包含匹配，ObjectSnapshot 的 power
 *    是印刷 Power 列表而非可查询谓词），描述性键 domain 会被静默忽略——把它当已实现会让任何手牌都合法。
 * 依赖：RIFT-9（target.player、effect.recycle 的结算期 choose）、RIFT-90（目标计划/结算期选择）。
 */
const decreeOfStrength = {
  canonicalCardId: "card.hash-a8174733ce8471dd791d71e2914a7f93d9d2f6c25c8d7937bead01c30d962f4a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1)「Choose an opponent」按 355.7/355.9.a 是玩家目标，但已合入的 IR 没有玩家目标形态——" +
    "TargetSpec.filter 是 ObjectFilter，ResolveContext 只有 ctx.targets(specId): ObjectRef[]（契约 3.6），" +
    "也没有把该目标绑定到后续指令 player 实参的表达式（同 ogn-155-298 Sabotage / ogn-177-298 Blind Fury，依赖 RIFT-9 target.player）；" +
    "(2)「you choose a Mind card from it. They recycle that card.」是结算期在已展示手牌里做非目标选择再回收（355.18、" +
    "417.1.a/417.1.c）：已合入的 effect.recycle 只有 target / objects / from{zone,owner,amount}，没有结算期 choose 描述符，" +
    "from 形态也没有卡牌过滤且选择者是区域拥有者；" +
    "(3)「a Mind card」的域谓词不可表达：已合入过滤器只匹配 type/types/zone/location/controller/owner/states/tags/characteristics，" +
    "没有「牌的域含 Mind」的读数（描述性 domain 键会被静默忽略，等于允许任何手牌，属近似）。" +
    "依赖：RIFT-9（target.player、effect.recycle 的结算期 choose）与 RIFT-90（目标计划/结算期选择）。" +
    "展示半段（effect.reveal 的整区形态，425.3.a）已合入，golden 用具体对手真实执行。不近似实现。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        // 印刷费用 1 Energy（power: null 表示无印刷 Power，不写成 0）。
        energy: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "decree-of-strength.reveal-hand",
          op: "effect.reveal",
          args: {
            // "They reveal their hand"：揭示者是第 1 句选中的对手。把玩家目标绑定到 player
            // 实参的表达式尚未合入（见 judgeReason 第 1 条），此处保留占位；golden 用具体对手执行。
            player: { kind: "constant", value: "opponent" },
            // 省略 count：展示手牌当时的全部牌（425.3.a）。
            zone: { kind: "constant", value: "hand" }
          },
          // "Choose an opponent" 的玩家目标（355.7/355.9.a）：ObjectFilter 无法匹配玩家，
          // 该形状只作可审查数据（同 Sabotage）。
          targets: [
            {
              id: "decree-of-strength.opponent",
              filter: { kind: "player", player: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "decree-of-strength.recycle-mind-card",
          op: "effect.recycle",
          linkedTo: "decree-of-strength.reveal-hand",
          args: {
            // "you choose a Mind card from it" + "They recycle that card"：在已展示手牌里
            // 由本法术控制者做一次带域限制的非目标选择，再按 417.1.a 回收。effect.recycle
            // 尚无结算期 choose 描述符、也没有域过滤（见 judgeReason 第 2、3 条），故这条
            // 只作可审查数据：不执行、不改成"任意手牌"或"固定某张"等近近似写法。
            choose: {
              kind: "constant",
              value: {
                id: "decree-of-strength.chosen-card",
                filter: { zone: "hand", owner: "opponent", domain: "Mind" },
                chooser: "controller",
                visibility: "public",
                prompt: "Choose a Mind card from the revealed hand to recycle."
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "Choose an opponent. They reveal their hand and you choose a Mind " +
    "(:rb_rune_mind:) card from it. They recycle that card."
} satisfies CardProgram;

export default decreeOfStrength;
