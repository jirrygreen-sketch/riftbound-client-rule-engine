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
 * status：judge-required（第三轮复核 2026-10-17）。逐项实测结论：
 * - [Assault 3]：KeywordDef 与静态绑定（programs/statics.ts 的
 *   createEngineStaticBinder）都能注册 continuous.might，但展开条件读
 *   object-property "designation"（Assault.ts），而 ObjectSnapshot 暴露的是契约
 *   3.8 的 combatRole；实测 combatRole:"attacker" 时有效 Might 仍是印刷值
 *   （designation 求值抛 MissingInformation 后被当作 false）。攻击者身份的生产
 *   写入方也仍缺（combat/flow.ts 对战斗开始抛 combat-start-transaction）。
 * - 入场改写：replacement/bind.ts 能绑定"横置进场 → 就绪进场"，但
 *   matchesEnterAction 在 testCondition 之前直接返回，ability.condition 不在入场
 *   匹配路径求值（实测无对手战场时同样命中改写）；且条件本身无法表达——ObjectSnapshot
 *   没有"战场由谁控制"的对象形状（battlefield token 的 owner/controller 由放置者
 *   决定，实际控制记录在 turn/flow.ts 与 combat/flow.ts 的 BattlefieldState），
 *   count 的 subject 也不参与求值（expr.ts 只读 expr.filter），所以
 *   { count, subject:"battlefields", filter:{ controller:"opponent" } } 恒为 0。
 * - 征服触发有两层缺口。触发拼写：object:{objectId:"self"} 经
 *   translateTriggerFilter 原样保留、"self" 不会被绑定成宿主 id，实测对携带本单位
 *   object 的 conquer 事件仍不匹配；改用嵌套拼写 { filter: { source: "self" } }
 *   能翻译成 object:{objectId:宿主} 并匹配该事件，但生产 conquer 发射载荷只有
 *   { player, details:{ battlefieldId } }、没有参战单位 object（383.4.c.2.a 的
 *   单位身份），所以生产路径上仍恒假。body：choice.optional 内的 TargetSpec
 *   filter { source: "self" } 被 programs/filters.ts 的 translateObjectFilter 抛
 *   "Unsupported filter field source"——实测 triggerRegistrations 在 body 翻译
 *   阶段即失败，整卡触发注册不成立；即便换成可翻译的 filter，chain/engine.ts 的
 *   assertFinalizationSurface 仍以 "Nested/repeated targets require an
 *   interpreter target-selection lifecycle adapter" 拒绝嵌套目标（实测
 *   ChainContractBlockedError）。此外 cost.pay 在资源不足时抛 cannot-pay-cost
 *   （cost/README.md 的 payment scope/savepoint 契约变更请求），当前没有只跳过该
 *   可选体、不中止外层触发的支付作用域。
 * 依赖：Attacker designation 特征与生产写入方、入场替代条件求值 + 战场控制谓词、
 * conquer 载荷的单位身份、嵌套目标生命周期与可选支付回滚。
 * sourceText 与 canonicalCardId 不改。
 */
const vayneHunter = {
  canonicalCardId: "card.hash-af6a9ff16e9f4f9849e489bb4ab37b18a1f12ed88da4b151ac85c770eb68d8c6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前真实缺口（复核 2026-10-17，均以合入源码实测）：" +
    "(1) [Assault 3]（807.1.b/.c）：KeywordDef 展开出 continuous.might 且静态绑定可注册，" +
    "但展开条件读 object-property \"designation\"（effects/keywords/Assault.ts），ObjectSnapshot 只暴露契约 3.8 的 combatRole，" +
    "实测 combatRole:\"attacker\" 时有效 Might 仍为印刷值 2（designation 求值 MissingInformation 被当作 false）；" +
    "攻击者身份的生产写入方也仍缺（combat/flow.ts 抛 combat-start-transaction）。" +
    "(2) 「If an opponent controls a battlefield, I enter ready」（364.3.a、369.3）：入场改写已由替代注册管线绑定（golden 断言链区横置进场被改写为就绪，不是先横置再 effect.ready），" +
    "但 replacement/bind.ts 的 matchesEnterAction 在 testCondition 之前返回，ability.condition 不在入场匹配路径求值（实测无对手战场时同样命中）；" +
    "条件本身也没有可求值形态：战场不是带控制者的 ObjectSnapshot（battlefield token 的 owner/controller 由放置者决定，实际控制记录在 turn/flow.ts、combat/flow.ts 的 BattlefieldState），" +
    "且 count 的 subject 不参与求值（interpreter/expr.ts 只读 expr.filter），{ count, subject:\"battlefields\", filter:{ controller:\"opponent\" } } 恒为 0。" +
    "(3) 「When I conquer, you may pay :rb_energy_1: to return me」（383.4.c.1、383.4.c.2.a）：" +
    "触发拼写 object:{objectId:\"self\"} 经 translateTriggerFilter 原样保留（\"self\" 不绑定成宿主 id），实测对携带本单位 object 的 conquer 事件仍不匹配；" +
    "嵌套拼写 { filter:{ source:\"self\" } } 能翻译成 object:{objectId:宿主}，但生产 conquer 发射载荷只有 { player, details:{ battlefieldId } }、没有参战单位 object，生产路径仍恒假；" +
    "body 侧 choice.optional 内的 TargetSpec filter { source:\"self\" } 被 programs/filters.ts 的 translateObjectFilter 抛 \"Unsupported filter field source\"，实测 triggerRegistrations 在 body 翻译阶段即失败；" +
    "即便换成可翻译的 filter，chain/engine.ts assertFinalizationSurface 仍以 \"Nested/repeated targets require an interpreter target-selection lifecycle adapter\" 拒绝嵌套目标（实测 ChainContractBlockedError）；" +
    "且 cost.pay 资源不足时抛 cannot-pay-cost，当前缺只跳过该可选体的 payment scope/savepoint（cost/README.md 契约变更请求 1/2）。" +
    "依赖：Attacker designation 特征与生产方、入场替代条件求值 + 战场控制谓词、conquer 载荷单位身份、嵌套目标生命周期与可选支付回滚。不近似实现。",
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
      // object:{objectId:"self"} 声明「本单位在征服战场在场」的意图（383.4.c.2.a）。
      // translateTriggerFilter 原样保留这个 "self"（不绑定宿主 id），而生产
      // conquer 载荷只有 { player, details:{ battlefieldId } }，所以匹配恒假（见 judgeReason）。
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

