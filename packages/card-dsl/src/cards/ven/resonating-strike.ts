import type { CardProgram } from "../../ir/index.js";

/**
 * Resonating Strike（ven-034-166）— Spell，2 能量 + 1 点 Calm 力量，领域 Calm，标签 无。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，ven-034-166，逐字）：
 *   "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n[Reaction] (Play on your turn or in showdowns.)\nChoose a battlefield you control and a unit you control at a different location. Move that unit to that battlefield and give it +2 :rb_might: this turn."
 *
 * 规则依据（Core Rules v1.5）：
 * - 「[Hidden]」是 811 的被动关键词：811.1.b/811.1.c 的 Hide 动作与 facedown 区域行为由
 *   keywords/Hidden.ts 展开（cost.hidden）与隐藏费用路径消费；811.1.d.2 还规定
 *   从 facedown 打出的隐藏法术，其目标必须从“藏匿所在战场”中选（本卡的目标限制会被它进一步
 *   收窄）。卡文件只声明关键词（契约 3.7）。
 * - 「[Reaction]」是 813 的许可类关键词（813.1.c），同样只声明。
 * - 「Choose a battlefield you control」：战场是 107.2.a 的 Board 地点对象，其控制状态由 190 定义
 *   （190.2.a/b、190.6）；355.9.a.1 的 “unit” 不涵盖它，本句是显式选择（355.7），所以战场是目标
 *   （355.9.b 的 “you control” 即限制）。355.4/355.4.a 规定 Move 的目的地在 Finalize 选择，
 *   且必须是单位当前地点以外、被允许存在的地点 —— 目的地的合法性由移动系统（effect.move 的
 *   destination 校验）负责。
 * - 「a unit you control at a different location」：单位是第二个目标（355.7）；“you control” 是
 *   控制者限制（355.9.b），“at a different location” 是相对第一个目标（战场）的位置限制
 *   （355.11 的分组限制形态：两个目标共同构成一项限制）。同一条指令里的两个 TargetSpec 表达
 *   这两个选择。
 * - 「Move that unit to that battlefield」是效果移动（451，不是 Standard Move 144），由已合入的
 *   effect.move 原语提交 {type:"move-location"}；「and give it +2 Might this turn」是同单位的
 *   临时 Might 修改（317.2.c 期限、143.2.a 的 Might 口径），归 layers 的 continuous.might
 *   （不是 Buff 计数，见 702/703）。“it” 回指被移动的单位（359.3.e.14 的链接示例）。
 *
 * 当前状态与剩余接线见 judgeReason；不以原语存在代替整卡执行证据。
 */

export default {
  canonicalCardId: "card.hash-fa3fca39f51f36c4a7eaf70e836d2271f5e26b7994a64cbafa1b79ec0ea7dad7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺目标与 Hidden 的生产接线：(1) 355.11 的 differentLocationThan 跨目标限制尚未进入 programs/filters.ts / target-plan；「battlefield you control」还须从 190 的地点控制状态构造合法目标，不能按普通永久物字段猜测。(2) target.location 与解释器的符号地点已合入，355.4/355.4.a 的 Move 目的地现为 location/target-location，原始 body 可执行 Move 后 continuous.might +2 this-turn；这不证明第 (1) 条的合法性已被验证。(3) Hidden KeywordDef 与 buildHiddenCostPlan 的 hide/play 费用已合入，但 cost.hidden 尚未绑定 Hide 动作、facedown 区域及 811.1.d.2 的逐目标战场收窄；普通打出与隐藏打出均需各自合法。保留 judge-required，不近似实现。",
  abilities: [
    // 811.1：Hidden 只声明关键词；展开与消费方见 judgeReason 第 3 条。
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      // 印刷基础费用：2 能量 + 1 点 Calm 力量。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // 「Move that unit to that battlefield」：451 的效果移动，目标是被移动的友方单位；
          // 目的地是第一个目标（所选战场），由解释器从所选战场解析 LocationRef。
          id: "resonating-strike.move-unit",
          op: "effect.move",
          args: {
            objects: {
              kind: "constant",
              // effect.move 的选择符是契约 3.6 的 { target: id } 形状（同 sfd/sirens-song），
              // 不是 effect.ready / effect.empower 的 { kind: "target", id } 形状。
              value: { target: "resonating-strike.friendly-unit" }
            },
            to: { kind: "location", value: { kind: "target-location", target: "resonating-strike.battlefield" } },
            amount: { kind: "constant", value: 1 },
            linkKey: { kind: "constant", value: "moved" }
          },
          // 本句显式选择两个对象（355.5/355.7）：被移动的单位与目的地战场。两个 TargetSpec 之间的
          // “at a different location” 是 355.11 的分组限制，待目标计划接线（见 judgeReason 第 2 条）。
          targets: [
            {
              id: "resonating-strike.friendly-unit",
              filter: {
                type: "unit",
                zone: "board",
                controller: "controller",
                differentLocationThan: { target: "resonating-strike.battlefield" }
              },
              min: 1,
              max: 1,
              selection: "one"
            },
            {
              // 「Choose a battlefield you control」：190 的战场控制状态谓词待接线。
              id: "resonating-strike.battlefield",
              filter: { type: "battlefield", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 「give it +2 Might this turn」：同一单位的临时 Might 修改（“it”，359.3.e.14）。
          // continuous.might 已合入，不近似成 Buff 计数。
          id: "resonating-strike.grant-might",
          op: "continuous.might",
          linkedTo: "resonating-strike.move-unit",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "this-turn" },
            target: { kind: "constant", value: "resonating-strike.friendly-unit" }
          },
          targets: [
            {
              id: "resonating-strike.friendly-unit",
              filter: {
                type: "unit",
                zone: "board",
                controller: "controller",
                differentLocationThan: { target: "resonating-strike.battlefield" }
              },
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
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Reaction] (Play on your turn or in showdowns.)\n" +
    "Choose a battlefield you control and a unit you control at a different location. " +
    "Move that unit to that battlefield and give it +2 :rb_might: this turn."
} satisfies CardProgram;
