import type { CardProgram } from "../../ir/index.js";

/**
 * Walking Roost (unl-130-219) — Unit, Chaos, tag Shadow Isles。
 * catalog：energy 5、power null（无印刷力量）、might 6。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-130-219，逐字）：
 *   [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or
 *   ability.)
 *   When you play me, choose an opponent. They play a 1 :rb_might: Bird unit
 *   token with [Deflect].
 *
 * 规则依据（CR v1.5）：
 * - [Deflect]（809.1–809.3）：被动关键词，未印数值时按 809.1.b.3 视为 1，叠加按 809.2
 *   求和。卡内只声明 `{ kind: "keyword", keyword: "deflect" }`；展开（静态 target.tax）
 *   由 effects/keywords/Deflect.ts 负责，目标税由 RIFT-90 的目标管线收取。
 * - “When you play me” 是 Play Effect（383.4.a.1/383.4.a.2），时点 card-played、filter
 *   指向自身。
 * - “choose an opponent”：选择的是玩家而不是游戏对象（355.7：指名 Player）。契约 3.6 的
 *   targets() 只返回 ObjectRef[]，没有玩家目标形状；PickSpec.options 是静态值数组，
 *   IR 里也无法静态列出对局中的 PlayerId（同 ogn/mindsplitter、rad/suave-negotiator 的
 *   记录：缺 target.player 原语）。
 * - “They play a 1 [M] Bird unit token with [Deflect]”：187.7 定义的 1 [M] Bird token
 *   （无域、1 Might、Bird 标签、带 Deflect）；被“打出”的新 token 先在链上创建再走打出
 *   流程（440.2.c / 185.2.a / 350.2 / 354），由 effect.token 的 mode "play" 交付。
 *   该 token 的 Deflect 是它自身的印刷关键词，卡内不能为它写展开。“They” 指前一句选定的
 *   对手，因此该指令 linkedTo 前一条选择（同 ogn/mindsplitter 的写法）。token 的落点是
 *   “该对手的基地”（440.4 的控制者 = 被选中的对手），本程序按 ogn/altar-to-unity 与
 *   rad/cataclysm 的 fail-closed 先例写成描述性地点标记：effect.token 只接受具体的
 *   LocationRef，遇到不存在的座位名会 negated，绝不会把 token 造到错误玩家的基地。
 *
 * status = judge-required（缺口不近似实现）：
 * - effect.token 的冻结定义表（recruit / sand-soldier / mech / reflection / tentacle）
 *   没有 bird；对 "bird" 执行会得到 negated/blockedReason: token-definition-or-abilities-
 *   judge-required。187.7 的 Bird token 必须带 Deflect 关键词，不能拿一个无关键词的近似
 *   token 顶替；
 * - “choose an opponent” 没有已合入的玩家选择原语（target.player），因此“由该对手打出该
 *   token”（440.4 的控制者确定）也无法落地：token 的控制者是效果控制者，与印刷语的
 *   “They play” 不同，不能用“我来打”近似。
 * 可执行的部分是触发结构、选择链与 Deflect 关键词身份；golden 断言这些结构与关键词身份。
 *
 * 依赖：RIFT-84（kw-deflect 展开已合入、Hide 族未定）、RIFT-9/父任务（target.player 玩家
 * 选择原语与 effect.token 的 Bird 定义）、RIFT-90（target.tax 收取 Deflect 附加费用）。
 */
export default {
  canonicalCardId:
    "card.hash-51c4e6e520ee820d879fd83a63fbe09eed92fc00f5b8f7db1f68e18dd93f2154",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) 「a 1 [M] Bird unit token with [Deflect]」需要 CR 187.7 的 Bird 定义（无域、1 Might、" +
    "Bird 标签、带 Deflect），但 effect.token 的冻结定义表只有 recruit/sand-soldier/mech/reflection/tentacle，" +
    "对 bird 执行会 negated/blockedReason: token-definition-or-abilities-judge-required；不能拿无关键词的近似 " +
    "token 顶替（187.7 的 Deflect 是印刷关键词，卡的 body 不得自带展开）。" +
    "(2) 「choose an opponent」是玩家选择（355.7：指名 Player），契约 3.6 的 targets() 只返回 ObjectRef[]、" +
    "PickSpec.options 是静态值数组，IR 无法静态列出对局中的 PlayerId（缺 target.player 原语，同 mindsplitter / " +
    "suave-negotiator 的记录），因此 440.4「由该对手打出该 token」的控制者语义无法落地，也不能改成“由我打出”近似。" +
    "Deflect 关键词本身（809，未印数值按 809.1.b.3 视为 1）在 golden 中断言身份；目标税收取依赖 RIFT-90。" +
    "依赖：effect.token 的 Bird 定义、target.player 玩家选择原语、RIFT-90（target.tax）。",
  abilities: [
    { kind: "keyword", keyword: "deflect" },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          id: "walking-roost.choose-opponent",
          // 「choose an opponent」：玩家选择。本 op 未在 effects/instructions/ 实现
          // （target.player 缺口，见 judgeReason），链接值形状沿用已合入示例的键名。
          op: "target.player",
          args: {
            selection: { kind: "constant", value: "one" },
            chooser: { kind: "constant", value: "controller" },
            linkKey: { kind: "constant", value: "chosenOpponent" }
          }
        },
        {
          id: "walking-roost.play-bird",
          // “They play …” 的 They 指前一句选定的对手（355.7）：该指令依赖前一条选择的结果。
          linkedTo: "walking-roost.choose-opponent",
          // “They play a 1 [M] Bird unit token with [Deflect]” —— 440.2.c/185.2.a 的链上创建 +
          // 打出流程由 effect.token 的 mode "play" 声明；187.7 的 bird 定义缺失（见 judgeReason），
          // 因此在已合入内核上该指令会 negated，不会创建任何替代 token。
          // token 的落点与拥有者由被选中的对手决定：契约 3.6 没有 controller-relative
          // LocationRef 表达式，卡内不发明座位名，也不改成“由我打出”。
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "bird" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            // 描述性地点标记（不是可执行座位）：effect.token 要求具体 LocationRef，
            // 该值必然被拒绝（fail-closed），见最终回复的契约变更请求。
            location: {
              kind: "constant",
              value: { type: "base", player: "chosen-opponent" }
            },
            linkKey: { kind: "constant", value: "birdToken" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "When you play me, choose an opponent. They play a 1 :rb_might: Bird unit token with [Deflect]."
} satisfies CardProgram;
