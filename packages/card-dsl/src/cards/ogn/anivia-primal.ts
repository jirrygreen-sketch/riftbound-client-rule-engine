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
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 时点 "attack-declared" 没有发射方：combat/flow.ts 的宣告事务仍以
 *   combat-start-transaction 显式阻断（CR 466.2，P0 契约 §7.2 批 5），
 *   事件管线里没有触发它的路径。
 * - 无目标集合伤害没有已合入原语：effect.damage 只经 ctx.targets(TargetSpec.id)
 *   读取 Finalize 锁定的目标；把 "all enemy units here" 写成 selection "all" 的
 *   TargetSpec 会在真实链路里把这些单位登记为"成为目标"的目标（355.9 / 754），
 *   属于近似实现，不采用。
 *
 * 下面保留有依据的 IR 形状（攻击触发 + 固定 3 点 + "here" 与 "enemy" 的筛选意图，
 * 集合本身以描述占位串标注、不伪造成 TargetSpec）；golden 测试用参考内核真实执行
 * effect.damage 的固定数额与部分失效场景。
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
    "缺攻击时点的发射路径与无目标集合伤害原语：（1）attack-declared 已在 timing-points.ts " +
    "定义为封闭枚举成员，但 combat/flow.ts 的宣告事务仍以 combat-start-transaction 显式阻断" +
    "（CR 466.2，P0 契约 §7.2 批 5 Turn/Combat/priority-focus），没有模块发射该时点，触发无法进入链；" +
    "触发注册同样依赖 RIFT-257 的 CardProgram 绑定；（2）" +
    "“deal 3 to all enemy units here” 按 355.10.d/355.10.d.1 是无选择的集合伤害、" +
    "不是目标，而已合入的 effect.damage 只读取 Finalize 锁定的 TargetSpec（没有 " +
    "query/集合形态），写成 selection \"all\" 的 TargetSpec 会错误登记为“成为目标”" +
    "（355.9/754）。依赖：战斗宣告事务（RIFT-119/124 之后的 combat 工作流）、" +
    "RIFT-257、无目标集合伤害形态。不近似实现。",
  abilities,
  sourceText: "When I attack, deal 3 to all enemy units here."
} satisfies CardProgram;

export default program;
