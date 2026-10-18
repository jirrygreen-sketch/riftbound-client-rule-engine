import type { CardProgram } from "../../ir/index.js";

/**
 * rad-082-167 Primordial Roar (Spell, 4 energy + 2 power, Body).
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json,
 * dataVersion 2026-10-12-official-gallery, printing rad-082-167):
 * energy 4, power 2, might null, domains ["Body"], tags [].
 *
 * Printed text (verbatim, sourceText):
 *   "[Show Off] a unit. (As you play this, you may reveal a unit from hand or
 *    pick a friendly unit.)
 *    If you showed off a unit, deal damage equal to that unit's Might to a
 *    unit."
 *
 * Rules reading (CR v1.5):
 * - [Show Off] (832) is a Passive Ability keyword, formatted "[Show Off]
 *   [Object]" (832.1.b) and functionally "As you play [me/this], you may reveal
 *   [Object] from your hand and/or pick [Object] from among friendly game
 *   objects on the board" (832.1.c). The decision is made by the controller
 *   during finalization (832.1.c.2), and the referenced characteristics are
 *   locked at that moment (832.1.d.1: later changes are not considered).
 * - "If you showed off a unit, deal damage equal to that unit's Might to a
 *   unit" is a linked instruction that reads the locked Might of the shown-off
 *   object (832.1.d); the link refers to the Show Off instance on the same
 *   source (832.2.a).
 * - The damaged "a unit" is a target (355.9.b), while the shown-off unit is not
 *   (355.10.a: cards revealed from hand are private; a unit picked from the
 *   board is a pick, not a target).
 *
 * 2026-10-18 再复核：整卡仍为 judge-required；当前缺口见 judgeReason。
 * 已合入原语与关键词声明不等于生产链路可执行；局部执行证据见同名单卡测试。
 */
export default {
  canonicalCardId: "card.hash-8b6deb587569a3df7032c50ff6c443facba501038a4e6e1fb77f5aedbedb57cf",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三项当前缺口（2026-10-18 实测，均不近似实现）：" +
    "(1) [Show Off] 的 Finalize 展示选择与锁定快照没有生产者（832.1.c.2、832.1.d.1）：effects/keywords/ShowOff.ts 只展开出 static cost.reveal 声明，" +
    "该 kind 既不在 instructions 注册表里，也被 programs/statics.ts 的 layerFor 以 “Static ability kind cost.reveal has no layer mapping” 拒绝（实测）；" +
    "chain/cost 没有消费该声明并记录 objects-shown-off 结果（objects-shown-off 时点存在，但没有 Finalize 侧写入方）。" +
    "(2) 声明侧也不可绑定：关键词 slug \"show-off\" 与注册键 \"Show Off\" 不一致，programs/keywords.ts 的 definitionFor 仅做大小写折叠，" +
    "实测 expandProgram 抛 “Keyword show-off has no executable KeywordDef”，而带空格拼写不通过 card-dsl 的 IR 校验（小写 symbol 要求）；" +
    "另外 ShowOff 未接受数值，带 value 的实例被 “Keyword Show Off does not accept a value” 拒绝（实测 832.1.b 的 Object 子句也仍无参数通道）。" +
    "(3) 占位 effect.show-off 仍是 Unregistered instruction opcode（实测 registry 无该条目），不能在 Resolve 冒充 Finalize 展示。" +
    "condition.result 与 linked-value 已合入，缺的是可读的每实例展示结果与 shownMight 锁定值，不是通用谓词。伤害子指令已真实执行；保留锁定值引用，不改读单位当前 Might。",
  abilities: [
    { kind: "keyword", keyword: "show-off", value: 1 },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 4 },
        power: { kind: "constant", value: 2 }
      },
      body: [
        {
          // "[Show Off] a unit." — the finalization-time choice of whether to
          // show off, reveal a unit from hand or pick a friendly unit, and lock
          // that unit's Might (832.1.c/832.1.c.2/832.1.d.1). Op is not
          // registered yet (judgeReason); the two link keys are the contract the
          // damage instruction below consumes.
          id: "primordial-roar.show-off",
          op: "effect.show-off",
          args: {
            source: { kind: "constant", value: { from: ["hand", "board"], type: "unit", controller: "you" } },
            optional: { kind: "constant", value: true },
            linkKey: { kind: "constant", value: "shown" },
            lockedProperty: { kind: "constant", value: "might" },
            lockedKey: { kind: "constant", value: "shownMight" }
          }
        },
        {
          // "If you showed off a unit, deal damage equal to that unit's Might to
          // a unit." The gate is "you showed off" (the show-off link), the
          // amount is the Might locked when showing off (832.1.d.1), and the
          // damaged unit is the instruction's only target (355.9.b).
          id: "primordial-roar.deal-shown-might",
          op: "effect.damage",
          linkedTo: "primordial-roar.show-off",
          condition: {
            kind: "expression",
            value: {
              kind: "linked-value",
              instructionId: "primordial-roar.show-off",
              key: "shown"
            }
          },
          args: {
            amount: {
              kind: "linked-value",
              instructionId: "primordial-roar.show-off",
              key: "shownMight"
            },
            target: { kind: "constant", value: "damaged-unit" }
          },
          targets: [
            {
              id: "damaged-unit",
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
    "[Show Off] a unit. (As you play this, you may reveal a unit from hand or pick a friendly unit.)\n" +
    "If you showed off a unit, deal damage equal to that unit's Might to a unit."
} satisfies CardProgram;
