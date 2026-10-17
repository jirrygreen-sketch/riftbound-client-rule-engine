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
 * Status: judge-required (rechecked 2026-10-17 with executed evidence).
 * The controller-base location expression and its capture into effect.token are
 * merged and executed by the golden. Two gaps remain observable:
 * - effect.token's frozen DEFINITIONS table has no `bird` entry (187.7), so the
 *   card's own token id is negated with
 *   blockedReason "token-definition-or-abilities-judge-required" and no
 *   substitute token is created.
 * - programs/keywords.ts expands the declared [Deathknell] into its own trigger
 *   (body op `trigger.leave`, which is not a registered instruction) in
 *   addition to the card's printed effect, and nothing proves one death resolves
 *   the printed effect exactly once.
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
        id: "carrion-dredger.controller-base",
        op: "condition.value",
        args: {
          value: { kind: "location", value: "ability-controller-base" },
          key: { kind: "constant", value: "location" }
        }
      },
      {
        id: "carrion-dredger.play-bird-token",
        op: "effect.token",
        args: {
          // 187.7 的 1 [M] Bird（带 [Deflect]）：定义缺席（见文件头与 judgeReason）。
          token: { kind: "constant", value: "bird" },
          amount: { kind: "constant", value: 1 },
          // 185.2.a / 440.2.c：被“打出”的 token 先在链上创建，再交给 play 动作。
          mode: { kind: "constant", value: "play" },
          // 440.4：先解析能力控制者的 Base，再交给原语消费具体 LocationRef。
          location: { kind: "linked-value", instructionId: "carrion-dredger.controller-base", key: "location" },
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
    "缺 effect.token 的 CR 187.7 Bird 定义（无域、1 Might、Bird 标签、Deflect）：实测本卡 token 值 \"bird\" 返回 negated/impossible、" +
    "blockedReason \"token-definition-or-abilities-judge-required\"，且不创建任何替代 token；" +
    "另缺 Deathknell 展开体 trigger.leave 的 InstructionDef 与印刷效果正文绑定（808.1.c/808.1.d）：" +
    "registry.generated 无 trigger.leave，programs/keywords.ts 把它与本卡正文展开成两个 object-killed 触发（一个 body 为 trigger.leave、一个为本卡正文），" +
    "尚不能证明一次死亡只结算一次正文；不以其他 token 冒充 Bird。",
  abilities,
  sourceText:
    "[Deathknell][>] Play a 1 :rb_might: Bird unit token with [Deflect] to your base. " +
    "(When I die, get the effect. Opponents must pay :rb_rune_rainbow: to choose a [Deflect] unit with a spell or ability.)"
} satisfies CardProgram;
