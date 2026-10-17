import type { CardProgram } from "../../ir/index.js";

/**
 * An Offer You Can't Refuse (rad-101-167) — Gear, 2 energy、power null，Chaos。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json rad-101-167）：
 *   "[Action] (Play on your turn or in showdowns.)
 *    Kill a gear. Its controller plays a Gold gear token exhausted. (It has
 *    \"[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.\")"
 *
 * 规则依据（CR v1.5）：
 * - 806.1 / 806.1.c.1：印刷的 [Action] 是许可类关键词（卡牌可在任意玩家的回合的
 *   Showdown 期间打出），展开由 effects/keywords/Action.ts 负责。
 * - 429 / 429.6："Kill a gear." 是主动消灭（Kill Instruction），由打出者选择一个 Board
 *   上的 Gear 作为 Target；用已合入的 effect.kill 原语。
 * - 440.2.c / 185.2.a / 187.5："plays a Gold gear token exhausted" 要求按链上创建再打出
 *   （token 自身带 \"[Reaction][>] Kill this, [E]: [Add] [A].\"），并且是“以横置状态入场”
 *   的入场状态规定（143.4 / 185.2.d），不是入场后再横置。
 *
 * status：judge-required。三处缺口：
 * 1. Gold gear token 定义（187.5，自带能力）不在冻结的 effect.token 定义表里，实测
 *    effect.token 直接以 blockedReason \"token-definition-or-abilities-judge-required\"
 *    返回 negated；
 * 2. “exhausted”入场状态是 create-token 的入场改写，闭集动作不支持（effect.token 文件头
 *    明确 \"Entry overrides are not supported\"）；事后补 effect.exhaust 会多产生一次
 *    “成为横置”事件并错过入场替代，因此不这样做；
 * 3. \"Its controller\"（被消灭 Gear 的控制者）无法表达：需要从 kill 结果读取被消灭对象的
 *    控制者作为 token 的演奏者与位置（契约 3.6 的 ObjectSelector 没有事件对象形式，
 *    也没有“链接对象的控制者”表达式）。
 * 此外费用侧：印刷 2 energy 已于 2026-10-16 的记录中缺省，现在按 cost.printed 记录
 * （契约 §3.1），完整收费仍依赖 RIFT-261。effect.kill 与 [Action] 声明各自可结构校验
 * 并有真实执行测试；不近似实现 token 部分。
 */
export default {
  canonicalCardId: "card.hash-dec87fe514b3143f6b040acdcfc5e343b048ce4ac93600347243dd78304d770c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) Gold gear token 定义（CR 187.5，自带「[Reaction][>] Kill this, :rb_exhaust:: [Add] " +
    ":rb_rune_rainbow:.」）不在冻结的 effect.token 定义表内，卡牌侧不能创建该定义；" +
    "(2)「plays a Gold gear token exhausted」的横置入场是 create-token 的入场改写（143.4/185.2.d），" +
    "闭集动作不支持（effect.token 明确 Entry overrides are not supported），事后补 effect.exhaust " +
    "会多产生一次“成为横置”事件并错过入场替代，故不近似；" +
    "(3)「Its controller」无法表达：需要从 kill 结果读取被消灭对象的控制者作为 token 的演奏者与位置" +
    "（契约 3.6 的 ObjectSelector 没有事件对象形式，也没有“链接对象的控制者”表达式）。" +
    "effect.kill 与 [Action] 声明已合入/可结构校验，但不构成整卡证据；不近似实现 token 部分。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      // 349/560：Gear 的打出能力。印刷打出费用 2 energy、power: null（无印刷力量，
      // 不是 0）：按契约 §3.1 记 cost.printed，完整收费仍依赖 RIFT-261。
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          // 429.6："Kill a gear."——目标由打出者选择一个 Board 上的 Gear。
          id: "an-offer.kill-gear",
          op: "effect.kill",
          args: { target: { kind: "constant", value: "chosen-gear" } },
          targets: [
            {
              id: "chosen-gear",
              filter: { type: "gear", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 440.2.c / 185.2.a / 187.5：在链上创建 Gold gear token 并让它完成打出流程。
          // location 里的 \"killed-gear-controller\" 是描述性占位：真实演奏者与目的地是被
          // 消灭 Gear 的控制者（见 judgeReason 第 3 点），“exhausted”入场状态也无法在
          // effect.token 里表达——整条指令因此处于 judge-required，不会被当成已实现语义。
          id: "an-offer.play-gold-token",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "gold" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "constant",
              value: { type: "base", player: "killed-gear-controller" }
            },
            linkKey: { kind: "constant", value: "goldToken" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Kill a gear. Its controller plays a Gold gear token exhausted. " +
    "(It has \"[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.\")"
} satisfies CardProgram;
