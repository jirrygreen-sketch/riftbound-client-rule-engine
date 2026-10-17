import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Sumpworks Map (unl-085-219) — Gear, Mind。
 * energy 2、power null（无印刷 Power）、might null（无印刷 Might）、tags []。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-085-219，逐字）：
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   [Temporary] (Kill this at the start of its controller's Beginning Phase, before scoring.)
 *   When an opponent scores, draw 1.
 *
 * 规则依据（CR v1.5）：
 * - 813.1 / 813.1.c / 813.1.d：[Reaction] 是许可类关键词，授予任意玩家回合 Closed State 的
 *   打出许可；卡只声明关键词，展开为 static continuous.timing 由关键词注册表负责（契约 3.7）。
 * - 816.1 / 816.1.a / 816.1.b / 816.1.c：[Temporary] 是触发能力关键词，功能上等于
 *   「在该永久物控制者的 Beginning Phase 开始时、计分前，消灭它」；816.2 / 816.2.a 多个实例
 *   冗余（只触发一次）；816.3 该特征可被其他效果读取。卡只声明关键词。
 * - 470.1 / 470.3 / 473.2：Scoring 与 Gaining Points 是不同过程，卡文的 scores 指 Scoring；
 *   封闭时点的 score（events/timing-points.ts，payloadType scoring）就是该触发窗口。
 * - 383.2.a：When 引出 Trigger Condition；an opponent 用 PlayerSelector opponent
 *   （events/trigger-spec.ts）表达「计分玩家不是本能力控制者」。
 * - 414.1 / 414.3 / 190.6.d：draw 1 = effect.draw，隐含的 you 是能力控制者。
 *
 * status = judge-required：effect.draw 本体、score 时点和 Temporary 的 kill 展开都有真实
 * 解释器证据，但完整卡牌生命周期仍受两个当前契约缺口阻断。Temporary 展开把
 * beginning-start 写入 EventPattern，而该词目前不在封闭的事件模式词表；Reaction 展开
 * 的 continuous.timing appliesTo 形状也尚未被程序静态绑定器消费。因此不能把局部解释器
 * 证据提升为整卡 executable。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "reaction" },
  { kind: "keyword", keyword: "temporary" },
  {
    kind: "triggered",
    trigger: {
      at: "score",
      // 473.2：Score ability 在计分时触发；player: opponent 表示计分玩家不是本能力控制者。
      filter: { event: "scored", player: "opponent" }
    },
    optional: false,
    body: [
      {
        id: "sumpworks-map.draw",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-47a542464232c8294d831009e0eeadaef69bf895aacfa6489afba4c08f3c2440",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前契约缺口阻断完整生命周期，均不近似实现：(1) Temporary KeywordDef 的 " +
    "beginning-start 触发体使用合法时点，但该事件目前不在 EventPattern 的封闭词表中，" +
    "所以 CardProgram 的触发注册无法绑定；(2) Reaction KeywordDef 的 continuous.timing 展开" +
    "使用 card/activated-ability 的 appliesTo 数组，程序静态绑定器尚未消费该形状，Closed State" +
    "许可不能从本卡声明接入。score 触发改用封闭词表中的 scored 映射到 score 时点；draw、" +
    "Temporary 的 kill body 均有解释器执行证据。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "[Temporary] (Kill this at the start of its controller's Beginning Phase, before scoring.)\n" +
    "When an opponent scores, draw 1."
} satisfies CardProgram;
