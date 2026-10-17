import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Anivia, Primal (ogn-148-298) — Unit（能量 7，力量 2，Might 8，Body；Bird/Anivia/Freljord/Champion）。
 *
 * 原文："When I attack, deal 3 to all enemy units here."
 *
 * 规则依据（CR v1.5）：
 * - 383.4.e / 383.4.e.1：Attack Trigger —— "When I attack…" 在本单位首次获得
 *   Attacker designation 时触发；时点 "attack-declared" 已是
 *   events/timing-points.ts 的封闭枚举成员（ruleRefs 347.2.a / 383.4.e / 383.4.f）。
 * - 418.1.c / 418.1.d：伤害分别标记在每个单位上、可以同时造成；固定 3 点不涉及
 *   分摊（355.14 与本卡无关）。
 * - "here" 用 ObjectFilter 的 sameLocationAs 锚点表达（契约 3.6 的符号选择符）。
 * - 355.10.d / 355.10.d.1："all enemy units here" 由特征程序化选定、任何情况下都
 *   不存在选择，因此不是目标。该集合因此**没有** TargetSpec：登记成 TargetSpec 会把
 *   它们当作目标（355.9 的目标锁定、754 的"成为目标"触发都随之发生），属于近似实现。
 *
 * status: judge-required。战斗开启/攻防身份事务仍由 combat-start-transaction
 * 阻断（466.2）；effect.damage 只接受锁定目标，尚无 enemy + here 的无目标集合入口。
 * 下方保留固定 3 点与非目标意图。golden 仅执行受支持的伤害子效果，不把测试侧
 * 提供的引用当成生产查询或攻击触发的证明。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "attack-declared",
      filter: { event: "attack-declared", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        // args.target 是**描述占位串**：卡片文本里的集合不是目标（355.10.d），
        // 而没有 TargetSpec 可用，因此这条指令在引擎里无法执行；
        // 缺口与依据记录在 judgeReason，golden 测试用 effect.damage 原语
        // 配合测试侧锁定引用执行固定 3 点的集合伤害语义（见测试的分层说明）。
        id: "anivia.damage-enemy-units-here",
        op: "effect.damage",
        args: {
          amount: { kind: "constant", value: 3 },
          target: { kind: "literal", value: "anivia.enemy-units-here" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-16533ecf815a70951a42e970169c16d046dab7f738d0ebd375b47d6b456479cf",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺两条执行路径：（1）attack-declared 的真实发射仍由 combat/flow.ts 的 combat-start-transaction 阻断（CR 466.2/383.4.e.2）；（2）effect.damage 仅从 ctx.targets(args.target) 读取锁定目标，缺按 enemy + sameLocationAs:source 在结算时查询的非目标集合入口。all enemy units here 按 CR 355.10.d/355.10.d.1 从不选择单位，不能改成 selection:all 的 TargetSpec 并产生成为目标事件。",
  abilities,
  sourceText: "When I attack, deal 3 to all enemy units here."
} satisfies CardProgram;

export default program;
