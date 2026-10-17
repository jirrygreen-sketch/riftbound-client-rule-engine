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
 * - [Assault 3]（807）：攻击时 +3 Might 的被动关键词；展开由 Assault.ts（RIFT-81）
 *   提供，图层由 layers/（RIFT-91）消费。
 * - "If an opponent controls a battlefield, I enter ready."（364.3、369.3）：这是
 *   一个条件被动 + 入场替代效果——条件成立时把"横置入场"替换为"就绪入场"。
 *   用 replacement 能力表达（event object-enters-board，filter 指向自身）。
 * - "When I conquer, you may pay :rb_energy_1: to return me to my owner's hand."
 *   （383.3.a、383.4.c）："you may pay ... to return me" 是可选效果；按契约 3.9，
 *   "可以……"必须写成 choice.optional 并把被选指令包进 body（不是 choice +
 *   linkedTo）。body 内先支付 1 能量（cost.pay 的 payments 形状），
 *   再用 effect.zone 的 return-to-hand 形式把我移回拥有者手牌（"my owner's hand"：
 *   effect.zone 的 hand 目的地按拥有者路由，CR 417/124 由内核处理）。
 *
 * status：judge-required（复核 2026-10-17）。已合入：入场替代注册管线
 * （replacement/bind.ts）能绑定「横置进场 → 就绪进场」的状态改写，
 * golden 断言链区横置后进入战场时被改写为就绪（不是先横置再 effect.ready）。
 * 仍缺：
 * - "an opponent controls a battlefield" 的条件没有可求值路径：ObjectSnapshot 里
 *   battlefield 不是对象，count 的 subject 不参与求值；且 bind 的入场改写匹配
 *   （matchesEnterAction）在条件检查之前返回，条件尚未被求值；
 * - 可选征服体的 cost.pay 与回手指令已经能在解释器中按顺序执行，但生产链仍缺
 *   嵌套 choice.optional 里的 TargetSpec 生命周期，且支付失败时缺少只跳过该可选体的
 *   payment scope/savepoint；当前链路不能安全完成这段触发。
 * 关键词部分（Assault 3）已可结构校验。不把"enter ready"近似成事后 effect.ready，
 * 也不手改费用。
 */
const vayneHunter = {
  canonicalCardId: "card.hash-af6a9ff16e9f4f9849e489bb4ab37b18a1f12ed88da4b151ac85c770eb68d8c6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口（复核 2026-10-17）：(1)「If an opponent controls a battlefield, I enter ready」的入场改写已由替代注册管线" +
    "真实执行（golden 断言链区横置进场被改写为就绪，不是先横置再 effect.ready），" +
    "但条件「an opponent controls a battlefield」没有可求值路径——ObjectSnapshot 里 battlefield 不是对象、count 的 subject 不参与求值，" +
    "且 bind.ts 的 matchesEnterAction 在条件检查之前返回（入场改写匹配不经过 ability.condition）。" +
    "(2)「When I conquer, you may pay :rb_energy_1: to return me」的 cost.pay 与回手指令已能在解释器中真实执行，" +
    "但生产链的 assertFinalizationSurface 拒绝 choice.optional 内嵌的 TargetSpec，且支付失败时没有只跳过该可选体的" +
    " payment scope/savepoint。触发 filter 已改用封闭判别值 \"conquered\" 与 object:{objectId:self} 意图（conquer 载荷的无单位身份缺口见同批复核）。" +
    "依赖：battlefield 控制谓词 / 入场替代条件求值、生产链嵌套目标生命周期与可选支付回滚。",
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
      // 封闭判别值 "conquered"；object:{objectId:"self"} 声明「本单位」意图。
      trigger: { at: "conquer", filter: { event: "conquered", object: { objectId: "self" } } },
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
