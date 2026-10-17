import type { CardProgram } from "../../ir/index.js";

/**
 * Right of Conquest (unl-015-219) — Spell, 3 energy + 1 Fury power, Might null, Fury。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-015-219，逐字）：
 *   Draw 1, then draw 1 for each battlefield you or allies control.
 *
 * 规则依据（CR v1.5）：
 * - “Draw 1”：414.1/414.3 的抽牌，缺省抽牌者是能力控制者（190.6.d），用 effect.draw 声明。
 * - “then draw 1 for each battlefield you or allies control”：第二条独立指令，数量是
 *   “你或盟友控制的战场”集合的元素个数，用 count 表达式在结算时求值（契约 3.6 evaluate 时机）。
 *   - 战场控制是二元状态、由单位在场决定（190.2 / 190.4 / 190.4.a），因此集合是
 *     type: "battlefield" + controller 锚点的过滤（355.10.d 的程序化集合，不做目标选择）。
 *   - 盟友维度：491.8.e “Friendly describes controlled Game Objects by a player or their Teammate”，
 *     即 teammate 控制的战场也算（与 315.2.b.3 的提醒一致）。
 * - “then” 不改变两条指令各自独立结算（055 / 359.3.e.11）：第二次抽牌不写 linkedTo，
 *   第一条被否定也照常执行第二条。
 *
 * status = judge-required（缺口不近似实现）：
 * - 盟友/队友关系没有可求值读数：ResolveContext 只暴露 controller 与 player(id)，
 *   没有任何“控制者是我或我的盟友”的选择符或谓词，ObjectFilter 的 controller 词表只有
 *   self/opponent/具体 PlayerId（layers/filter.ts、chain/engine.ts 的归一化），
 *   把 “or allies” 省略成 controller: "controller" 会在队友模式少抽牌，属近似实现。
 * - “Battlefield” 在合并对象空间里也没有稳定的类型读数：契约 ObjectFilter 的 type 词表与
 *   参考内核按对象特征过滤（测试内核的 matchesQueryFilter 支持 types: ["battlefield"]），
 *   但生产 ResolveContext 暴露的合并对象空间不含战场对象（engine-core/src/duel/battlefields.ts
 *   的 controllerPlayerId 状态不进入 host.objects()）。二者都缺，整卡保持
 *   judge-required；golden 用真实原语分别执行 “draw 1” 与 “按计数抽 N” 的形状。
 */
const rightOfConquest = {
  canonicalCardId: "card.hash-ac792fa285c45d86be2109bf1f688aa066f3a5d5e837443e35ddfd35df6c6392",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「for each battlefield you or allies control」缺可求值的集合读数：(1) 盟友/队友关系没有读数——" +
    "ResolveContext 只暴露 controller 与 player(id)，没有任何“控制者是我或我的盟友”的选择符或谓词，" +
    "ObjectFilter 的 controller 词表只有 self/opponent/具体 PlayerId（layers/filter.ts 与 chain/engine.ts 的归一化），" +
    "省略 allies 会在队友模式少抽牌（CR 491.8.e 明确 Friendly 含 Teammate 控制的物件），属禁止的近似实现；" +
    "(2) 战场控制关系（CR 190.2 / 190.4 / 190.4.a）未经 ResolveContext 暴露：合并对象空间里战场由 " +
    "duel/battlefields.ts 的 controllerPlayerId 维护，不进入 host.objects()，没有卡牌可用的 type: \"battlefield\" 读数。" +
    "两条 effect.draw（414.1/414.3）本身已合入，golden 分别执行 “draw 1” 与按计数抽 N 的形状；不近似实现上述两个读数。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "right-of-conquest.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        },
        {
          // “then draw 1 for each battlefield you or allies control”：数量为集合计数；
          // 集合的盟友维度与战场类型读数未合入（见 judgeReason）。
          id: "right-of-conquest.draw-per-battlefield",
          op: "effect.draw",
          args: {
            amount: {
              kind: "count",
              subject: "battlefields-you-or-allies-control",
              filter: { type: "battlefield", controller: "controller" }
            }
          }
        }
      ]
    }
  ],
  sourceText: "Draw 1, then draw 1 for each battlefield you or allies control."
} satisfies CardProgram;

export default rightOfConquest;
