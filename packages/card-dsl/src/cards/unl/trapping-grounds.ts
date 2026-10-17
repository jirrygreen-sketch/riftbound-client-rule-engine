import type { CardProgram } from "../../ir/index.js";

/**
 * Trapping Grounds (unl-217-219) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-217-219, 逐字)：
 *   When you conquer here, if you assigned 3 or more excess damage, play a
 *   1 :rb_might: Bird unit token with [Deflect].
 *
 * 规则依据（CR v1.5）：
 * - 383.4.c / 383.4.c.1 / 383.4.c.2.b：“When you conquer here” 是 Conquer Effect；
 *   时点用封闭表的 conquer（scoring/ 发出，ruleRefs 468.5.d / 471.1 / 473.2.a），
 *   190.6.d 的 “you” 是战场控制者。
 * - 383.2.a.1：紧跟触发条件的 “if you assigned 3 or more excess damage” 属触发条件，
 *   在触发时求值；467.2.c 规定战斗伤害由玩家分配，467.2.c.1 明确 Assigning ≠ Dealing，
 *   467.2.c.4 定义“超出致命所需的分配量”。
 * - 187.7：1 [M] Bird 是“无域单位 token、1 Might、Bird 标签、带 [Deflect]”
 *   （809 的 Deflect 展开见 effects/keywords/Deflect.ts）。
 * - 440.2.c / 185.2.a / 350.2 / 354：“play a … token” 的被打出 token 先在链上创建，
 *   由打出流程接手；原文没有写地点，因此目的地是 355.2/355.2.a 的默认合法地点
 *   （控制者 Base 或该控制者控制的 Battlefield），在最外层打出流程的 Finalize 决定。
 *
 * status = judge-required（逐个记录缺口，不近似实现；复核后与首次编写相比，缺口本身未变，
 * 仅把依赖描述改到当前 HEAD 的准确位置）：
 * 1. 缺 token 定义与关键词展开：187.7 的 Bird（带 [Deflect]）不在冻结的
 *    effect.token 定义表（recruit / sand-soldier / mech / reflection / tentacle）里，
 *    带自身能力/关键词的 token 定义在该表被明确 blocked；卡文件不能自造定义。
 * 2. 缺默认合法地点读数：effect.token 的 mode "play" 要求恰好一个目的地参数，
 *    而 355.2/355.2.a 的地点是运行时集合，任何已合入 Expr 都产不出它（RIFT-9 的
 *    target.location 未合入；复核实测 argsSchema 以 "effect.token requires exactly one
 *    destination argument" 拒绝缺目的地的写法）；固定写 Base 或某个 Battlefield 会删掉印刷的选项。
 * 3. 触发侧：conquer 时点现在由 turn/flow.ts 的 Score wave 发出（timing-point-producers.md），
 *    但仍没有已合入订阅方把卡牌程序的 triggered ability 注册成触发，且 filter 里的 here: true
 *    会被 programs/filters.ts 以 "Unsupported filter field here" 拒绝（053.3 的占位尚无消费方）；
 *    "assigned 3+ excess damage" 的台账（467.2.c.1–c.4）没有暴露给 conquer 载荷或
 *    ResolveContext（契约 3.6 的 history 只按动作计数，不表达金额）。
 * 依赖：effect.token 定义表扩展（187.7 的 Bird）与关键词展开、target.location、
 * RIFT-31/RIFT-33 的 here 载荷与 RIFT-120/RIFT-257 的触发注册。
 */
export default {
  canonicalCardId: "card.hash-7a01ecd3aa462214de6a41d9b27507498954ccd6e7095b6e731dbe742c275f90",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "整卡三处缺口，均不近似实现：(1) 「play a 1 [M] Bird unit token with [Deflect]」的 token 定义（187.7：无域单位 token、1 Might、Bird 标签、带 [Deflect]，809）" +
    "不在冻结的 effect.token 定义表（recruit/sand-soldier/mech/reflection/tentacle）内，带自身能力或关键词的 token 在该表被明确 blocked，卡文件不能自造定义。" +
    "(2) 「play a … token」按 440.2.c/185.2.a/350.2/354 需要链上创建 + 打出流程，且原文未写地点，目的地是 355.2/355.2.a 的默认合法地点选择" +
    "（控制者 Base 或该玩家控制的 Battlefield），而没有任何已合入 Expr 能产出该运行时地点集合（RIFT-9 的 target.location 未合入；复核实测 effect.token 以 " +
    "\"requires exactly one destination argument\" 拒绝缺目的地写法）；固定写一个地点会删掉印刷选项。" +
    "(3) 触发侧：conquer 时点现已由 turn/flow.ts 的 Score wave 发出，但仍没有已合入订阅方把卡牌程序的 triggered ability 注册成触发（RIFT-120/RIFT-257），" +
    "且 filter 里的 here: true 会被 programs/filters.ts 以 \"Unsupported filter field here\" 拒绝（053.3 的占位尚无消费方）；" +
    "「if you assigned 3 or more excess damage」是紧随触发条件的从句（383.2.a.1），其数值来自 467.2.c 的伤害分配台账（467.2.c.1 的 Assigning ≠ Dealing、467.2.c.4 的超量定义），" +
    "conquer 载荷与 ResolveContext 都没有该读数。依赖：effect.token 定义表扩展与关键词展开、target.location（RIFT-9）、here 载荷（RIFT-31/RIFT-33）与触发注册（RIFT-120/RIFT-257）。",
  sourceText:
    "When you conquer here, if you assigned 3 or more excess damage, play a 1 :rb_might: Bird unit token with [Deflect].",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // “here” 是本源战场，“you” 是战场控制者（053.3、190.6.d）；here 占位键
        // 等待 scoring 载荷（见 judgeReason）。
        filter: { event: "conquer", here: true, player: "controller" },
        // 383.2.a.1：紧跟触发条件的 “if you assigned 3 or more excess damage” 是
        // 触发条件的一部分；count 表达式是保留形状（合并 IR 没有伤害分配金额维度）。
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "excess-damage-assigned-this-combat",
            filter: { player: "controller" }
          },
          operator: "gte",
          right: { kind: "constant", value: 3 }
        }
      },
      // 原文没有 “may”，是强制触发。
      optional: false,
      body: [
        {
          id: "trapping-grounds.play-bird",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "bird" },
            amount: { kind: "constant", value: 1 },
            // 440.2.c/185.2.a：被“打出”的新 token 先在链上创建，再由打出流程接手。
            mode: { kind: "constant", value: "play" },
            linkKey: { kind: "constant", value: "birdToken" }
            // 不写目的地参数：原文没有指定地点，355.2/355.2.a 的默认合法地点选择
            // 尚未有 Expr 形态（见 judgeReason 第 2 点）；固定一个地点会删掉印刷选项。
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
