import type { CardProgram } from "../../ir/index.js";

/**
 * Fallen Feline (ven-132-166) — Unit, 2 Energy + 1 Order Power, 3 Might,
 * Order, Cat/Piltover.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-132-166，逐字）：
 *   When you play me, name a spell.
 *   While I'm at a battlefield, opponents can't play spells with that name.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a：“When you play me” 是打出触发，时点 card-played，过滤自身。
 * - 759/760/761：命名（Naming Cards）是游戏效果要求玩家声明一个牌名；762/762.1
 *   要求只能命名本赛制合法的牌。命名结果需要作为链接值保留，供后续静态限制读取。
 * - “While I'm at a battlefield, opponents can't play spells with that name” 是
 *   静态禁止（continuous.restrict，survey 第 4 节的 continuous.restrict 族）：
 *   条件为宿主在战场上，禁止内容为对手不能打出该名称的法术；需要读取宿主链接值里
 *   记录的牌名，并由 chain 的 canAct 在 Finalize 校验时执行。
 *
 * status = judge-required（两处缺口均不近似实现）：
 * 1. 没有“命名卡牌”原语（choices 集合只有 optional / mode / select-objects /
 *    order / number，命名需要一个由玩家输入牌名的选择；Naming 的合法性校验按
 *    762.1 需要卡池），effects/instructions 下也没有 choice.name / effect.name-card；
 * 2. “对手不能打出该名称的法术”是静态禁止，封闭 GameAction 集合没有“禁止打出”
 *    动作，也没有卡牌侧 continuous.restrict 原语的注册入口，chain 的 canAct 只读取
 *    已合入的语义注册表。依赖 RIFT-87/89 与 continuous.restrict 原语落地。
 * 本程序保留触发结构；命名与禁止以有依据的形状记录，不近似实现。
 */
export default {
  canonicalCardId: "card.hash-e308123735feeaeba45468a3883162bc0278fffe1ef3374615c10a8647de047c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) “name a spell” 需要命名原语——契约的 ChoiceRequest 只有 optional / mode / " +
    "select-objects / order / number，命名需要一个由玩家给出牌名的选择；effects/instructions 下没有" +
    "choice.name / effect.name-card 文件，762.1 的“只能命名本赛制合法的牌”还需要卡池校验；" +
    "(2) “opponents can't play spells with that name” 属 continuous.restrict 静态禁止，封闭 " +
    "GameAction 集合没有“禁止打出”动作，卡牌程序也没有注册进 layers / chain 的入口（chain 的 canAct " +
    "只读取已合入的语义注册表）。依赖命名原语、RIFT-89（chain 时机/校验接线）与 continuous.restrict" +
    "原语落地。程序保留 card-played 触发结构与有依据的禁止形状，不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { self: true } },
      optional: false,
      body: [
        {
          // “name a spell”：命名结果经链接值 `namedCard` 传给下面的静态限制。
          // 原语未合入（见 judgeReason）。
          id: "fallen-feline.name-a-spell",
          op: "choice.name",
          args: {
            kind: { kind: "constant", value: "spell" },
            linkKey: { kind: "constant", value: "namedCard" }
          }
        }
      ]
    },
    {
      // “While I'm at a battlefield”：宿主位置条件；“opponents can't play
      // spells with that name”：禁止项读取宿主命名结果（连续限制，不进链）。
      kind: "static",
      effect: {
        kind: "continuous.restrict",
        mode: "cannot-play",
        appliesTo: "opponent",
        subject: { kind: "constant", value: { type: "spell" } },
        // 被禁止的牌名来自上面命名指令写入的链接值：`namedFrom` 是描述性依赖
        // 记录（命名原语与静态限制的消费方都未合入，不写成假的可执行表达式）。
        namedFrom: { instructionId: "fallen-feline.name-a-spell", key: "namedCard" }
      },
      condition: {
        kind: "compare",
        left: {
          kind: "object-property",
          object: "self",
          property: "location"
        },
        operator: "ne",
        right: { kind: "constant", value: null }
      }
    }
  ],
  sourceText:
    "When you play me, name a spell.\n" +
    "While I'm at a battlefield, opponents can't play spells with that name."
} satisfies CardProgram;
