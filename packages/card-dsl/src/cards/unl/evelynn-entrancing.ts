import type { CardProgram } from "../../ir/index.js";

/**
 * Evelynn, Entrancing (unl-141-219) — Unit, Chaos, tags Evelynn / Demon / Champion。
 * catalog：energy 2、power null（无印刷力量）、might 2。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-141-219，逐字）：
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)
 *   [Backline] (I must be assigned combat damage last.)
 *   When you play me from face down on your turn, you may move an enemy unit at a
 *   different location to my battlefield.
 *
 * 规则依据（CR v1.5）：
 * - [Hidden]（811.1–811.6）与 [Backline]（826.1–826.6）都是被动关键词，卡内只声明关键词
 *   身份（契约 3.7 第 5 节）：展开分别归 effects/keywords/Hidden.ts（cost.hidden）与
 *   effects/keywords/Backline.ts（continuous.combat 的伤害指派顺序要求）。
 * - “When you play me from face down on your turn”：触发点是 card-played（383.4.a.1），但条件
 *   包含“此前在面朝下区域被藏起”（811.1.d）与“在你的回合”两项；当前 card-played 事件载荷与
 *   ObjectSnapshot 都不暴露面朝下来源事实（同 rad/evelynn-consuming 的记录）。程序用仓库里已合入的
 *   内层 filter 写法指称“本卡被打出”（对照 rad/neeko-blending-in 的相同形状）。
 * - “you may move an enemy unit at a different location to my battlefield”：契约 3.9 的“可以……”
 *   写成 choice.optional；被移动的单位是单个选目标（355.7/355.9.a），“enemy unit at a different
 *   location”（740.1.b 的 enemy；“不同地点”相对本卡当前位置）与“my battlefield”（359.3.f 的
 *   my = 来源当前位置）都需要位置比较，后者用 355.4 的“移动目的地须在移动前选定”。
 *
 * status = judge-required（缺口不近似实现）：
 * - “play me from face down”的事实不可判定（同上）；“on your turn”需要回合归属谓词。
 * - “at a different location”需要“与来源当前位置不同”的位置比较锚点：契约 3.6 的
 *   ObjectFilter 只有 sameLocationAs（同位置），没有 notSameLocation / 相对位置的否定锚点，
 *   已合入过滤器也不解析它，故无法诚实过滤（同 ogn/volibear-imposing 的 “other than mine”、
 *   ogn/ride-the-wind 的“除当前地点外的任意合法地点”记录）。
 * - [Hidden] 的运行时不可用：cost.hidden 没有消费方，zones/actions 不支持 Facedown Zone 与
 *   Hide（cost/README.md 第 3 条），811.1.d 的藏牌与 811.6 的后续奇怪打出都无法落地。
 * - [Backline] 的展开（continuous.combat）虽已有原语与 KeywordDef，战斗伤害指派顺序
 *   （826.3/826.4.b）仍没有消费者。
 * 已合入且被 golden 真实执行的是效果本体：effect.move（friendly/enemy 无关的移动原语）把锁定的
 * 敌方单位移到“我当下的战场”（先用 condition.value 锁定 my battlefield 再移动，符合 355.4）。
 *
 * 依赖：card-played 事件的 fromFaceDown 与回合归属字段、ObjectFilter 的位置否定锚点、
 * cost.hidden 的 Hide/Facedown 运行时、以及 continuous.combat 的战斗分配消费者。
 */
export default {
  canonicalCardId:
    "card.hash-650842dbdfc1ff881b1b846ecbefb168d4230c218aa64ca678d3a085546fd872",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口：(1) 「play me from face down」需要 card-played 事件载荷 / ObjectSnapshot 暴露“此前在面朝下区域”" +
    "的事实（811.1.d），当前两者都没有该特征（同 rad/evelynn-consuming 的记录），「on your turn」还需要回合归属谓词。" +
    "(2) 「an enemy unit at a different location」需要“与来源当前位置不同”的位置比较锚点：契约 3.6 的 ObjectFilter " +
    "只有 sameLocationAs（同位置），没有位置否定的锚点，已合入过滤器也不解析未知锚点（同 ogn/volibear-imposing 的 " +
    "other than mine、ogn/ride-the-wind 的记录），因此不能诚实地过滤出“别处”的单位。" +
    "(3) [Hidden] 的运行时不可用：cost.hidden 没有消费方，zones/actions 不支持 Facedown Zone 与 Hide" +
    "（cost/README.md 第 3 条），811.1.d 的藏牌、811.6 的后续打出与 0 能量打出都无法落地。" +
    "(4) [Backline] 的展开（continuous.combat，826.3/826.4.b 的伤害指派顺序）虽已有原语与 KeywordDef，但战斗分配没有消费者。" +
    "已合入且由 golden 真实执行的是效果本体 effect.move：先按 355.4 锁定“我当下的战场”" +
    "（condition.value），再把锁定的敌方单位移过去；拒绝时整条可选指令被跳过。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "backline" },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          // “you play me from face down on your turn”：来源即本卡、打出者为能力控制者；
          // “from face down” 目前没有可判定的载荷字段（见 judgeReason），不写成会被静默忽略的键。
          filter: { source: "self", player: "controller" }
        }
      },
      // “you may move …” 是效果开头的 “you may”（383.3.e.2）：按契约 3.9 用 choice.optional
      // 把被选指令包进 body，触发本身保持非可选（此处不是费用）。
      optional: false,
      body: [
        {
          id: "evelynn-entrancing.may-move",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Move an enemy unit at a different location to my battlefield?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "evelynn-entrancing.my-battlefield",
                  // 355.4：移动的目的地必须在移动前选定。359.3.f 的 “my” = 来源当前位置。
                  op: "condition.value",
                  args: {
                    value: {
                      kind: "object-property",
                      object: "self",
                      property: "location"
                    },
                    key: { kind: "constant", value: "myBattlefield" }
                  }
                },
                {
                  id: "evelynn-entrancing.move-enemy",
                  linkedTo: "evelynn-entrancing.my-battlefield",
                  op: "effect.move",
                  args: {
                    objects: {
                      kind: "constant",
                      value: { target: "evelynn-entrancing.enemy-unit-elsewhere" }
                    },
                    to: {
                      kind: "linked-value",
                      instructionId: "evelynn-entrancing.my-battlefield",
                      key: "myBattlefield"
                    },
                    amount: { kind: "constant", value: 1 },
                    linkKey: { kind: "constant", value: "moved" }
                  },
                  targets: [
                    {
                      id: "evelynn-entrancing.enemy-unit-elsewhere",
                      // “an enemy unit”（740.1.b）。“at a different location” 需要位置否定的
                      // 比较锚点（见 judgeReason），真实比较由 Finalize 按 355.9.b 执行。
                      filter: { type: "unit", controller: "opponent", zone: "board" },
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
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Backline] (I must be assigned combat damage last.)\n" +
    "When you play me from face down on your turn, you may move an enemy unit at a different location " +
    "to my battlefield."
} satisfies CardProgram;
