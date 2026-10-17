import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Herald of Spring (unl-034-219) — Unit, 4 Energy + 1 power, Might 4, Calm, tag Ionia.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-034-219，逐字）：
 *   [Hunt] (When I conquer or hold, gain 1 XP.)
 *   When you play me, gain 2 XP.
 *
 * 规则依据（CR v1.5）：
 * - [Hunt]：823.1 的 Triggered Ability 关键词；823.1.b 说明它同时是 Conquer Effect 与
 *   Hold Effect，823.1.c.1 的功能写法是 “When I Conquer or Hold, my controller gains X XP”，
 *   823.1.c.2 规定省略 X 时按 1（本卡的提醒文字也正是 1 XP），823.1.c.3 的 Hunt Value 与
 *   823.2 的多来源求和都由关键词文件与注册表负责。按契约 3.7 / README 第 5 节，卡文件只
 *   声明 `{ kind: "keyword", keyword: "hunt" }`，不手写展开。
 * - “When you play me, gain 2 XP”：383.4.a / 383.4.a.1 的 Play Effect，420.4.a 规定在打出
 *   完成后进链；时点用封闭表的 card-played，filter 以契约 3.6 的符号选择器指向来源自身。
 * - “gain 2 XP”：728 / 729 / 730.1 的 XP 资源增加，额度在结算时取值；已合入的 effect.xp
 *   只提交封闭集合里的 gain-xp 动作，获得者缺省是能力控制者（190.6.d 的隐含 “you”）。
 *
 * status = judge-required：
 * - [Hunt] 缺 823.1.b / 383.4.c.2 / 383.4.d.2 的在场单位归因。
 *   turn/flow.ts 的 conquer/hold 只有 player 与 details.battlefieldId；
 *   programs/filters.ts 将 source:self 翻译为事件 objectId，无法匹配本卡。
 * - 需要由计分战场绑定征服/固守时在场的单位对象/快照；不要求本卡没有印刷的 here 条件。
 * 保留关键词声明和打出后 gain 2 XP 的真实执行测试，不手写 Hunt 展开。
 */
const abilities: Ability[] = [
  // 823.1.c.2：印刷省略 Hunt Value，按 1 处理（提醒文字同值）。
  { kind: "keyword", keyword: "hunt" },
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        id: "herald-of-spring.gain-2-xp",
        op: "effect.xp",
        args: { amount: { kind: "constant", value: 2 } }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-31eb0f7b272ead3837c42e44cd4050722667b2142fc50acd5a91843a859b42cf",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 [Hunt] 的计分单位归因（CR 823.1.b、383.4.c.2、383.4.d.2/383.4.d.2.a）：turn/flow.ts 的 conquer/hold 只带 player 与 details.battlefieldId，没有征服/固守时在场单位的对象/快照；programs/filters.ts 将 source:self 翻译成事件 objectId，该载荷无法匹配本卡。需要把计分战场与在场单位绑定，再由同一事件管线扫描 Hunt。",
  abilities,
  sourceText:
    "[Hunt] (When I conquer or hold, gain 1 XP.)\n" + "When you play me, gain 2 XP."
} satisfies CardProgram;

export default program;
