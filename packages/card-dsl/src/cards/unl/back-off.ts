import type { CardProgram } from "../../ir/index.js";

/**
 * Back Off（unl-042-219）— Spell，3 能量，无印刷力量，领域 Calm。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-042-219，逐字）：
 *   "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *    :rb_energy_0:.)\n" +
 *   "[Action] (Play on your turn or in showdowns.)\n" +
 *   "[Stun] a unit. (It doesn't deal combat damage this turn.)\n" +
 *   "If you played this from your hand, draw 1."
 *
 * 规则依据（CR v1.5）：
 * - [Hidden]（811）与 [Action]（806）都是许可类关键词，按契约 3.7 只声明；展开
 *   （cost.hidden 的 Hide 许可 / continuous.timing 的 Showdown 许可）属关键词注册表与
 *   RIFT-89/91 的消费方，卡内不重写。
 * - 「[Stun] a unit」是 Stun 游戏动作（424.1）：把 Board 上的一个单位渲染为 Stunned。
 *   「a unit」按 355.5/355.5.a 是 Choice → Targeted（355.7），因此写成 TargetSpec
 *   （min=max=1、selection "one"），由已合入的 effect.stun 执行。reminder 括号里的
 *   「doesn't deal combat damage this turn」是 Stunned 状态的规则结果（424.1.b）与到期
 *   （424.1.a.2），不是本卡的独立指令，不另写指令、也不近似成其它状态。
 * - 「If you played this from your hand, draw 1」是结算时条件：356.1/356.2 的打出来源
 *   （play origin）事实。已合入的 ObjectSnapshot/事件管线都不暴露「本牌是从手牌打出的」
 *   这一事实（对照 sfd/reksai-breacher 的 playedFromZoneNot 与 rad/elnuk-herd 的
 *   playedFromFaceDown 同类缺口），因此条件读 object-property 的 playedFromHand，
 *   该特征不存在时解释器抛 MissingInformation → 该指令 ignored（fail-closed），
 *   绝不会无条件抽牌。
 *
 * status = judge-required（README 第 2 节）：Stun 半段只用已合入原语并单独真实执行；
 * 整卡依赖「打出来源 = 手牌」的可判定事实（与 [Hidden] 的面朝下打出事实同源）。
 */
const backOff = {
  canonicalCardId: "card.hash-8976907cb3568b5c00ce51faf4a35f8342adffe884444d535f12324bb4ae3778",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「If you played this from your hand, draw 1」需要「本牌从手牌打出」的可判定事实（CR 356.1/356.2 的打出来源）：" +
    "合并 ObjectSnapshot 与事件管线都不暴露 play origin（同类缺口见 sfd/reksai-breacher 的 playedFromZoneNot、rad/elnuk-herd 的 playedFromFaceDown），" +
    "程序里以 object-property 的 playedFromHand 写出该条件；该特征缺失时解释器按 MissingInformation → ignored 处理，不会无条件抽牌（不近似实现）。" +
    "[Hidden]（811）的展开（cost.hidden、面朝下打出许可）属 RIFT-84，" +
    "[Action]（806）的 continuous.timing 消费方属 RIFT-91/RIFT-85 批次；两者只作为 keyword 声明，卡内不重写展开。" +
    "Stun 半段（424.1/424.1.b）只用已合入的 effect.stun，golden 单独真实执行。" +
    "依赖：打出来源区域谓词 + RIFT-84（Hidden 展开）+ RIFT-91（时机许可消费方）。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "back-off.stun-unit",
          op: "effect.stun",
          args: { target: { kind: "constant", value: "back-off.stunned-unit" } },
          targets: [
            {
              id: "back-off.stunned-unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "back-off.draw-if-from-hand",
          // 「If you played this from your hand」：play origin 事实（见 judgeReason）。
          // 不含 linkedTo：抽牌不引用 Stun 的动作结果（055 / 359.3.e.11）。
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } },
          condition: {
            kind: "compare",
            left: { kind: "object-property", object: "source", property: "playedFromHand" },
            operator: "eq",
            right: { kind: "constant", value: true }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "[Stun] a unit. (It doesn't deal combat damage this turn.)\n" +
    "If you played this from your hand, draw 1."
} satisfies CardProgram;

export default backOff;
