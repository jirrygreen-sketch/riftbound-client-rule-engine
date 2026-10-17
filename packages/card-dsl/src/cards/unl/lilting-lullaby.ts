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
 * status = judge-required（2026-10-17 按当前合入源码复核，缺口已实测，不近似实现）：
 * 1. 禁止的消费方已经合入：layers/rules/query.ts 的 restrictions() 能读回注册的
 *    play-spell 禁止，chain/engine.ts 的 actionIsRestricted 在 execute() 时查询它并拒绝
 *    （实测：注册 controller: <玩家> 的禁止后，该玩家打出法术抛
 *    "Action is restricted by a continuous rule"，对手不受影响）。
 * 2. 剩余缺口是「Its controller」这个动态 referent：本卡用
 *    object-property({ target }, "controller") 表达被禁止的玩家，而 continuous.restrict 的
 *    appliesTo 必须是对象过滤器；解释器把该表达式求值成玩家 id 字符串后，原语实测抛
 *    TypeError "continuous.restrict appliesTo must be an object filter"，整个结算体都不落地
 *    （scoped.continuousEffects 为空）。把该玩家写死成字面值是可行的，但那不是卡面语义，
 *    所以不近似实现。
 * 3. Counter 半段只用已合入的 effect.counter；golden 用真实原语在参考内核上执行
 *    （链上法术被反制并清出链），局部执行不构成整卡证据。
 */

/**
 * 持续禁止声明（见 judgeReason 第 1 点）：原语已经合入，但目标法术 controller 的
 * 动态引用与 chain 许可消费仍未闭合，不近似为"结算时再检查一次"或任何时点替代。
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
    "剩余唯一缺口是「Its controller」的动态引用（2026-10-17 实测）：" +
    "(1) 禁止的消费方已合入——layers/rules/query.ts 的 restrictions() 能读回注册的 play-spell 禁止，" +
    "chain/engine.ts 的 actionIsRestricted 在 execute() 时查询并拒绝（注册后该玩家打出法术抛 " +
    "\"Action is restricted by a continuous rule\"，对手不受影响）。" +
    "(2) 但本卡用 object-property({ target }, \"controller\") 表达被禁止的玩家（359.3.f.1 的 referent），" +
    "而 continuous.restrict 的 appliesTo 必须是对象过滤器：解释器把该表达式求值成玩家 id 字符串后，" +
    "原语实测抛 TypeError \"continuous.restrict appliesTo must be an object filter\"，整个结算体都不落地。" +
    "把该玩家写死成字面值可以跑通，但那样表达的不是卡面语义，所以不近似实现。" +
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
