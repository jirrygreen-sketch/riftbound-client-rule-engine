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
 * status = judge-required（README 第 2 节），三处依赖未合入，全部不近似实现：
 * (1) [Temporary] 没有 KeywordDef：已合入的 16 个关键词不含 Temporary，816.1.b / 816.1.c 的
 *     延迟触发没有展开实现（effect.kill 原语本身已合入，缺的是关键词展开，与 ogn/sprite、
 *     ogn/fading-memories 同类，依赖 RIFT-83/84 系列）。
 * (2) [Reaction] 的展开只是 static continuous.timing；layers/ 的消费方与 chain/ 的
 *     canAct(player, speed) 时机许可尚未合入，Closed State 许可无法判定。
 * (3) When an opponent scores 的 score 时点没有已合入发出者：scoring/scoring.ts 只做分数账本
 *     变更、不产生时点，events/action-adapter.ts 的 score 映射只在 perform({type: score}) 路径
 *     生效，而生产计分流程尚未经该动作提交；同时没有订阅方把 CardProgram 的 triggered ability
 *     注册为 TriggerRegistration（契约 3.5、RIFT-120 后续）。
 * effect.draw 本体已合入，golden 用解释器真实执行。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "reaction" },
  { kind: "keyword", keyword: "temporary" },
  {
    kind: "triggered",
    trigger: {
      at: "score",
      // 473.2：Score ability 在计分时触发；player: opponent 表示计分玩家不是本能力控制者。
      filter: { event: "score", player: "opponent" }
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
    "三处依赖未合入，均不近似实现：(1) [Temporary] 无 KeywordDef：已合入的关键词不含 Temporary，" +
    "CR 816.1.b / 816.1.c 的「自身控制者 Beginning Phase 开始时（beginning-start，计分前）消灭此永久物」延迟触发没有展开实现" +
    "（effect.kill 原语已合入，缺的是关键词展开；依赖 RIFT-83/84 系列关键词任务）。(2) [Reaction] 的展开只是 static " +
    "continuous.timing（813.1.c 的 closed-state 许可），layers/ 消费方与 chain/ 的 canAct(player, speed) 尚未合入，" +
    "无法判定本卡能否在 Closed State 打出。(3) 「When an opponent scores」的 score 时点没有已合入发出者：scoring/scoring.ts " +
    "只做分数账本变更、不产生时点，events/action-adapter.ts 的 score 映射只在 perform({type: score}) 路径生效，" +
    "而生产计分流程尚未经该动作提交；同时没有订阅方把 CardProgram 的 triggered ability 注册为 TriggerRegistration" +
    "（契约 3.5、RIFT-120 后续）。effect.draw 本体已合入，golden 用解释器真实执行。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "[Temporary] (Kill this at the start of its controller's Beginning Phase, before scoring.)\n" +
    "When an opponent scores, draw 1."
} satisfies CardProgram;
