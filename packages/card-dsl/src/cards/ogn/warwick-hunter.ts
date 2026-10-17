import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Warwick, Hunter (ogn-159-298) — Unit（能量 6，力量 1，Might 5，Body；Dog/Warwick/Zaun/Champion）。
 *
 * 原文："I enter ready.\nWhen I attack, kill all damaged enemy units here."
 *
 * 规则依据（CR v1.5）：
 * - 369.3 例 Master Yi, Honed："I enter ready." 是入场替代效果（359.2.c 规定单位
 *   横置入场，本句把"横置入场"替换为"就绪入场"）。类比特邀关键词 Accelerate 的
 *   effects/keywords/Accelerate.ts 展开形状：replacement + effect.ready。
 * - 383.4.e："When I attack…" 是 Attack Trigger，时点 "attack-declared"。
 * - 429 / 418：kill 与伤害标记分离（429.2.a 只有 Board 上的对象可被消灭）。
 * - "damaged enemy units here" 需要三样缺失的东西："here" 的位置锚点、"damaged"
 *   （有伤害标记）谓词——trigger-spec.ts 的 ObjectFilter 只做类型/控制者/区域/状态/
 *   tags/characteristics 等值匹配，damage 标记不在其中——以及"全选集合"这种形态。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - "I enter ready." 的入场替代管线已合入（RIFT-260 的 bindReplacement 绑定
 *   replacement.enter / 静态入场朝向形状），golden 已用该发布接口 + 真实 ChainEngine
 *   执行本卡声明的 ability：单位就绪进场且不产生 object-readied 时点（805.6.a）。
 *   下面 attack 触发的缺口仍阻塞整卡。
 * - "kill all damaged enemy units here" 同时缺（a）damaged 谓词过滤器，
 *   （b）无目标集合消灭形态（355.10.d："all …" 由特征程序化选定、不是目标；
 *   effect.kill 只读取 TargetSpec/picks/self），（c）attack-declared 的发射方
 *   （combat/flow.ts 仍抛 combat-start-transaction）。
 * 依赖：战斗时点发射、无目标集合 kill 形态和 damaged 谓词。
 * 不近似实现（不用 selection "all" 的 TargetSpec 冒充集合，也不手工加伤害标记）。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: {
      event: "object-enters-board",
      filter: { self: true, exhausted: true }
    },
    with: [
      {
        id: "warwick.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  },
  {
    kind: "triggered",
    trigger: {
      at: "attack-declared",
      filter: { event: "attack-declared", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        // args.target 是**描述占位串**："all damaged enemy units here"（355.10.d 的
        // 程序化集合）不是目标，damaged 也不是已合入的过滤键，因此这条指令没有
        // TargetSpec、在引擎里无法执行；缺口记录在 judgeReason，golden 测试对
        // "只消灭被锁定的、带伤害标记的那一个"做原语层验证。
        id: "warwick.kill-damaged-enemy-units-here",
        op: "effect.kill",
        args: { target: { kind: "literal", value: "warwick.damaged-enemy-units-here" } }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-58c01b587562a4a6f91a4fbef216e0f343dcb9427be468ce7553f4ad7d72ade7",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处缺口：（1）“I enter ready.”（369.3，对照 359.2.c）的入场替代管线已合入（RIFT-260；" +
    "golden 用 bindReplacement 发布接口 + 真实 ChainEngine 执行本卡 ability，单位就绪进场且" +
    "不产生 object-readied 时点）。（2）“all damaged enemy units here” 是无目标的集合消灭（355.10.d/355.10.d.1 的" +
    "程序化选定、无选择不成为目标），而已合入的 effect.kill 只读 TargetSpec/picks/self，" +
    "没有集合形态；写成 selection \"all\" 的 TargetSpec 会错误登记为“成为目标”。" +
    "（3）“damaged” 谓词无 ObjectFilter 形状：trigger-spec.ts 的 characteristics 只做" +
    "等值/数组包含，damage 标记不在可过滤特征里。（4）attack-declared 时点尚无发射方" +
    "（combat/flow.ts 仍抛 combat-start-transaction，属契约 §7.2 批 5）。依赖：" +
    "战斗时点发射、无目标集合 kill、damaged 谓词。不近似实现。",
  abilities,
  sourceText: "I enter ready.\nWhen I attack, kill all damaged enemy units here."
} satisfies CardProgram;

export default program;
