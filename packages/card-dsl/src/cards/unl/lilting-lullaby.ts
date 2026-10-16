import type { CardProgram } from "../../ir/index.js";

/**
 * Lilting Lullaby (unl-190-219) — Spell, 2 energy + 2 power, Calm/Mind,
 * tags Lillia / Signature.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-190-219，逐字）：
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)\n"
 *   "Counter a spell. Its controller can't play spells this turn."
 *
 * 规则依据（CR v1.5）：
 * - [Reaction]（813.1 / 813.1.c）是许可类关键词，卡牌只声明（契约 3.7 / 3.5）。
 * - "Counter a spell"：被反制的法术是链上的已 Finalize 对象（355.9.a.2），因此是目标；
 *   法术不能以自己为目标（355.9.c），Pending 链项不是合法目标（契约 3.4）；
 *   effect.counter（426.1–426.3）提交封关闭合集合里的 counter 动作。
 * - "Its controller can't play spells this turn"：这是本回合对那名玩家打出法术的持续禁止，
 *   属 chain 的时机许可查询（355.8 / 806 / 159.2）与到期时点；ability-templates 把
 *   "不能 / 必须 / 仅可" 归到 continuous.restrict / continuous.permission 一类。
 *
 * status = judge-required（不近似实现）：
 * 1. "can't play spells this turn" 没有消费方：effects/instructions 没有
 *    continuous.restrict 这类原语，layers/ 目前只消费 copy / arithmetic / 关键词 / 移动图层，
 *    chain 的 canAct 也不读任何禁止声明（依赖 RIFT-91 layers-continuous 与链的许可查询）。
 * 2. "Its controller" 要被禁止的玩家由目标法术的控制者决定：程序用
 *    object-property({ target }) 的 controller 表达（359.3.f.1 的 referent 读取），但需要
 *    持续禁止的消费者（第 1 点）才能落地。
 * 3. Counter 半段本身只用已合入的 effect.counter；golden 用真实原语在参考内核上执行
 *    （链上法术被反制并清出链），局部执行不构成整卡证据。
 */

/**
 * 描述性的持续禁止声明（见 judgeReason 第 1 点）：effects/instructions 没有
 * continuous.restrict 原语，layers/ 与 chain 也没有该声明的消费者；参数形状沿用
 * rad/cataclysm 的既有写法，不近似为"结算时再检查一次"或任何时点替代。
 */
const CANT_PLAY_SPELLS = {
  mode: "prohibit",
  action: "play-spell",
  duration: "this-turn"
} as const;

export default {
  canonicalCardId: "card.hash-0fd730fbefcd79781194c269d2e2a4c9e610d42a403c6f112d892d3bf8f1a3fe",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺持续禁止的消费者与到期处理：(1) “Its controller can't play spells this turn” 是本回合对该玩家的打出禁止，" +
    "能否打出属于 chain 的时机许可查询（355.8 / 806 / 159.2），但 effects/instructions 没有 continuous.restrict 这类原语，" +
    "layers/ 也没有禁止声明的消费方，chain 的 canAct 不读任何禁止声明（依赖 RIFT-91 layers-continuous 与链许可查询）。" +
    "(2) 被禁止的玩家是 “Its controller”，由目标法术的控制者在结算时读取（359.3.f.1 的 referent），需要第 1 点的持续效果才能落地。" +
    "counter 半段（effect.counter，426.1–426.3）与目标合法性（355.9.a.2 链上法术、355.9.c 不能以自己为目标、契约 3.4 排除 Pending 链项）" +
    "已合入，golden 用参考内核真实执行反制；局部执行不构成整卡证据。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          id: "lilting-lullaby.counter-spell",
          op: "effect.counter",
          args: {
            target: { kind: "constant", value: "lilting-lullaby.spell" },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "lilting-lullaby.spell",
              // “a spell” 指链上的已 Finalize 法术（355.9.a.2）。“a spell” 是
              // 具体对象选择（355.5），因此是目标而不是 pick。
              filter: { type: "spell", zone: "chain" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // “Its controller can't play spells this turn” 是独立语句（与反制无
          // “do X to Y” 依赖，055 / 359.3.e.11 能做什么做什么），因此不 linkedTo；
          // 禁止声明的形状保留在这里，消费者见 judgeReason 第 1 点。
          id: "lilting-lullaby.no-spells",
          op: "continuous.restrict",
          args: {
            mode: { kind: "constant", value: CANT_PLAY_SPELLS.mode },
            action: { kind: "constant", value: CANT_PLAY_SPELLS.action },
            appliesTo: {
              kind: "object-property",
              object: { target: "lilting-lullaby.spell" },
              property: "controller"
            },
            duration: { kind: "constant", value: CANT_PLAY_SPELLS.duration }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Counter a spell. Its controller can't play spells this turn."
} satisfies CardProgram;
