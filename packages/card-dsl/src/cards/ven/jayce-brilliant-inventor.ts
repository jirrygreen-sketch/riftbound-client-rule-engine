import type { Ability, CardProgram, Instruction } from "../../ir/index.js";

/**
 * Jayce, Brilliant Inventor (ven-068-166) — Unit, 6 Energy + 1 Power, 6 Might,
 * Mind, Jayce/Piltover/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-068-166，逐字）：
 *   When you play me or the first time you play a non-token gear each turn, you
 *   may ready something besides me that's exhausted.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a / 383.4.a.1：“When you play me” 是 Play Effect（Condition 含本永久物的
 *   触发式能力）；383.4.a.4 说明“另一对象被打出”的触发不属于 Play Effect，但两半
 *   观察的都是同一个打出事件，封闭时点都是 card-played。
 * - “or” 在这里并列两个触发条件，不是效果的二选一模式，因此写成两条独立的
 *   triggered 能力（与 sfd-057-221 Irelia, Fervent 的 “choose or ready” 同形）。
 * - 383.1 / 383.1.b：“the first time you play a non-token gear each turn” 是 Nth-Time
 *   触发，用 TriggerSpec.once: "per-turn" 表达（契约 3.1 的 once 生命周期）。
 * - 403.1 / 契约 3.9：“you may” 一律写成 choice.optional，把被选择的指令包进 body，
 *   不写成“先 choice 再 linkedTo”。
 * - 355.10.d / 355.10.d.1：“ready something besides me that's exhausted” 由特征程序化
 *   选中——玩家没有选择余地，属非目标 pick（不触发“成为目标”相关触发，契约 3.4）；
 *   过滤用 053.1/053.2 的自身排除加 415.2 的 exhausted 状态，由契约 3.6 的
 *   ObjectFilter 锚点 exclude: "self" 表达。
 * - 416.1 / 416.1.b / 416.1.c：重置用 effect.ready；已就绪对象不会再次被重置。
 *
 * status = judge-required（缺口均不近似实现）：
 * 复核（2026-10-17，RIFT-613 第三轮 M2 覆盖率复核，实测见 test.mjs 的 probe 用例）：
 * 1. 触发注册与消费已合入：registerProgramTriggers 把 CardProgram 的 triggered 能力
 *    注册成 TriggerRegistration，事件管线扫描 card-played；TriggerSpec.once 的 per-turn
 *    频率由 pipeline.consume 在 Finalize 消费。play-me 半已进链并有探针证据；
 * 2. 非目标 pick 仍没有生产解析入口：chain/engine.ts 的 Finalize 只调用
 *    finalizeOrderedPickPlans，而 chain/picks/plan.ts 的 orderedPickSpecs 只接受带
 *    zoneSlice / linked 的来源型 PickSpec；本卡的 filter 型 PickSpec（exclude:self +
 *    states:exhausted）不会进 plan，解释器 ctx.picks(id) 解析为空、静默不 ready 任何对象
 *    （target/target-plan.ts 的 finalizePick 只有单元测试调用，生产链路无调用方）；
 * 3. “non-token gear” 的过滤器翻译失败：translateTriggerFilter 把嵌套 event filter 摊平后
 *    由 translateObjectFilter 处理，后者拒绝 isToken，实测 registerProgramTriggers 抛
 *    ProgramBindingError "Unsupported filter field isToken"；gear 半因此无法注册，并使
 *    整张卡的触发注册中止（triggerRegistrations 对 abilities 做 flatMap，一次抛出即整体失败）。
 * 依赖：filter 型 PickSpec 的生产 Finalize 解析管线（RIFT-358 后续）与
 *    translateTriggerFilter / translateObjectFilter 的 isToken 支持。
 * effect.ready 与 choice.optional 本体已合入，golden 用真实解释器 + 参考内核执行
 * 接受/拒绝两条路径。
 */

/** “ready something besides me that's exhausted”：非目标 pick（355.10.d）。 */
const readyPickId = "jayce-brilliant-inventor.exhausted-other";

/** 两半共用的印文效果： “you may ready something besides me that's exhausted”。 */
const optionalReady = (id: string): Instruction => ({
  id,
  op: "choice.optional",
  args: {
    prompt: { kind: "constant", value: "Ready something besides me that's exhausted?" },
    body: {
      kind: "constant",
      value: [
        {
          id: `${id}.ready-other`,
          op: "effect.ready",
          args: {
            objects: { kind: "constant", value: { kind: "pick", id: readyPickId } }
          },
          picks: [
            {
              id: readyPickId,
              options: ["exhausted-object-other-than-jayce"],
              // 053.1/053.2 的 “besides me” 用自身排除；415.2 的 exhausted 状态。
              filter: { exclude: "self", states: "exhausted" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  }
});

const abilities: Ability[] = [
  {
    // 383.4.a：“When you play me” 是 Play Effect，时点 card-played、来源为自身。
    kind: "triggered",
    trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
    optional: true,
    body: [optionalReady("jayce-brilliant-inventor.play-me.may-ready")]
  },
  {
    // “or the first time you play a non-token gear each turn”：独立触发条件，
    // Nth-Time 许可用 once: "per-turn"（383.1.b）；185.1.a 的 token 性质被排除。
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: {
        event: "card-played",
        filter: { type: "gear", isToken: false, controller: "self" }
      },
      once: "per-turn"
    },
    optional: true,
    body: [optionalReady("jayce-brilliant-inventor.first-gear.may-ready")]
  }
];

export default {
  canonicalCardId: "card.hash-68f65f2c819cd1b15484ed93f4ae25ec20c4d71f4e4bd05d3a48672d492f5408",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口（2026-10-17 RIFT-613 复核实测）：(1) 触发注册与消费已合入：registerProgramTriggers 把 triggered " +
    "能力注册成 TriggerRegistration，事件管线扫描 card-played，TriggerSpec.once 的 per-turn 频率由 " +
    "pipeline.consume 在 Finalize 消费（play-me 半有探针证据）；(2) 非目标 pick 没有生产解析入口：" +
    "chain/engine.ts 的 Finalize 只调用 finalizeOrderedPickPlans，chain/picks/plan.ts 的 orderedPickSpecs " +
    "只接受 zoneSlice / linked 来源型 PickSpec，本卡的 filter 型 pick（exclude:self + states:exhausted）" +
    "不会进 plan，ctx.picks(id) 解析为空、静默不 ready 任何对象；target/target-plan.ts 的 finalizePick " +
    "只有单元测试调用，生产链路无调用方。(3)「non-token gear」的过滤器翻译失败：translateTriggerFilter " +
    "摊平嵌套 event filter 后交给 translateObjectFilter，后者拒绝 isToken，实测 registerProgramTriggers 抛 " +
    "ProgramBindingError \"Unsupported filter field isToken\"，gear 半无法注册并使整张卡的触发注册中止" +
    "（triggerRegistrations 对 abilities 做 flatMap）。effect.ready 与 choice.optional 本体已合入，golden 用" +
    "真实解释器 + 参考内核执行接受/拒绝两条路径；不近似实现（不把\"something besides me\"改成来源自身，" +
    "也不把非目标选择写成 TargetSpec）。依赖 filter 型 PickSpec 的生产解析管线与 isToken 过滤支持。",
  abilities,
  sourceText:
    "When you play me or the first time you play a non-token gear each turn, you may ready " +
    "something besides me that's exhausted."
} satisfies CardProgram;
