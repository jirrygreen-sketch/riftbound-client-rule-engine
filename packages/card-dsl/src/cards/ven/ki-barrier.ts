import type { CardProgram } from "../../ir/index.js";

/**
 * Ki Barrier (ven-126-166) — Spell, 2 energy + 1 Order power, no tags.
 * Might null（法术无印刷 Might）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-126-166，逐字）:
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)\n"
 *   "Choose a unit. Prevent the next 7 damage that would be dealt to it this turn. "
 *   "(Opponents can assign it extra combat damage to kill it.)"
 *
 * 规则依据（CR v1.5）：
 * - [Reaction]（813）是许可类关键词（159.2.b 的法术内在属性）；卡只声明关键词身份，
 *   展开（continuous.timing 的 closed-state 许可）归 effects/keywords/Reaction.ts 与 chain 的
 *   canAct 准入（契约 3.7/3.5）。
 * - "Choose a unit"：单位在 Board 上被具体选中，是目标（355.7/355.9.a.1/355.10）。
 * - "Prevent the next 7 damage that would be dealt to it this turn"：438.1/438.1.b.1 把 Prevent
 *   定义为「按 Prevent Value（此处 7）减少一组对象将受到的伤害」，438.2 规定被防止的伤害被
 *   「减少该 Prevent Value」的事件替代，438.3 规定按实际防止量递减 Unit 上跟踪的 Prevent Value，
 *   438.3.a 说明降到 0 或以下就不再跟踪。438.7/438.6 把它定为 Delayed Replacement Effect
 *   （367/369 的替代效果管线），窗口是 "this turn"（317.2.c/318 的清理到期）。
 * - 括号内文字是 438.5 的提示文本（"Opponents can assign it extra combat damage to kill it"
 *   说明战斗伤害仍可被分配、超出 Prevent Value 的部分照常标记），不构成第二条能力。
 *
 * 复核：replacement.prevent 已注册，原语的 this-turn 数值额度可以累计消费、部分预防，
 * 不再缺原语或基础 Prevent Value 消费。整卡仍 judge-required，当前缺口是：
 * (1) 原语读取额外的 ResolveContext.replacement（host + pipeline），冻结契约 3.6 没有此入口；
 *     ChainEngine.context 没有提供它，解释器 instructionContext 也不转发扩展，原始 play body 仍无法注册。
 * (2) 原语把 { target: "ki-barrier.unit" } 降为 objectId 过滤，未绑定 zoneEntryId；
 *     目标离场再入场后不应继承旧预防（124/124.1）。
 * (3) this-turn 的 active() 仅比较 pipeline.clock.turn；317.2.c 的 Expiration Special Cleanup
 *     只清 continuous 图层，尚未使预防替代在该清理时到期。
 * (4) 额度当前封装在替代闭包中；战斗致死分配还需要读取剩余 Prevent Value（438.5.a）。
 * 保留目标 + 7 点 + this-turn 的准确声明，不近似实现。
 */
const kiBarrier = {
  canonicalCardId: "card.hash-c7314bf7e9131668bdd7205b5d3fbea9f04822a76c74bdac078317dc203fae52",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "replacement.prevent 原语及 this-turn Prevent Value 的累计消费、部分预防已合入（438.1/438.2/438.3）；" +
    "当前缺口：(1) 原语需要 ResolveContext.replacement（host + pipeline），契约 3.6 尚无此入口，" +
    "ChainEngine.context 未提供，解释器 instructionContext 未转发，原始 play body 无法安装延迟替代（438.7）。" +
    "(2) 原语将目标选择器降为 objectId，未保留 zoneEntryId，缺少 124/124.1 要求的离场再入场失效。" +
    "(3) duration:this-turn 仅比较 pipeline.clock.turn，未接入 317.2.c 的 Expiration Special Cleanup 到期。" +
    "(4) 剩余额度封装在替代闭包中，战斗致死分配没有读取 Prevent Value 的接线（438.5.a）。不近似实现。" +
    "「Choose a unit」的目标声明本身按 355.7/355.9.a.1 正确；[Reaction]（813.1/813.1.c）关键词已合入。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          // 438.1/438.1.b.1/438.7：结算中的法术创建延迟替代效果，被替代事件是
          // 「本回合对该单位将造成的伤害」，Prevent Value 为 7（438.3 的额度递减）。
          // 原语已注册并能消费额度；解释器的替代依赖接线、目标身份与清理到期仍缺（见 judgeReason）。
          id: "ki-barrier.prevent-7",
          op: "replacement.prevent",
          args: {
            amount: { kind: "constant", value: 7 },
            duration: { kind: "constant", value: "this-turn" },
            target: { kind: "constant", value: { target: "ki-barrier.unit" } }
          },
          targets: [
            {
              id: "ki-barrier.unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a unit. Prevent the next 7 damage that would be dealt to it this turn. " +
    "(Opponents can assign it extra combat damage to kill it.)"
} satisfies CardProgram;

export default kiBarrier;
