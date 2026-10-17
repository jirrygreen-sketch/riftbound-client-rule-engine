import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ultrasoft Poro (unl-160-219) — Unit, Order, energy 5, Might 5,
 * tags Poro/Freljord.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-160-219，逐字）:
 *   ":rb_exhaust:: Play two :rb_energy_1: :rb_might: Bird unit tokens with
 *    [Deflect]. Use this ability only while I'm at a battlefield. (Opponents
 *    must pay :rb_rune_rainbow: to choose a [Deflect] unit with a spell or
 *    ability.)"
 *
 * 规则依据（CR v1.5）:
 * - 404.1.a / 415.5：冒号前的 ":rb_exhaust:" 是费用"横置我自己"（cost.exhaust 与
 *   费用计划已合入）；145.1 / 145.2 规定单位的启动式能力在控制者 Main Phase 的
 *   Open State 执行，本卡没有 [Reaction]，按默认 action 时机声明。
 * - "Use this ability only while I'm at a battlefield."：这是启动能力的许可限制
 *   （305/146.1 的位置：Base 或 Battlefield），按契约 3.1 的 restriction
 *   与 Requirement 分开建模，声明为 use-only-while-at-battlefield；Finalize 的
 *   合法性校验归链/目标批次。
 * - "Play two … Bird unit tokens with [Deflect]"：187.7 规定 1 [M] Bird token 是
 *   无域单位 token、1 Might、Bird 标签、带 Deflect 关键词；文本里的括号是
 *   Deflect（809）的提示文字，不是本卡的额外能力。新 token 由链上生成后打出
 *   （185.2.a / 440.2.c / 350.2 / 354），对应 effect.token 的 mode "play"，后续
 *   打出流程由链管线接手；本卡文本没有 "here"，打出位置按 355.2 在 Finalize 由
 *   玩家选择合法位置。
 *
 * status = judge-required（缺口不近似实现）:
 * 1. effect.token 的冻结定义表只有 recruit / sand-soldier / mech / reflection /
 *    tentacle（effect.token.ts 的 DEFINITIONS），没有 187.7 的 bird 定义，
 *    因此 token 定义必须由令牌批次补齐；不拿 Mech 等近似。
 * 2. mode "play" 已合入：effect.token 在链上生成 token 后接打出流程（见
 *    effect.token.ts 的 play 分支）；本卡剩下的是 bird 定义与合法位置。
 * 3. 打出位置已可由 LocationTargetSpec + target-location 在结算时选择并链接到
 *    effect.token；battlefield-only restriction 的消费方仍缺。
 *
 * 依赖：effect.token 定义表扩展（187.7 的 Bird token）与 battlefield-only restriction
 * 校验；费用计划已合入。
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    timing: "action",
    // 415.5：":rb_exhaust:" 是"横置我自己"的费用。
    cost: { kind: "activated", payments: [{ kind: "exhaust", object: "self" }] },
    restriction: { kind: "use-only-while-at-battlefield" },
    body: [
      {
        id: "ultrasoft-poro.choose-location",
        op: "condition.value",
        locations: [
          {
            id: "ultrasoft-poro.token-location",
            type: "any",
            controller: "controller",
            min: 1,
            max: 1,
            selection: "one"
          }
        ],
        args: {
          value: {
            kind: "location",
            value: { kind: "target-location", target: "ultrasoft-poro.token-location" }
          },
          key: { kind: "constant", value: "location" }
        }
      },
      {
        id: "ultrasoft-poro.play-birds",
        linkedTo: "ultrasoft-poro.choose-location",
        op: "effect.token",
        args: {
          // 187.7：1 [M] Bird token = 无域单位 token、1 Might、Bird 标签、带
          // [Deflect]；冻结定义表尚无该条目（见 judgeReason）。
          token: { kind: "constant", value: "bird" },
          amount: { kind: "constant", value: 2 },
          // 185.2.a / 440.2.c："Play … token" 先在链上生成再打出；mode "play"
          // 的该通路在 effect.token 中已合入。
          mode: { kind: "constant", value: "play" },
          // 355.2 的合法位置由这个 LocationTargetSpec 选择并通过链接值传给打出流程；
          // 不把"己方 Base"或"来源所在战场"写死为唯一位置。
          location: {
            kind: "linked-value",
            instructionId: "ultrasoft-poro.choose-location",
            key: "location"
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-0e1d827782e2bd5c511ab700781d7a29ff0550a164e043183998c20b7d09d1f2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) effect.token 的冻结定义表（effect.token.ts 的 DEFINITIONS：recruit / sand-soldier / " +
    "mech / reflection / tentacle）没有 187.7 的 1 [M] Bird token（无域单位 token、1 Might、Bird 标签、带 [Deflect]），" +
    "本卡声明的 token id bird 无法解析，原语按契约 negated 并写 blockedReason，不拿 Mech 等既有定义近似。" +
    "(2) 「Use this ability only while I'm at a battlefield」的 restriction 仍没有启动许可消费方；" +
    "打出位置已由 LocationTargetSpec + target-location 在结算时选择。" +
    "已可执行部分：:rb_exhaust: 自身的费用（415.5）由已合入的费用管线真实支付，golden 覆盖；" +
    "mode \"play\" 的链上生成 + 打出（185.2.a / 440.2.c / 350.2 / 354）也已合入。" +
    "依赖：effect.token 定义表扩展（187.7）与 battlefield-only restriction 的消费方。",
  abilities,
  sourceText:
    ":rb_exhaust:: Play two :rb_energy_1: :rb_might: Bird unit tokens with [Deflect]. " +
    "Use this ability only while I'm at a battlefield. " +
    "(Opponents must pay :rb_rune_rainbow: to choose a [Deflect] unit with a spell or ability.)"
} satisfies CardProgram;

export default program;
