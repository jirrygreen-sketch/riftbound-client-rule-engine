import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Shadow Assassin (ven-013-166) — Unit, Fury, tag Ionia.
 * energy 5, power: none printed, Might 5.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-013-166，逐字）：
 *   I enter ready if you have a card with my name in your trash.
 *
 * 规则依据（Core Rules v1.5）：
 * - 359.2.c：单位默认横置进入 Board；369.3（官方例子 Master Yi, Honed 的 “I enter ready.”）
 *   明确这种“描述单位如何进场”的文本是**入场替代效果**，把「横置进场」替换为「就绪进场」。
 *   effect.ready 的文件头记录本原语不参与入场替代，也不能拿它事后重置来模拟。
 * - 053.1/053.4："my name" 是 132.1 的卡名；132.3/132.4 规定同名比较按完整牌名
 *   （[短名], [副标题]）进行。
 * - 108.2.a / 414.x 的区域语义："your trash" 是能力控制者的 Trash（zone "trash"）。
 * - 383.2.a：本句没有 When/At/Nth Time 的触发条件，是一句条件性的被动/替代文本，
 *   因此按其“进场方式”性质写成 replacement 能力（条件写在 replacement.condition）。
 *
 * status = judge-required（三处依赖均不近似实现）：
 * 1. 缺 replacement.enter 消费管线：契约 3.1 的 replacement 能力到事件管线替代注册
 *    （events/pipeline.ts 的替代注册表）没有适配路径，没有任何模块读取 CardProgram 的
 *    replacement 能力并注册；因此“横置进场 → 就绪进场”的替换不会发生（RIFT-9/RIFT-120；
 *    同 sfd/071-221 Breakneck Mech、sfd/176-221 Xin Zhao, Vigilant、sfd/027-221 Dunebreaker
 *    的记录）。本程序不把 effect.ready 当作事后重置来近似。
 * 2. 同名比较没有可执行谓词：ObjectFilter 的 characteristics 只能做顶层字段等值，
 *    Expr 也没有「读来源的卡名并与候选比较」的形态；filter 里按 describe 记录的占位键
 *    （sameNameAs: "self"）没有任何消费方。把同名近似成 tag 或类型都会改变语义（132.3/132.4）。
 * 3. Trash 计数的过滤键绑定不完整：count 表达式经 ctx.query 读取，参考内核与 layers 的
 *    filter 都不归一化 "controller"/"self" 这类占位符（同 sfd/pit-rookie、sfd/dunebreaker
 *    记录的同一缺口），因此在归一化落地前断言该条件等于把「必定成立」写成预期。
 * 依赖：replacement.enter 替代管线（RIFT-9/RIFT-120）、卡名比较谓词与 Trash 过滤键归一化。
 * 本程序按 369.3 的形状声明入场替代，替代体使用已合入的 effect.ready（with 体的指令本身
 * 可由 golden 对真实内核执行），但替代是否触发保持 TODO。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: {
      // 359.2.c / 369.3：替换「单位横置进入 Board」这一事件。
      event: "object-enters-board",
      filter: { source: "self", exhausted: true }
    },
    // 369.3：条件是进场方式的适用条件（"if you have a card with my name in your trash"）。
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "cards",
        filter: {
          zone: "trash",
          owner: "self",
          // 描述性键：132.1/132.3/132.4 的同名比较需要卡名谓词，现有 ObjectFilter 的
          // characteristics 只做顶层字段等值，没有任何消费方读取该键（见 judgeReason）。
          sameNameAs: "self"
        }
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    },
    with: [
      {
        id: "shadow-assassin.enter-ready",
        // 369.3 / effect.ready 文件头：就绪进场由入场替代完成，本指令只在替代体里表达该结果。
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-101dc13865ec4192cab5368a9a51d1582968c98f57b52ab293cd35e4c5313b0c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入：(1) 缺 replacement.enter 消费管线——契约 3.1 的 replacement 能力到事件管线替代注册没有适配路径，" +
    "没有模块读取 CardProgram 的 replacement 能力并注册，因此 359.2.c/369.3 的「横置进场 → 就绪进场」替换不会发生" +
    "（RIFT-9/RIFT-120；同 sfd/071-221 Breakneck Mech、sfd/176-221 Xin Zhao, Vigilant 的记录），" +
    "不把 effect.ready 当作事后重置来近似；(2)「a card with my name」缺卡名比较谓词——132.1/132.3/132.4 的同名是完整牌名比较，" +
    "ObjectFilter 的 characteristics 只做顶层字段等值，Expr 也没有读取来源卡名并与候选比较的形态，filter 里的 sameNameAs 是" +
    "无消费方的描述性占位；(3) Trash 计数的占位符绑定未归一化——count 经 ctx.query 读取，engine 与参考内核都不归一化 " +
    "controller/self 这类占位符（与 sfd/pit-rookie 记录同一缺口），在归一化落地前不能断言该条件成立。" +
    "with 体的 effect.ready 本体已合入，golden 对真实内核执行该半段；替代是否触发保持 TODO。依赖：replacement.enter 替代管线、" +
    "卡名比较谓词与 Trash 过滤键归一化。不近似实现。",
  abilities,
  sourceText: "I enter ready if you have a card with my name in your trash."
} satisfies CardProgram;
