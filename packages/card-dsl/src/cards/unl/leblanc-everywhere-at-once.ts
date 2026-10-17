import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * LeBlanc, Everywhere at Once (unl-090-219) — Unit, 4 energy，无印刷力量，Might 4，Mind，
 * 标签 Noxus/LeBlanc/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-090-219，逐字）：
 *   [Backline] (I must be assigned combat damage last.)
 *   Your [Temporary] effects at my battlefield don't trigger.
 *
 * 规则依据（CR v1.5）：
 * - [Backline]（826.3 / 826.4.b）：被动关键词，功能等价于「我必须在本控制者的其他单位之后
 *   被分配致命伤害」；卡内只声明 keyword（契约 3.1/3.7、README 第 5 节），
 *   展开归 effects/keywords/Backline.ts。
 * - “Your [Temporary] effects at my battlefield don't trigger”：这是对触发收集阶段的
 *   抑制型改写（721.2 的“不触发”语义；816.1.b 的 [Temporary] 触发在来源所在战场的
 *   控制者 Beginning Phase 开始时发生）。她所在战场上的、由你控制的 [Temporary] 触发
 *   被抑制（386.1 的频度类改写同属触发收集阶段）。
 * - “my battlefield”＝来源当前所在的战场（464.2.b 的 here 位置判定）；她不在战场时该抑制不适用。
 *
 * status = judge-required（缺口均不近似实现）：
 * - [Backline]（826）没有可执行路径：keywords/Backline.ts 已合入（static continuous.combat），
 *   但战斗伤害分配不读取它——combat/base-combat-allocation.ts 明确写着
 *   "No Tank/Backline/other assignment-priority requirement is bound here"，826.3/826.4.b 的
 *   分配顺序不可执行（同 sfd/soraka-wanderer 的缺口）。
 * - “don't trigger” 需要触发收集阶段的抑制接口：当前没有
 *   `continuous.trigger-suppression` 的收集阶段消费者，events/ 的触发收集也没有「本战场上的
 *   [Temporary] 触发不收集」的挂钩；用连续效果假装抑制会在触发已进链后才生效，语义不同。
 * - [Temporary]（816）的 KeywordDef、`effect.kill` 展开和 CardProgram 触发注册已经合入，
 *   它们不是本卡当前的缺口。
 * 依赖：战斗分配消费者（826，combat/）、触发收集阶段的抑制接口（events/）。
 */
const abilities: Ability[] = [
  // 826.3：印刷的 [Backline] 声明（展开归 keywords/Backline.ts，分配顺序消费方未合入）。
  { kind: "keyword", keyword: "backline" },
  {
    // “Your [Temporary] effects at my battlefield don't trigger.”：触发收集阶段的抑制改写。
    // 保留待接线声明（与 continuous.trigger-multiplicity 同族的 collected-stage 语义），
    // 当前没有消费者（见 judgeReason）。
    kind: "static",
    effect: {
      kind: "continuous.trigger-suppression",
      appliesTo: {
        keyword: "temporary",
        controller: "controller",
        zone: "board",
        // “at my battlefield”：来源当前所在战场（464.2.b 的 here 位置判定）。
        here: true
      }
    }
  }
];

const program = {
  canonicalCardId:
    "card.hash-00848bf5805bd71357bd0e72b22c97fea424a1b4d5f2cbe6dddfd9d6e709a311",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处缺口，均不近似实现：(1) [Backline]（826）没有可执行路径：keywords/Backline.ts 只声明 static continuous.combat，" +
    "战斗伤害分配不读取它——combat/base-combat-allocation.ts 明确写着 \"No Tank/Backline/other assignment-priority requirement is bound here\"，" +
    "826.3/826.4.b 的「最后分配致命伤害」不可执行（同 sfd/soraka-wanderer）。" +
    "(2)「Your [Temporary] effects at my battlefield don't trigger」需要在触发收集阶段抑制：当前没有 " +
    "continuous.trigger-suppression 的收集阶段消费者，events/ 的触发收集也没有「本战场上的 [Temporary] 触发不收集」挂钩；" +
    "用连续效果近似会在触发已进链后才生效，语义不同。" +
    "[Temporary] 的 KeywordDef、effect.kill 展开和 CardProgram 触发注册已经合入。" +
    "已写出：[Backline] 关键词声明 + continuous.trigger-suppression（Temporary / controller / here）的待接线形状。" +
    "依赖：战斗分配消费者（826/combat）、触发收集阶段的抑制接口（events/）。",
  abilities,
  sourceText:
    "[Backline] (I must be assigned combat damage last.)\n" +
    "Your [Temporary] effects at my battlefield don't trigger."
} satisfies CardProgram;

export default program;
