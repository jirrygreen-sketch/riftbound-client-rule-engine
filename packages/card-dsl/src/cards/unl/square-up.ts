import type { CardProgram } from "../../ir/index.js";

/**
 * Square Up (unl-017-219) — Spell, 4 energy, Power null, Might null, Fury。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-017-219，逐字）：
 *   [Repeat] — Discard 1 (You may pay the additional cost to repeat this spell's effect.)
 *   Give a unit [Assault 4] this turn. (+4 :rb_might: while it's an attacker.)
 *
 * 规则依据（CR v1.5）：
 * - [Repeat]（820.1.a/820.1.c）：印刷格式 “Repeat [Cost]”，本卡的附加费用是 Discard 1
 *   （423.3：费用式弃牌不可退）；付费后结算时额外执行一次（820.1.d.1），可重新做选择
 *   （820.2/820.2.a）。按 README 第 5 节关键词只声明，展开归 effects/keywords/Repeat.ts。
 * - “Give a unit [Assault 4] this turn”：授予 Assault 4，本回合期限（317.2.c），
 *   807.1.c 的展开归 keywords/Assault.ts；reminder 是同义释义。355.9.a.1 的 “a unit” 是目标。
 *
 * status = judge-required（2026-10-18 复核，缺口不近似实现）：
 * - continuous.grant-keyword 已合入，本卡的目标授予可由解释器建立到期的 ability 图层效果；
 *   其后的 Assault attacker designation 谓词仍不能在当前图层条件求值：Assault 展开读取
 *   `designation`，而运行时快照只提供 `combatRole`，且把 designation 映射到 combatRole 的
 *   扩展求值器（effects/interpreter/expr-ext/）没有生产调用方，静态条件的求值仍走基础
 *   解释器（读不到该特征即 fail closed）。
 * - [Repeat] 的 Discard 1 附加费用以及已支付实例数到打出结算的接线仍缺；cost-plan 与
 *   effect.repeat 本体已存在，但 Repeat 展开的 repeat.cost 静态声明在 programs/statics.ts
 *   被拒（"Static ability kind repeat.cost has no layer mapping"），卡片关键词实例没有接入
 *   Finalize/paid-count。
 * RIFT-681 的模板参数化 golden（test/cards/templates/
 * keyword-play-continuous-grant-keyword-681.test.mjs）经通用测试台真实支付 4 能量、
 * 登记 ability 图层授予并覆盖既有 Assault 宿主求和边界；整卡继续保持 judge-required。
 */
const squareUp = {
  canonicalCardId: "card.hash-e4dc01dd2f105796f021b575a0dcf055c0b996025247706f3605affedf193ce6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未接通，均不近似实现（RIFT-681 模板 golden 给出真实执行证据边界，2026-10-18 复核）：" +
    "(1) 整卡打出半段已可执行——continuous.grant-keyword 经通用测试台真实支付 4 能量并在 ability 图层登记本回合的 Assault 4" +
    "（含既有 Assault 1 宿主求和到 5 的边界），但 Assault 展开要求读取 attacker designation（807.1.c/807.1.d.1），" +
    "而生产 ObjectSnapshot 只提供 combatRole；把 designation 映射到 combatRole 的扩展求值器" +
    "（effects/interpreter/expr-ext/ 的 object-property designation 分支）没有任何生产调用方，" +
    "programs/statics.ts 的静态条件求值仍用基础解释器并 fail closed，layers/engine.ts 也没有 designation 读取器或指定产生方，" +
    "combat/flow.ts 的 startCombat 仍抛 combat-start-transaction，没有真正的 Attacker designation 生产方。" +
    "(2) [Repeat]（820.1.a/820.1.c）印刷的 Discard 1 附加费用在契约 3.1 的 KeywordAbility 里没有承载槽位，" +
    "也没有接入 Finalize 的可选附加费用收取；Repeat 展开的 repeat.cost 静态声明在 programs/statics.ts 被拒" +
    "（实测 Static ability kind repeat.cost has no layer mapping），已支付实例数同样没有接到打出结算的 repeat 次数" +
    "（cost-plan 与 effect.repeat 本体已合入，缺 CardProgram 关键词实例的费用与 paid-count 接线）。",
  abilities: [
    { kind: "keyword", keyword: "repeat" },
    {
      kind: "play",
      // 印刷 4 Energy；力量无印刷值（catalog power: null），不声明 power。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 4 }
      },
      body: [
        {
          // “Give a unit [Assault 4] this turn”：授予与期限按 807.1.c / 317.2.c 声明；
          // attacker designation 的条件消费仍由 judgeReason 中的引擎缺口覆盖。
          id: "square-up.grant-assault-4",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Assault" },
            value: { kind: "constant", value: 4 },
            duration: { kind: "constant", value: "end-of-turn" },
            objects: { kind: "constant", value: { kind: "target", id: "square-up.unit" } }
          },
          targets: [
            {
              id: "square-up.unit",
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
    "[Repeat] — Discard 1 (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Give a unit [Assault 4] this turn. (+4 :rb_might: while it's an attacker.)"
} satisfies CardProgram;

export default squareUp;
