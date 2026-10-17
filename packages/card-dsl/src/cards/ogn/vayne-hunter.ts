import type { CardProgram } from "../../ir/index.js";

/**
 * Vayne, Hunter (ogn-035-298) — Unit, Fury, Vayne/Demacia/Champion.
 * energy 4, power 1 (Fury), Might 2.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-035-298):
 *   "[Assault 3] (+3 :rb_might: while I'm an attacker.)\nIf an opponent controls
 *    a battlefield, I enter ready.\nWhen I conquer, you may pay
 *    :rb_energy_1: to return me to my owner's hand."
 *
 * 规则依据（CR v1.5）：
 * - [Assault 3]（807.1.b/.c）：攻击时 +3 Might 的被动关键词；展开由
 *   effects/keywords/Assault.ts 提供，卡只声明 keyword 与数值。
 * - "If an opponent controls a battlefield, I enter ready."（364.3 / 364.3.a、
 *   369.3）：这是条件式被动能力 + 入场替代——条件成立时把"横置入场"改写为"就绪入场"，
 *   用 replacement + replacement.enter 表达，不做事后 effect.ready。
 * - "When I conquer, you may pay :rb_energy_1: to return me to my owner's hand."
 *   （383.4.c / 383.4.c.1、383.4.c.2.a）：Conquer Effect；"you may pay … to
 *   return me" 是可选效果，按契约 3.9 写成 choice.optional 并把被选指令包进 body。
 *   body 内先支付 1 能量（cost.pay 的 payments 形状），再用 effect.zone 的
 *   return-to-hand 把我移回拥有者手牌（目的地按拥有者路由，CR 417/124）。
 *
 * status：judge-required。Assault 的 designation 别名已有扩展求值器，但
 * 静态条件与战斗身份生产尚未接通；条件入场路径绕过 ability.condition，
 * 且没有真实战场控制谓词。征服还缺参与单位身份、得分替代后的触发保证、
 * 可选体的自身目标绑定/嵌套生命周期与无法支付时的局部回滚。
 * 已支持子效果的执行不证明这些路径正确，详见 judgeReason 与 golden。
 */
const vayneHunter = {
  canonicalCardId: "card.hash-af6a9ff16e9f4f9849e489bb4ab37b18a1f12ed88da4b151ac85c770eb68d8c6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺以下生产接线：(1) Assault 3（807.1.b/.c）的 designation→combatRole 读取虽有扩展求值器，" +
    "programs/statics.ts 的条件仍调用基础 evaluateCondition，未接该扩展；" +
    "combat/flow.ts 的 combat-start-transaction 仍阻断攻击身份生产。" +
    "(2) 条件入场（364.3.a、369.3）：replacement/bind.ts 的 matchesEnterAction 在 testCondition 前返回，" +
    "绕过 ability.condition；战场控制仍在 BattlefieldState，count.subject 不读取 battlefield，缺真实控制谓词。" +
    "(3) conquer 缺参与单位 object（383.4.c.2.a）及得分替代/阻止后的触发保证（383.4.c.2.c）。" +
    "choice.optional 内 TargetSpec 的 source:self 被 programs/filters.ts 拒绝，" +
    "assertFinalizationSurface 也缺嵌套目标生命周期；cost.pay 缺可选 payment scope/savepoint，" +
    "不能在无法支付时只跳过可选体（203.3、383.3.b）。",
  abilities: [
    { kind: "keyword", keyword: "assault", value: 3 },
    {
      kind: "replacement",
      replaces: {
        event: "object-enters-board",
        filter: { source: "self", exhausted: true }
      },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "battlefields",
          filter: { controller: "opponent" }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      },
      with: [
        {
          id: "vayne-hunter.enter-ready",
          // 入场状态改写（369.3 / 805.6）：replacement.enter 是合并管线的
          // 入口形状；不是"先横置再就绪"的一次 effect.ready。
          op: "replacement.enter",
          args: {
            state: { kind: "constant", value: "ready" },
            zone: { kind: "constant", value: "board" }
          }
        }
      ]
    },
    {
      kind: "triggered",
      // 383.4.c：Conquer Effect。封闭判别值 "conquered" 映射到 conquer 时点；
      // source:self 是已合入的事件过滤绑定形状，会在翻译时绑定到本宿主（383.4.c.2.a）。
      // 生产 conquer 载荷仍没有参战单位 object，因此整卡继续保持 judge-required。
      trigger: { at: "conquer", filter: { event: "conquered", filter: { source: "self" } } },
      optional: false,
      body: [
        {
          id: "vayne-hunter.may-return",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay :rb_energy_1: to return Vayne to your hand?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "vayne-hunter.pay-1",
                  op: "cost.pay",
                  args: { payments: { kind: "constant", value: { energy: 1 } } }
                },
                {
                  id: "vayne-hunter.return-to-hand",
                  op: "effect.zone",
                  linkedTo: "vayne-hunter.pay-1",
                  args: {
                    target: { kind: "constant", value: "vayne-hunter.self" },
                    to: { kind: "constant", value: "hand" }
                  },
                  targets: [
                    {
                      id: "vayne-hunter.self",
                      filter: { source: "self" },
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
  ],
  sourceText:
    "[Assault 3] (+3 :rb_might: while I'm an attacker.)\n" +
    "If an opponent controls a battlefield, I enter ready.\n" +
    "When I conquer, you may pay :rb_energy_1: to return me to my owner's hand."
} satisfies CardProgram;

export default vayneHunter;

