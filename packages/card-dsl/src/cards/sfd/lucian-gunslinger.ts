import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Lucian, Gunslinger (sfd-028-221) — Unit, Fury, Lucian/Demacia/Sentinel/Champion.
 * energy 3, power: none printed, Might 2.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-028-221，逐字，含换行）:
 *   "[Assault] (+1 :rb_might: while I'm an attacker.)\n"
 *   "When I attack, deal damage equal to my [Assault] to an enemy unit here."
 *
 * 规则依据（CR v1.5）:
 * - [Assault]（807.1.b.3）：未印刷数值时视为 Assault 1；卡内只声明 keyword（契约 3.7），
 *   展开（continuous.might + Attacker 条件）由 effects/keywords/Assault.ts 负责。
 * - "When I attack"：383.4.e 的 Attack Trigger，时点 attack-declared（383.4.e.2 规定在
 *   单位取得 Attacker 身份后进链）；filter 用内层 source: "self" 指称本卡；
 *   383.4.e.2.a 规定条件每场战斗只检查一次，故 once: "per-combat"。
 * - "deal damage equal to my [Assault]"：伤害数额在结算时读取本卡的 Assault 数值
 *   （807.1.b.2 定义 Assault Value，807.2 要求叠加授予值，807.3 允许引用）。
 *   effects/interpreter/expr.ts 的 object-property 只读取快照直接属性，不能从 keywords
 *   数组读取当前 Assault Value；不能用默认值 1 代替结算时数值（359.3.f.2）。
 * - "an enemy unit here"：「enemy」= 对手控制（740.1.b），「here」= 本卡所在地点
 *   （359.3.f.1/.2），写成 TargetSpec 的 controller/sameLocationAs 过滤（355.9.b）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（2026-10-17 实测复核）。
 * - combat/flow.ts 在开启战斗/转换 showdown 时仍抛 combat-start-transaction/
 *   showdown-conversion，没有在授予 Attacker 后发射 attack-declared 的生产路径
 *   （383.4.e.2/383.4.e.2.a、466.2.c）；
 * - programs/filters.ts 的 translateInstructionTargets → translateObjectFilter 仍拒绝
 *   TargetSpec 的 sameLocationAs（实测 ProgramBindingError: Unsupported filter field
 *   sameLocationAs），触发 body 无法进入生产绑定，也就无法按来源结算时的
 *   位置重验 here（359.3.f.2）；
 * - damage equal to my [Assault] 需要在结算时读取 Assault Value（807.1.b.2/807.2/
 *   807.3），而 effects/interpreter/expr.ts 的 object-property 只读快照直接属性，
 *   keywords.assault.value 仍是占位路径（实测 MissingInformation: Unavailable
 *   characteristic: keywords.assault.value）；
 * - effects/keywords/Assault.ts 的展开条件读取 designation，ObjectSnapshot 提供的是
 *   combatRole：实测默认 expr 求值器对 designation 报 Unavailable characteristic，
 *   而 layers/engine.ts 的 conditionMatches 根本不求值 compare，programs/statics.ts
 *   因此无法让攻击加成生效（effects/interpreter/expr-ext 的 designation 求值器
 *   尚未接入默认 dispatch/图层）。
 * 模板 golden（test/cards/templates/keyword-triggered-attack-declared-effect-664.test.mjs）
 * 记录能真实执行的 Finalize 目标锁定与上述缺口；不把局部伤害原语测试当成整卡执行证据。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "assault" },
  {
    kind: "triggered",
    trigger: {
      at: "attack-declared",
      filter: { event: "attack-declared", filter: { source: "self" } },
      // 383.4.e.2.a: the trigger condition is checked only once per combat,
      // even if the Unit regains the Attacker designation.
      once: "per-combat"
    },
    optional: false,
    body: [
      {
        id: "lucian-gunslinger.damage",
        op: "effect.damage",
        args: {
          // 描述性占位：结算时应等于本卡当前的 Assault Value。
          // Expr 尚无关键词值选择器，故不能写成常量 1 冒充。
          amount: {
            kind: "object-property",
            object: "source",
            property: "keywords.assault.value"
          },
          target: { kind: "constant", value: "lucian-gunslinger.enemy-unit-here" }
        },
        targets: [
          {
            id: "lucian-gunslinger.enemy-unit-here",
            filter: { type: "unit", controller: "opponent", sameLocationAs: "source" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-9cbd19f7b3430a1dd398620ef97b933b43283fd7e9514a877188b5aa5d1cd80a",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "实测（2026-10-17）四处缺口，均不近似实现：(1) combat/flow.ts 仍以 combat-start-transaction/showdown-conversion " +
    "阻止战斗开启与转换，尚未在授予 Attacker 后发射 attack-declared 并按每场战斗首次取得身份触发" +
    "（383.4.e.2/383.4.e.2.a、466.2.c）。(2) programs/filters.ts 的 translateInstructionTargets → " +
    "translateObjectFilter 仍拒绝 TargetSpec 的 sameLocationAs（实测 registerProgramTriggers 抛 " +
    "ProgramBindingError: Unsupported filter field sameLocationAs），触发 body 在生产绑定即失败关闭，" +
    "不能按来源结算时的位置重验 enemy unit here（355.9.b/359.3.f.2）。(3) effects/interpreter/expr.ts " +
    "的 object-property 只读取快照直接属性（实测 MissingInformation: Unavailable characteristic: " +
    "keywords.assault.value），不能读取结算时含叠加授予的 Assault Value（807.1.b.2/807.2/807.3），" +
    "不能用常量 1 近似。(4) effects/keywords/Assault.ts 读取 designation 而 ObjectSnapshot 提供 " +
    "combatRole（其实测 designation 条件抛 Unavailable characteristic，layers/engine.ts 的 " +
    "conditionMatches 也不求值 compare），continuous.might 攻击加成未生效（807.1.c/807.1.d.1）。",
  abilities,
  sourceText:
    "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
    "When I attack, deal damage equal to my [Assault] to an enemy unit here."
} satisfies CardProgram;

export default program;
