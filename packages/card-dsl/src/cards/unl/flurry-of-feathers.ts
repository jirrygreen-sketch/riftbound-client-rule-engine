import type { CardProgram } from "../../ir/index.js";

/**
 * Flurry of Feathers（unl-044-219）— Spell，4 能量 + 2 Calm 力量，领域 Calm。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-044-219，逐字；本地数据在
 * "Counter a spell." 与 "Play four …" 之间没有空格或换行）：
 *   "[Reaction]\nChoose one —\nCounter a spell.Play four 1 :rb_might: Bird unit tokens " +
 *   "with [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose them with a spell " +
 *   "or ability.)"
 *
 * 规则依据（CR v1.5）：
 * - [Reaction]（813）是许可类关键词，按契约 3.7 只声明；时机许可的消费方属 chain/ 的
 *   canAct 与 continuous.timing 展开（RIFT-85/91）。
 * - 「Choose one —」是含项目符号的模式选择（355.3），按契约 3.9 用 choice.mode
 *   （count 1、different true），每个模式各带 body。
 * - 模式一「Counter a spell」：被反制的法术是链上目标（355.9.a.2；链项 Pending 状态不是
 *   合法目标，355.9.c 也禁止法术反制自己——两者都是 Finalize 目标系统的义务），以已合入的
 *   effect.counter 执行（426.1–426.3：被反制的牌什么都不做、从链上清除、费用不退还）。
 * - 模式二「Play four 1 :rb_might: Bird unit tokens with [Deflect]」：Bird token 的官方定义见
 *   187.7（无域、1 Might、Bird 标签、带 [Deflect] 关键词）；「Play … token」按 440.2.c /
 *   185.2.a 在链上生成后由打出流程接手，即已合入 effect.token 的 mode "play"。
 *   原文没有印刷目的地，入场地点按 355.2 / 355.2.a 在 Finalize 选择合法地点（440.2.b.1）。
 *
 * status = judge-required（README 第 2 节），两个缺口都不近似实现：
 * 1. Bird token 定义不在 effect.token 的冻结 DEFINITIONS 表（recruit / sand-soldier / mech /
 *    reflection / tentacle）；187.7 的 Bird 还自带 [Deflect] 关键词，带能力的 token 定义被该
 *    原语显式阻断（blockedReason: token-definition-or-abilities-judge-required）。
 * 2. 「Play … token」没有印刷目的地，入场地点是运行期 Location 选择（355.2 / 355.2.a /
 *    440.2.b.1）：合并 IR 没有运行期 Location 选择器，effect.token 只接受运行时 LocationRef、
 *    目标/选择的当前位置或静态候选列表；本卡保留描述性地点标记（依赖 RIFT-90）。
 * 3. 生产链的 Finalize 面还明确阻断嵌套目标与模式选择（chain/engine.ts
 *    assertFinalizationSurface 抛 ChainContractBlockedError），反制模式的目标位于
 *    choice.mode 的分支体内，因此生产打出路径还需解释器的目标选择生命周期适配器。
 * 反制模式只用已合入原语，golden 用参考内核锁定链上目标真实执行。
 * 依赖：effect.token 定义表扩充（187.7 Bird，含 Deflect）、RIFT-90（地点选择与嵌套目标生命周期）、
 * RIFT-85/91（时机许可）。
 */

/** 描述性地点标记，不是可执行 LocationRef（见 judgeReason 第 2 点）。 */
const CHOSEN_LOCATION = {
  kind: "location-selector",
  filter: { type: "location" }
} as const;

const flurryOfFeathers = {
  canonicalCardId: "card.hash-afac76ad6c5f670cc47f942343901c50caf6df49ccf238b5f8cf9b710906eba5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1) 187.7 的 1 :rb_might: Bird unit token（无域、1 Might、Bird 标签、带 [Deflect]）" +
    "不在 effect.token 的冻结 DEFINITIONS 表（recruit/sand-soldier/mech/reflection/tentacle），且带能力的 token 定义被该原语" +
    "显式阻断（blockedReason: token-definition-or-abilities-judge-required），[Deflect] 的展开（809）属 RIFT-84/90 批次；" +
    "(2)「Play four … tokens」没有印刷目的地，入场地点是运行期 Location 选择（355.2 / 355.2.a / 440.2.b.1），" +
    "合并 IR 没有运行期 Location 选择器，effect.token 只接受运行时 LocationRef / 目标或选择的当前位置 / 静态候选列表，" +
    "本卡只保留描述性地点标记（依赖 RIFT-90）。(3) 生产链的 Finalize 面阻断嵌套目标与模式选择" +
    "（chain/engine.ts assertFinalizationSurface 抛 ChainContractBlockedError），反制模式的目标位于 choice.mode 的分支体内，" +
    "生产打出还需解释器的目标选择生命周期适配器（依赖 RIFT-90 / RIFT-120）。反制模式（426.1-426.3）与 choice.mode" +
    "（355.3，契约 3.9）本身只用已合入原语，golden 用参考内核锁定链上目标真实执行。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 4 },
        // 印刷 2 点 Calm Power（domains: ["Calm"]）。
        power: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "flurry-of-feathers.choose-one",
          // 「Choose one —」：契约 3.9 的 choice.mode（count 1、different true），
          // 每个模式各带自己的 body；不写成 choice + linkedTo。
          op: "choice.mode",
          args: {
            count: { kind: "constant", value: 1 },
            different: { kind: "constant", value: true },
            modes: {
              kind: "constant",
              value: [
                {
                  id: "flurry-of-feathers.counter-mode",
                  body: [
                    {
                      id: "flurry-of-feathers.counter-spell",
                      op: "effect.counter",
                      args: {
                        target: { kind: "constant", value: "flurry-of-feathers.countered-spell" }
                      },
                      targets: [
                        {
                          id: "flurry-of-feathers.countered-spell",
                          // 355.9.a.2：「a spell」指链上已 Finalize 的法术。
                          filter: { type: "spell", zone: "chain" },
                          min: 1,
                          max: 1,
                          selection: "one"
                        }
                      ]
                    }
                  ]
                },
                {
                  id: "flurry-of-feathers.bird-tokens-mode",
                  body: [
                    {
                      id: "flurry-of-feathers.play-bird-tokens",
                      op: "effect.token",
                      args: {
                        token: { kind: "constant", value: "bird" },
                        amount: { kind: "constant", value: 4 },
                        // 440.2.c / 185.2.a：被「打出」的 token 先在链上生成，再由打出
                        // 流程接手。
                        mode: { kind: "constant", value: "play" },
                        // 355.2 / 355.2.a：入场地点在 Finalize 选择；描述性标记不是
                        // 可执行 LocationRef（见 judgeReason 第 2 点）。
                        location: { kind: "constant", value: CHOSEN_LOCATION },
                        linkKey: { kind: "constant", value: "birdTokens" }
                      }
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction]\nChoose one —\nCounter a spell.Play four 1 :rb_might: Bird unit tokens " +
    "with [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose them with a spell " +
    "or ability.)"
} satisfies CardProgram;

export default flurryOfFeathers;
