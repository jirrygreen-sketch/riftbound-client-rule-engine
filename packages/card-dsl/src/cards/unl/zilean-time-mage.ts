import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Zilean, Time Mage (unl-086-219) — Unit, 5 energy + 1 Mind power，Might 5，Mind，
 * 标签 Icathia/Zilean/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-086-219，逐字）：
 *   Once each turn, if you would play a token unit while I'm at a battlefield,
 *   you may play that token and an additional copy of it instead.
 *
 * 规则依据（CR v1.5）：
 * - “if you would play … instead”：替代效果（369.1 / 370.1–370.3：would…instead 的替代族），
 *   拦截的是“打出 token 单位”这个事件本身；CR 375 的示例（Treasure Hunter 的 Gold gear token
 *   与 “if you would play a token gear, play that token and an additional copy instead”）
 *   正是本类文本，说明替代后的额外副本继承原事件的修正（375 / 375.1）。
 * - “a token unit”：被替代事件的对象是 token 单位（181/185 的 token 定义）。
 * - “while I'm at a battlefield”：替代效果只在来源位于战场时适用（464.2.b 的 here 位置判定；
 *   她在基地时该替代不生效）。
 * - “Once each turn”（383.3.e / 386 / 386.1）：每回合只应用一次。
 * - “you may”：该替代是可选应用（383.3.e.2 的许可语义作用于替代的“may”，消费者按
 *   370.1 的替代应用规则处理）。
 *
 * status = judge-required（缺口均不近似实现）：
 * - 契约 3.1 的 ReplacementAbility 只有 replaces / with / condition，没有
 *   “once each turn” 的频度字段（TriggerSpec.once 不适用于替代），也没有可选应用字段。
 * - 替代的 with 体必须引用「被替代事件里的那个 token 单位」并同时执行“打出原 token + 打出
 *   一个副本”；冻结的 ObjectSelector（self / source / target / pick / linked）没有事件对象
 *   形态，而且 effect.copy 的 play 模式被显式阻断（copy-action-cannot-create-a-pending-chain-object），
 *   引擎替代管线（events/pipeline.ts）也只支持 replaced / prevented / impossible，
 *   不能把一次 play 改写为两次 play。
 * - “while I'm at a battlefield” 需要在替代应用时读取来源当前位置，替代管线目前不消费
 *   condition 的位置判定（RIFT-91 / RIFT-120）。
 * 依赖：替代管线的事件对象绑定与频度/可选字段（契约变更请求 + RIFT-120）、RIFT-89（play 费用与
 * 打出流程）、RIFT-91（位置判定）。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    // “if you would play a token unit”：替代一个 play 事件，对象是 token 单位。
    // token: true 是本程序描述“是 token”的过滤维度（与 rally-for-war 的 occupied 同型），
    // 当前没有消费方求值它（见 judgeReason）。
    replaces: {
      event: "play",
      filter: { type: "unit", token: true, controller: "self" }
    },
    // “while I'm at a battlefield”：来源位置的适用条件；替代管线不消费 condition 的位置判定。
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "source-at-a-battlefield" }
    },
    with: [
      {
        id: "zilean-time-mage.play-token-and-additional-copy",
        // “play that token and an additional copy of it instead”：把一次 token 打出改写为两次
        // （原 token + 一个副本）。该共同体没有已注册原语：effect.copy 的 play 模式被显式阻断，
        // 替代管线也不能产生第二次 play；这里保留精确的待接线形状，不近似实现。
        op: "replacement.play-with-additional-copy",
        args: {
          original: {
            kind: "constant",
            value: { triggerEvent: "play", role: "original-token" }
          },
          additional: {
            kind: "constant",
            value: { triggerEvent: "play", role: "additional-copy", copyOf: "original-token" }
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-0edf62a2fa247fc8feb7ea57978657018d5be55376452b2c4173a7170526aa61",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处缺口，均不近似实现：(1) 契约 3.1 的 ReplacementAbility 没有「once each turn」频度字段（TriggerSpec.once 不适用于替代，" +
    "383.3.e/386.1）也没有「you may」的可选应用字段，本程序只能用 replaced 事件形状记录该替代。" +
    "(2) 替代的 with 体必须引用「被替代事件里的那个 token 单位」并把一次 play 改写为「原 token + 一个副本」两次打出：" +
    "冻结的 ObjectSelector（self/source/target/pick/linked）没有事件对象形态，effect.copy 的 play 模式被显式阻断" +
    "（copy-action-cannot-create-a-pending-chain-object），events/pipeline.ts 的替代注册也只支持 replaced/prevented/impossible，" +
    "无法产生第二次 play；程序保留 replacement.play-with-additional-copy 的精确待接线形状，不用近似实现。" +
    "(3)「while I'm at a battlefield」需要在替代应用时判定来源当前位置（464.2.b），替代管线不消费 condition 的位置判定。" +
    "依赖：事件对象绑定与替代频度/可选字段（契约变更请求 + RIFT-120）、RIFT-89（play 费用与打出流程）、RIFT-91（位置判定）。",
  abilities,
  sourceText:
    "Once each turn, if you would play a token unit while I'm at a battlefield, you may play that token " +
    "and an additional copy of it instead."
} satisfies CardProgram;

export default program;
