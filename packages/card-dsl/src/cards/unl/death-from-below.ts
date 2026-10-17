import type { CardProgram } from "../../ir/index.js";

/**
 * Death from Below (unl-186-219) — Spell, 4 energy + 1 power, Fury/Chaos,
 * tags Pyke / Signature.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-186-219，逐字）：
 *   "Kill a unit at a battlefield. Then, if it had 3 :rb_might: or less, you may
 *    play this from your trash for :rb_rune_rainbow:."
 *
 * 规则依据（CR v1.5）：
 * - "Kill a unit at a battlefield" 是主动消灭（429.1.a.1.a / 429.6）：单位是目标
 *   （355.9.a.1、355.10.b 的示例），"at a battlefield" 只是目标合法性限制；
 *   effect.kill 已合入，并把实际消灭的对象写入链接值 killed。
 * - "if it had 3 :rb_might: or less" 读被消灭单位的最后已知信息（359.3.e.12 /
 *   359.3.e.13）：单位离区后引用失效，但由本 body 的消灭动作造成的失效允许回看，
 *   Might 在结算时读取（contract 3.6 的 object-property + linked selector）。
 * - "you may play this from your trash for :rb_rune_rainbow:"：CR 388.4 用本卡作为
 *   官方示例——"do this" 措辞表示这是一个 Reflexive Trigger：结算时把新能力作为链项
 *   加入链（389 / 389.1），"you may" 由该反身触发的控制者在 Finalize 决定是否为它
 *   付费用（388.4）；"for [A]"（356.1.a）用给定费用替换该牌的基础费用。
 *
 * status = judge-required（不近似实现）：
 * 1. 反身触发没有卡牌侧构造/接线：IR 的六种 Ability 都不能表达"结算时把新能力作为
 *    链项加入链"（388 / 389 / 389.1），choice.optional 只把正文就地执行，不产生链项；
 *    下面对 "Then, …" 的 sequence + choice.optional 只是形状保留（与 ogn/twisted-fate-gambler
 *    对 388 的处理一致）。
 * 2. "you may play this from your trash" 的"this"需要该牌在 Trash 的当前引用：
 *    ObjectSelector 只有 self/source/target/pick/linked，self/source 绑定的是结算时的来源，
 *    跨区（124）后不再是指向 Trash 里那张牌的引用，合并原语没有为"自己在某区域的当前引用"
 *    提供选择器（依赖引擎批 4 的链接与来源引用）。
 * 3. "for :rb_rune_rainbow:" 的替换费用（356.1.a）需要 finalized 费用计划：effect.play
 *    要求已 Finalize 的 FinalizedCostPlan，当前费用管线仍不能为 Universal Power 生成该替换计划。
 * 4. 388.4 的"you may"是反身触发 Finalize 时的决定，而契约 3.9 的 choice.optional 是
 *    指令级形状；两者读法不同（与 unl-181-219 Virtuoso 记录的 may-scope 问题同类），
 *    需要裁定。
 *
 * 可执行部分：effect.kill 与 "if it had 3 Might or less" 的条件在 golden 里用参考内核
 * 真实执行（含回看取值）；play 半段只保留结构并标 test.todo。
 */

/**
 * 描述性的替换费用（356.1.a："for [Cost]" 用给定费用替换基础费用）。
 * 不写 energy: 0——该牌印刷的 4 能量被替换掉，不是被改写为 0。
 */
const PLAY_FOR_RAINBOW = {
  kind: "cost.modify",
  base: "printed",
  replace: { power: ["rainbow"] },
  finalized: false
} as const;

export default {
  canonicalCardId: "card.hash-332b81818b3c3740ca27663743bcff94806548a92b2601eea3956bec3778f6ac",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：(1) 反身触发（CR 388 / 388.4 以本卡为官方示例、389 / 389.1）没有卡牌侧构造：结算时要把新能力作为链项加入链，" +
    "IR 的六种 Ability 与 choice.optional 都做不到；下面对 “Then, …” 的 sequence + choice.optional 只是形状保留（与 ogn/twisted-fate-gambler 对 388 的处理一致）。" +
    "(2) “play this from your trash” 的 “this” 需要该牌在 Trash 的当前引用：ObjectSelector 只有 self/source/target/pick/linked，跨区（124）后 self/source 不再指向 Trash 里那张牌，" +
    "没有“自己在某区域的当前引用”选择器（依赖引擎批 4 的来源/链接引用）。" +
    "(3) “for :rb_rune_rainbow:” 的费用替换（356.1.a）需要 finalized 费用计划：effect.play 要求已 Finalize 的 FinalizedCostPlan，当前费用管线不能为 Universal Power 生成该替换计划。" +
    "(4) 388.4 的 “you may” 是反身触发在 Finalize 时的决定，与契约 3.9 的指令级 choice.optional 读法不同（与 unl-181-219 记录的 may-scope 问题同类），需要裁定。" +
    "effect.kill（429）与 “if it had 3 :rb_might: or less” 的最后已知读取（359.3.e.12–e.13）已合入，golden 真实执行。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "death-from-below.kill",
          op: "effect.kill",
          args: {
            target: { kind: "constant", value: "death-from-below.battlefield-unit" }
          },
          targets: [
            {
              id: "death-from-below.battlefield-unit",
              filter: { type: "unit", location: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // “Then, if it had 3 :rb_might: or less, you may play this from your
          // trash for :rb_rune_rainbow:.” 条件读被消灭单位的最后已知 Might
          // （359.3.e.12–e.13）；“you may” 与 Reflexive Trigger 的缺口见 judgeReason。
          id: "death-from-below.may-play-from-trash",
          op: "sequence",
          condition: {
            kind: "compare",
            left: {
              kind: "object-property",
              object: { linked: "death-from-below.kill" },
              property: "might"
            },
            operator: "lte",
            right: { kind: "constant", value: 3 }
          },
          args: {
            body: {
              kind: "constant",
              value: [
                {
                  id: "death-from-below.optional-play",
                  op: "choice.optional",
                  args: {
                    prompt: {
                      kind: "constant",
                      value: "Play Death from Below from your trash for :rb_rune_rainbow:?"
                    },
                    body: {
                      kind: "constant",
                      value: [
                        {
                          id: "death-from-below.play-from-trash",
                          op: "effect.play",
                          args: {
                            // “this” 在 Trash 的当前引用（见 judgeReason 第 2 点）。
                            target: { kind: "constant", value: "death-from-below.self-in-trash" },
                            cost: { kind: "constant", value: PLAY_FOR_RAINBOW }
                          },
                          targets: [
                            {
                              id: "death-from-below.self-in-trash",
                              filter: { source: "self", zone: "trash" },
                              min: 1,
                              max: 1,
                              selection: "one"
                            }
                          ]
                        }
                      ]
                    }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "Kill a unit at a battlefield. Then, if it had 3 :rb_might: or less, you may " +
    "play this from your trash for :rb_rune_rainbow:."
} satisfies CardProgram;
