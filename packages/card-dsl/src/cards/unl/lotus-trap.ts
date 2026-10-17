import type { CardProgram } from "../../ir/index.js";

/**
 * Lotus Trap (unl-013-219) — Spell, 2 energy, Power null, Might null, Fury。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-013-219，逐字）：
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Choose a unit. Double all damage that would be dealt to it this turn.
 *
 * 规则依据（CR v1.5）：
 * - [Hidden]（811）与 [Reaction]（813）都是关键词，卡牌只声明（README 第 5 节）；
 *   Hidden 的展开（keywords/Hidden.ts）是 static cost.hidden，Reaction 的展开是 continuous.timing。
 * - “Choose a unit.” 是具体对象选择（355.5）：355.9.a.1 的 “unit” 指 Board 上的单位，因此写成
 *   TargetSpec（“choose …” 不是替代效果的一部分，355.10.c 的对照例子）。
 * - “Double all damage that would be dealt to it this turn”：433.1.b 明确“让伤害翻倍”等价于
 *   “若它将受到某来源的伤害，则改为受到双倍伤害” 的替代效果；本地调研（docs/plans/survey/
 *   unclassified-unl.md 第 9 条）给出的结论是 needs-new-primitive：新增 replacement.damage-multiplier，
 *   规则 142.4 / 369.1 / 418.1 / 418.5。本卡按该结论声明 op，不发明可执行语义。
 *
 * status = judge-required（缺口不近似实现）：
 * - replacement.damage-multiplier 原语不存在；卡牌程序也没有替代注册入口（ResolveContext 只有
 *   addContinuous / registerDelayedTrigger），damage GameAction 没有倍率钩子。
 * - [Hidden] 的 cost.hidden 展开没有消费方：Hide 行动、facedown 区域以及从 facedown 免费/受限打出
 *   的流程都没有接入。
 * - [Reaction] 的 continuous.timing 没有图层/链侧消费方，Closed State 的时机许可无法生效。
 * 本卡没有可独立执行的正文指令，golden 只做校验、结构断言与缺口 todo。
 */
const lotusTrap = {
  canonicalCardId: "card.hash-4a35c75cbe6c3eeae825ce423a2f3dbbdbbbc76b117a9c54735ebc7a7c7c4290",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Double all damage that would be dealt to it this turn」是伤害翻倍替代（CR 433.1.b：等价于" +
    "“将受到的伤害改为双倍” 的替代效果；369.1 / 418.1 / 418.5），但 replacement.damage-multiplier 原语不存在，" +
    "卡牌程序也没有替代注册入口（ResolveContext 只有 addContinuous / registerDelayedTrigger），" +
    "damage GameAction 没有倍率维度；本地调研（docs/plans/survey/unclassified-unl.md 第 9 条）把它判为 needs-new-primitive。" +
    "[Hidden] 的 cost.hidden 展开也没有消费方（Hide 行动、facedown 区域与从 facedown 打出的流程均未接入），" +
    "[Reaction] 的 continuous.timing 消费方同样未合入，Closed State 的时机许可无法生效；不近似实现（不写成永久标记或固定伤害）。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      // 印刷 2 Energy；力量无印刷值（catalog power: null），不声明 power，null 不改写为 0。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          // “Choose a unit. Double all damage that would be dealt to it this turn”：
          // 目标是一个单位；倍率替代按 433.1.b 的语义声明（消费方未合入，见 judgeReason）。
          id: "lotus-trap.double-damage",
          op: "replacement.damage-multiplier",
          args: {
            event: { kind: "constant", value: "damage" },
            object: { kind: "constant", value: { target: "lotus-trap.unit" } },
            multiplier: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "lotus-trap.unit",
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
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a unit. Double all damage that would be dealt to it this turn."
} satisfies CardProgram;

export default lotusTrap;
