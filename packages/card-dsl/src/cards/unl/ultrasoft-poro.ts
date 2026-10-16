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
 *   合法性校验归链/目标批次（RIFT-90/120）。
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
 * 2. mode "play" 的链上生成 + 打出流程在冻结内核里被显式 block；本卡声明的
 *    bird 定义与 mode 只作为可审查形状。
 * 3. 打出位置：355.2 / 355.2.a 的合法位置由 Finalize 决定，而 effect.token 的
 *    location/locations 只接受调用方给出的闭集合（没有"按 355.2.a 求值默认
 *    合法位置"的通路），这里的 locations 占位符不能解析成位置，保持 fail-closed。
 *
 * 依赖：RIFT-62（链上 token 创建与打出）、effect.token 定义表扩展（187.7 的
 * Bird token）、RIFT-90（位置合法性与 Finalize）与 RIFT-89（费用计划接线）。
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
        id: "ultrasoft-poro.play-birds",
        op: "effect.token",
        args: {
          // 187.7：1 [M] Bird token = 无域单位 token、1 Might、Bird 标签、带
          // [Deflect]；冻结定义表尚无该条目（见 judgeReason）。
          token: { kind: "constant", value: "bird" },
          amount: { kind: "constant", value: 2 },
          // 185.2.a / 440.2.c："Play … token" 先在链上生成再打出。
          mode: { kind: "constant", value: "play" },
          // 355.2 的合法位置由 Finalize 决定；这个条目是"由打出流程给出合法位置"
          // 的占位记录，不是合法 LocationRef，原语会 negated（fail-closed），
          // 不把"己方 Base"或"来源所在战场"当成印刷位置。
          locations: { kind: "constant", value: ["valid-location-for-play"] },
          choiceId: { kind: "constant", value: "ultrasoft-poro.token-location" }
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
    "三处缺口：(1) effect.token 的冻结定义表（effect.token.ts 的 DEFINITIONS：recruit / sand-soldier / " +
    "mech / reflection / tentacle）没有 187.7 的 1 [M] Bird token（无域单位 token、1 Might、Bird 标签、带 [Deflect]），" +
    "本卡声明的 token id bird 无法解析，原语按契约 negated 并写 blockedReason，不拿 Mech 等既有定义近似。" +
    "(2) mode play 的链上生成 + 打出（185.2.a / 440.2.c / 350.2 / 354）在冻结内核里被显式 block（RIFT-62 已记录）。" +
    "(3) 打出位置：355.2 / 355.2.a 规定单位打出的合法位置（Base 或己方战场等）在 Finalize 由玩家选择，" +
    "而 effect.token 的 location/locations 只接受调用方给出的闭集合，没有「按默认合法位置求值」的通路；" +
    "本卡的 locations 占位符不能解析成位置，保持 fail-closed，不把 Base 或来源所在地当作印刷位置。" +
    "另：「Use this ability only while I'm at a battlefield」的 restriction 形状已声明，Finalize 的位置许可校验属链/目标批次。" +
    "已可执行部分：:rb_exhaust: 自身的费用（415.5）由已合入的费用管线真实支付，golden 覆盖。" +
    "依赖：RIFT-62、effect.token 定义表扩展（187.7）、RIFT-90（位置合法性）、RIFT-89（费用接线）。",
  abilities,
  sourceText:
    ":rb_exhaust:: Play two :rb_energy_1: :rb_might: Bird unit tokens with [Deflect]. " +
    "Use this ability only while I'm at a battlefield. " +
    "(Opponents must pay :rb_rune_rainbow: to choose a [Deflect] unit with a spell or ability.)"
} satisfies CardProgram;

export default program;
