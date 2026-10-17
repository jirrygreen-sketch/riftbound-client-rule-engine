import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Carrion Dredger (unl-153-219) — Unit, Order, tags Mech/Zaun.
 * energy 2（power: null，无印刷力量费）, Might 1.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-153-219，逐字）：
 *   [Deathknell][>] Play a 1 :rb_might: Bird unit token with [Deflect] to your base.
 *   (When I die, get the effect. Opponents must pay :rb_rune_rainbow: to choose a [Deflect]
 *   unit with a spell or ability.)
 *
 * 规则依据（CR v1.5）：
 * - [Deathknell]（808.1/808.1.c：功能上等于 “When I die, [Effect]”；808.1.d / 429.1.a.1.b：
 *   死亡触发在替代处理后、实际换区前收集并作为 Pending 项入链）是触发式能力关键词；
 *   [Effect] 正文由卡牌程序持有，时点用封闭枚举的 object-killed。
 * - 187.7：1 [M] Bird 是无域、1 Might、Bird 标签并带 Deflect 的单位 token（reminder 与之逐字一致）；
 *   185.2.a / 440.2.c / 350.2 / 354：被“打出”的 token 先在链上创建，再交给打出流程完成。
 * - 809.1.b.3：token 上的 [Deflect] 省略数值 → 视为 1；Deflect 是 token 的印刷特征（187.7），
 *   不是由本效果另行授予的关键词。
 *
 * status = judge-required（缺口不近似实现；按当前 HEAD 复核）：
 * - effect.token 的冻结 DEFINITIONS 表只有 recruit/sand-soldier/mech/reflection/tentacle；187.7 的
 *   Bird 定义（带 Deflect 关键词）缺席，mode \"play\" 会以 blockedReason
 *   \"token-definition-or-abilities-judge-required\" 直接 negated。
 * - “to your base” 的目的地需要把 base 的 player 占位解析成当前控制者：effect.token 只接受
 *   具体 LocationRef { type: \"base\", player: <PlayerId> }，占位 \"controller\" 会被 negated/impossible
 *   （与 machine-evangel、altar-to-unity 记录的同一缺口）。
 * - Deathknell 的 KeywordDef 已合入并展开为 object-killed + trigger.leave，但 trigger.leave
 *   仍没有 InstructionDef/生产事件接线，因此死亡效果不能进入真实结算链。
 * 依赖：effect.token 的定义表扩展（187.7 Bird）、controller-relative base 解析，以及
 * trigger.leave 的事件/指令接线。不近似实现（不改成 Recruit 等既有定义冒充 Bird + Deflect）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deathknell" },
  {
    kind: "triggered",
    trigger: {
      at: "object-killed",
      filter: { self: true }
    },
    optional: false,
    body: [
      {
        id: "carrion-dredger.play-bird-token",
        op: "effect.token",
        args: {
          // 187.7 的 1 [M] Bird（带 [Deflect]）：定义缺席（见文件头与 judgeReason）。
          token: { kind: "constant", value: "bird" },
          amount: { kind: "constant", value: 1 },
          // 185.2.a / 440.2.c：被“打出”的 token 先在链上创建，再交给 play 动作。
          mode: { kind: "constant", value: "play" },
          // “to your base”：控制者的 Base；player 占位需由内核解析成当前控制者（见 judgeReason）。
          location: { kind: "constant", value: { type: "base", player: "controller" } },
          linkKey: { kind: "constant", value: "birdToken" }
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-eecb1b7c0e454c85db65c33eaab1cd2d826115fe40c063e70baa81ad2bf8a7d7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口（均不近似实现）：(1) effect.token 的冻结 DEFINITIONS 表只有 recruit/sand-soldier/mech/reflection/tentacle，" +
    "187.7 的 1 [M] Bird（无域、Bird 标签、带 [Deflect]）定义缺席——按该文件说明，自带能力/关键词的定义保持 " +
    "blocked/judge-required，mode \\\"play\\\" 会以 token-definition-or-abilities-judge-required 直接 negated。" +
    "(2) “to your base” 的 player 占位需要解析成当前控制者（440.4），已合入的 effect.token 只接受具体 LocationRef，" +
    "player: \\\"controller\\\" 占位会 negated/impossible（machine-evangel / altar-to-unity 记录同一缺口）。" +
    "(3) [Deathknell] 的 KeywordDef 已合入并展开为 object-killed + trigger.leave，但 trigger.leave " +
    "仍没有 InstructionDef/生产事件接线，死亡效果不能进入真实结算链。依赖：effect.token 的定义表扩展（187.7 Bird）、" +
    "controller-relative base 解析与 trigger.leave 接线。不近似实现（不用 Recruit 等既有定义冒充 Bird + Deflect）。",
  abilities,
  sourceText:
    "[Deathknell][>] Play a 1 :rb_might: Bird unit token with [Deflect] to your base. " +
    "(When I die, get the effect. Opponents must pay :rb_rune_rainbow: to choose a [Deflect] unit with a spell or ability.)"
} satisfies CardProgram;
