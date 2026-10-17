import type { CardProgram } from "../../ir/index.js";

/**
 * Satchel Charge（rad-096-167）— Spell，3 能量 + 1 Chaos 力量，领域 Chaos。
 *
 * 原文（packages/card-data/data/deck-catalog.json rad-096-167，逐字）：
 *   "[Action] (Play on your turn or in showdowns.)
 *    Move a friendly unit, then play a Bomb gear token to a battlefield. (It has
 *    [Deploy]. When it dies, deal 2 to an enemy there and kill your other Bombs there.)"
 *
 * 规则依据（CR v1.5）：
 * - [Action]（806）是许可类关键词，展开由关键词注册表负责（契约 3.7），卡牌只声明。
 * - 「Move a friendly unit」是效果移动（451，不是 Standard Move 144、不是 Recall 457）：
 *   被移动的友方单位是目标（355.10 / 355.9.a.1）。原文没有印刷目的地，目的地按 355.4 /
 *   355.4.a 在结算时作为「另一个该单位可存在的位置」被选择（451.1 由移动来源给出合法性限制）。
 * - 「then」只是顺序词（055 / 359.3.e.11 能做什么做什么），不是条件，因此两条指令不 linkedTo。
 * - 「play a Bomb gear token to a battlefield」：Bomb 是 CR 187.12 定义的 gear token
 *   （带 [Deploy] 与 [Deathknell][>] Deal 2 to an enemy here and kill your other Bombs here），
 *   被「打出」的 token 按 440.2.c / 185.2.a 先在链上生成再由 play 接手；reminder 里的
 *   [Deploy] / [Deathknell] 是 token 自身能力（187.12），不是本卡的独立指令。
 *
 * status = judge-required（不近似实现），按合入后的 [Action] 关键词、effect.move /
 * effect.token 原语与 src/programs/*（打出/关键词绑定）复核：
 * 1. Bomb 的定义仍不在 effect.token 的 DEFINITIONS 表（recruit / sand-soldier / mech /
 *    reflection / tentacle）；带自身能力的 token（含 Bomb、Gold，CR 187.5 / 187.12）
 *    被 effect.token 显式阻断（blockedReason: token-definition-or-abilities-judge-required）。
 *    这是 token 定义表扩充的依赖，不是 IR 形状问题。
 * 2. 目的地仍是运行期选择（355.4 / 355.4.a）：effect.move 的 to 与 effect.token 的
 *    location 都只接受静态 LocationRef、controller-base 或静态候选列表
 *    （effect.move 的 destination() / effect.token 的 locations 参数），没有把
 *    「满足 451.1 合法性限制的其他可落点」求值进 IR 的通道；本卡保留描述性目的地标记，
 *    解释器会拒绝该形状而不是落到错误地点。
 * 3. [Action] 关键词（keywords/Action.ts）与 effect.move / effect.token
 *    原语本身已合入，被移动的友方单位按 355.10 / 355.9.a.1 声明为目标，golden 对
 *    Move 半段与 Bomb 阻断路径做真实执行。
 *
 * 依赖：token 定义表扩充（Bomb，187.12）、运行期 Location 选择通道。
 */

/** 描述性目的地标记，不是可执行 LocationRef（见 judgeReason 第 2 点）。 */
const CHOSEN_LOCATION = {
  kind: "destination-selector",
  filter: { type: "battlefield" }
} as const;

const satchelCharge = {
  canonicalCardId: "card.hash-2e3a1c21d595d016a01ef7ca0dac47ff84bd3742a4ce60df418cdaed35983366",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) Bomb gear token（CR 187.12，带 [Deploy] 与 [Deathknell] 的自身能力）" +
    "不在 effect.token 的 DEFINITIONS 表，带能力的 token 定义被 effect.token 显式阻断" +
    "（blockedReason: token-definition-or-abilities-judge-required）。(2)「Move a friendly unit」没有印刷目的地，" +
    "目的地按 CR 355.4 / 355.4.a / 451.1 在结算时选择，而没有把「满足 451.1 合法性限制的其他可落点」求值进 IR 的通道：" +
    "effect.move 的 to 与 effect.token 的 location 都只接受静态 LocationRef / controller-base / 静态候选列表，" +
    "本卡只保留描述性目的地标记（解释器 fail-closed，不会落到错误地点）。" +
    "[Action] 关键词与 effect.move / effect.token 原语本身已合入；被移动的友方单位按 355.10 / 355.9.a.1 声明为目标，" +
    "Move 半段与 Bomb 阻断路径由 golden 真实执行。依赖：token 定义表扩充（187.12）、运行期 Location 选择通道。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // 「Move a friendly unit」：目标已声明；目的地是未合入的运行期选择（见 judgeReason）。
          id: "satchel-charge.move-unit",
          op: "effect.move",
          args: {
            objects: {
              kind: "constant",
              value: { target: "satchel-charge.friendly-unit" }
            },
            to: { kind: "constant", value: CHOSEN_LOCATION },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "satchel-charge.friendly-unit",
              filter: { type: "unit", controller: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 「then play a Bomb gear token to a battlefield」：effect.token 的 play 路径已合入
          // （440.2.c / 185.2.a 链上生成后由 play 接手），但 Bomb 定义仍缺失（187.12），
          // 目的地也仍是运行期战场选择（见 judgeReason）。
          id: "satchel-charge.play-bomb-token",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "bomb" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: CHOSEN_LOCATION },
            linkKey: { kind: "constant", value: "bombToken" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Move a friendly unit, then play a Bomb gear token to a battlefield. (It has [Deploy]. " +
    "When it dies, deal 2 to an enemy there and kill your other Bombs there.)"
} satisfies CardProgram;

export default satchelCharge;
