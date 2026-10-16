import type { CardProgram } from "../../ir/index.js";

/**
 * Bone Skewer (unl-139-219) — Spell, 2 energy + 1 power, Chaos.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-139-219, verbatim):
 *   "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *    :rb_energy_0:.)
 *    Choose a battlefield. An opponent reveals their hand. You may choose a
 *    unit from it. They play that unit to that battlefield, ignoring any and
 *    all costs. When they do, [Stun] it. (It doesn't deal combat damage this
 *    turn.)"
 *
 * Rules evidence (Core Rules v1.5):
 * - [Hidden] (811) is declared as a keyword ability only; its expansion
 *   (effects/keywords/Hidden.ts) is a `cost.hidden` static effect whose
 *   consumer is still pending (RIFT-89), so the hide/facedown-play half of the
 *   card cannot execute. The card declares the keyword as README section 5
 *   requires instead of re-writing the expansion.
 * - "Choose a battlefield" chooses a specific Game Object in a public zone
 *   (170 / 170.7 / 355.10.a.1), so it is a target (355.7); the merged corpus
 *   records the same reading in rad/for-demacia.
 * - "An opponent reveals their hand" is a Reveal (425.1 / 425.2 / 425.3.a):
 *   without a printed count the whole zone is revealed, which the merged
 *   effect.reveal expresses by omitting `count`. The chooser of the opponent is
 *   a player choice with no merged form: the frozen TargetSpec only describes
 *   object filters and PickSpec.options is a static value list, so "an
 *   opponent" cannot be selected (ogn/mindsplitter records the same gap as the
 *   unmerged target.player primitive). The opponent choice is therefore
 *   declared as the same `target.player` shape ogn/mindsplitter uses, and the
 *   reveal reads its linked result; the golden test binds that linked value
 *   directly, exactly as the merged mindsplitter golden does.
 * - "You may choose a unit from it": the chosen card comes from the revealed
 *   hand, a private zone, so it is a non-target pick rather than a target
 *   (355.10.a / 355.10.e); the merged effect.discard / effect.reveal pattern
 *   with `pick` over the reveal's linked `revealed` list is the corpus's shape
 *   for "a card from their hand". "You may" is written as choice.optional with
 *   the chosen instruction inside `body` (contract 3.9 - never a choice plus a
 *   linkedTo successor).
 * - "They play that unit to that battlefield, ignoring any and all costs":
 *   356.5.a is the exact rule ("ignore any and all costs" sets the total cost
 *   to [0]). The merged effect.play requires its `cost` argument to be an
 *   already-finalized FinalizedCostPlan produced by the cost system and never
 *   derives printed costs nor implements an ignore-cost rule (ogn/portal-rescue
 *   records the identical gap), so the play cannot be executed as printed. The
 *   instruction carries the printed rewrite as a descriptive, non-finalized
 *   marker that effect.play rejects instead of paying the printed cost.
 * - "When they do, [Stun] it" is a Reflexive Trigger (388.1 / 388.2 / 389.1):
 *   it is recognized by "When they do" and creates its own Pending Item after
 *   the play. No merged ability or instruction form creates a reflexive Pending
 *   Item (ogn/dragons-rage-lee-sin records the same gap as trigger.reflexive),
 *   so the Stun cannot be declared as an ordinary follow-up instruction without
 *   silently changing it into part of the resolving spell. [Stun] itself is the
 *   merged effect.stun primitive (424.1 / 424.1.a).
 *
 * status = judge-required (README section 2). Nothing is approximated: the
 * hidden-cost expansion, the opponent selection, the ignore-all-costs play and
 * the reflexive Stun each name their missing piece, and the golden test
 * executes only the merged halves (the battlefield target, the full-hand reveal
 * and the non-target pick).
 *
 * Dependencies: RIFT-89 (cost.hidden / cost.pay / FinalizedCostPlan for
 * "ignoring any and all costs", CR 356.5.a), target.player for the opponent
 * choice, and trigger.reflexive for "When they do".
 */
export default {
  canonicalCardId:
    "card.hash-5726eb484767a4425aeceb77e181b534986492340b0bc94c0bcf8d4ae478d598",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处依赖未合入，均不近似实现：(1) [Hidden]（811）的展开是 cost.hidden 静态效果，其消费方（隐藏与背面打出、" +
    "[A] 支付）属 RIFT-89，尚未接线（effects/keywords/Hidden.ts 自述）。" +
    "(2)「An opponent reveals their hand」需要玩家选择原语：冻结的 TargetSpec 只描述对象过滤器、PickSpec.options 是静态值数组，" +
    "「在所有对手中选一个玩家」没有形态（ogn/mindsplitter 记为 target.player 缺口）；本程序用带文档说明的占位 pick 绑定该对手。" +
    "(3)「They play that unit to that battlefield, ignoring any and all costs」按 356.5.a 是把总费用置 0；" +
    "已合入的 effect.play 明确要求 cost 参数是费用系统产出的已 Finalize 计划，它既不推导印刷费用也不实现忽略费用规则" +
    "（ogn/portal-rescue 的同一缺口），本卡只保留描述性的未 Finalize 改写标记，effect.play 会拒绝它而不是按印刷费用打出。" +
    "(4)「When they do, [Stun] it」是反身触发（388.1/388.2/389.1，由 “When they do” 识别，结算后另建 Pending Item）：" +
    "已合入的 IR 没有任何创建反身 Pending Item 的能力/指令形态（ogn/dragons-rage-lee-sin 记为 trigger.reflexive），" +
    "写成普通后续指令会把反身触发偷偷变成咒语的结算部分。" +
    "依赖：RIFT-89（cost.hidden / 忽略全部费用的打出计划）、target.player、trigger.reflexive。" +
    "已合入并由 golden 真实执行的部分：战场目标声明（170/355.7）、effect.reveal 展示对手全部手牌（425.3.a）、" +
    "以及从展示集合做的非目标 pick（355.10.a/e；effect.stun 本体 424.1 亦已合入）。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // 「Choose a battlefield」（170 / 170.7 / 355.10.a.1）：具体选择 → 目标。
          // 该选择与后续指令共享，故用一条无副作用的取值指令承载它
          // （ogn/azir-sovereign 同一做法：先读出后续指令要用的值）。
          id: "bone-skewer.battlefield",
          op: "condition.value",
          args: {
            value: {
              kind: "object-property",
              object: { target: "bone-skewer.battlefield" },
              property: "ref"
            },
            key: { kind: "constant", value: "battlefield" }
          },
          targets: [
            {
              id: "bone-skewer.battlefield",
              filter: { type: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 「An opponent」：无玩家选择原语（见 judgeReason 第 (2) 点），按
          // ogn/mindsplitter 的 target.player 形状声明，后续通过链接值读取其结果。
          id: "bone-skewer.choose-opponent",
          op: "target.player",
          args: {
            selection: { kind: "constant", value: "one" },
            chooser: { kind: "constant", value: "controller" },
            linkKey: { kind: "constant", value: "chosenOpponent" }
          }
        },
        {
          id: "bone-skewer.reveal-opponent-hand",
          op: "effect.reveal",
          linkedTo: "bone-skewer.choose-opponent",
          args: {
            player: {
              kind: "linked-value",
              instructionId: "bone-skewer.choose-opponent",
              key: "chosenOpponent"
            },
            zone: { kind: "constant", value: "hand" }
            // 425.3.a：未写张数 → 展示该区域当前全部牌（省略 count）。
          }
        },
        {
          // 「You may choose a unit from it. They play that unit ...」：契约 3.9 ——
          // 「可以……」把被选指令包进 choice.optional 的 body，不写成 choice + linkedTo。
          // 拒绝时整条指令 negated(skipped)，后续独立指令照常（本卡没有后续独立指令）。
          id: "bone-skewer.may-play-chosen-unit",
          op: "choice.optional",
          linkedTo: "bone-skewer.reveal-opponent-hand",
          args: {
            prompt: {
              kind: "constant",
              value: "Choose a unit card from the revealed hand and have them play it?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  // 「They play that unit to that battlefield, ignoring any and all
                  // costs」：356.5.a 的费用改写无生产者（见 judgeReason 第 (3) 点），
                  // 本卡只写描述性的未 Finalize 标记；effect.play 要求 finalized: true
                  // 的 FinalizedCostPlan，会拒绝该形状而不是按印刷费用打出。
                  id: "bone-skewer.play-chosen-unit",
                  op: "effect.play",
                  args: {
                    // 355.10.a / 355.10.e：手牌不在公开区域，从展示集合里选牌是
                    // 非目标 pick（ogn/mindsplitter 的 revealed-card pick 同一形状）。
                    pick: { kind: "constant", value: "bone-skewer.chosen-unit-card" },
                    // 「to that battlefield」：需要所选战场的运行期 LocationRef，
                    // 同样只有描述性标记（target.location 未合入）。
                    location: {
                      kind: "constant",
                      value: {
                        kind: "location-selector",
                        from: { target: "bone-skewer.battlefield" }
                      }
                    },
                    cost: {
                      kind: "constant",
                      value: {
                        kind: "cost.modify",
                        base: "printed",
                        ignore: ["any", "all"],
                        minimum: 0,
                        finalized: false
                      }
                    },
                    linkKey: { kind: "constant", value: "played" }
                  },
                  picks: [
                    {
                      id: "bone-skewer.chosen-unit-card",
                      // 选项来自上一条 reveal 的实际结果（契约 3.9 的 linked-value）。
                      options: [
                        {
                          kind: "linked-value",
                          instructionId: "bone-skewer.reveal-opponent-hand",
                          key: "revealed"
                        }
                      ],
                      filter: { zone: "hand", type: "unit" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        }
        // 「When they do, [Stun] it」是反身触发（388.1 / 389.1），无已合入形态
        // （见 judgeReason 第 (4) 点）：不写成普通后续指令（那会把反身触发并入
        // 咒语的结算），因此这里不写 effect.stun 指令，缺口记在 test.todo。
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "Choose a battlefield. An opponent reveals their hand. You may choose a unit from it. " +
    "They play that unit to that battlefield, ignoring any and all costs. When they do, [Stun] it. " +
    "(It doesn't deal combat damage this turn.)"
} satisfies CardProgram;
