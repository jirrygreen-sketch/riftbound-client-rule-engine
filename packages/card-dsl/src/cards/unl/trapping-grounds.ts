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
 *   conquer 时点由 turn/flow.ts 的 Score wave 发出（ruleRefs 468.5.d / 471.1 / 473.2.a），
 *   触发过滤用封闭 EVENT_PATTERN_TYPES 里的 "conquered"；“here”=本源战场（053.3），
 *   “you”=战场控制者（190.6.d）。
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
 * 2. 默认合法地点已可由 LocationTargetSpec + target-location 选择并链接到 token；
 *    Bird 定义与 conquer 载荷/绑定仍缺。
 * 3. 触发侧：conquer 时点现在由 turn/flow.ts 的 Score wave 发出；CardProgram 保留
 *    053.3 的 here 语义为嵌套 filter {source: "self"}，translateTriggerFilter 可将其绑定到
 *    注册源对象，但 scoring emission 只有 player 与 battlefieldId，没有 source/object snapshot
 *    或 source-to-battlefield 绑定供事件匹配器消费；显式 programs 才会由 engine-runtime attach，
 *    默认房间不注入本卡程序。"assigned 3+ excess damage" 的台账（467.2.c.1–c.4）也没有
 *    暴露给 conquer 载荷或 ResolveContext（契约 3.6 的 history 只按动作计数，不表达金额）。
 * 依赖：effect.token 定义表扩展（187.7 的 Bird）与关键词展开、
 * 计分载荷的 here 绑定（053.3）与默认程序注入。
 */
export default {
  canonicalCardId: "card.hash-7a01ecd3aa462214de6a41d9b27507498954ccd6e7095b6e731dbe742c275f90",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "整卡三处缺口，均不近似实现：(1) 「play a 1 [M] Bird unit token with [Deflect]」的 token 定义（187.7：无域单位 token、1 Might、Bird 标签、带 [Deflect]，809）" +
    "不在冻结的 effect.token 定义表（recruit/sand-soldier/mech/reflection/tentacle）内，带自身能力或关键词的 token 在该表被明确 blocked，卡文件不能自造定义。" +
    "(2) 触发侧：conquer 时点已由 turn/flow.ts 的 Score wave 发出，卡面过滤保留了 053.3 的完整 \"here\" 语义，" +
    "用 CardProgram 允许的嵌套 filter {source: \"self\"} 把事件对象锚定到注册源；translateTriggerFilter 能把该锚点绑定为 sourceRef，" +
    "但当前 conquer emission 只有 player 与 details.battlefieldId，没有 source/object snapshot 或 source-to-battlefield 绑定供事件匹配器消费。" +
    "apps/game-server 仅在显式传入 programs 时调用 attachLifecycle，默认房间不注入本卡程序。" +
    "「if you assigned 3 or more excess damage」是紧跟触发条件的从句（383.2.a.1），其数值来自 467.2.c 的伤害分配台账" +
    "（467.2.c.1 的 Assigning ≠ Dealing、467.2.c.4 的超量定义），依赖：effect.token 定义表扩展与关键词展开、" +
    "计分载荷的 source/Battlefield 绑定与默认程序注入。",
  sourceText:
    "When you conquer here, if you assigned 3 or more excess damage, play a 1 :rb_might: Bird unit token with [Deflect].",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // Preserve "here" as the source Battlefield anchor. The nested
        // source:self selector is translated to the registered source object;
        // conquer emissions still lack the source/object snapshot needed to
        // consume that anchor (053.3).
        filter: { event: "conquered", filter: { source: "self" }, player: "self" },
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
          id: "trapping-grounds.choose-location",
          op: "condition.value",
          locations: [
            {
              id: "trapping-grounds.token-location",
              type: "any",
              controller: "controller",
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          args: {
            value: {
              kind: "location",
              value: { kind: "target-location", target: "trapping-grounds.token-location" }
            },
            key: { kind: "constant", value: "location" }
          }
        },
        {
          id: "trapping-grounds.play-bird",
          linkedTo: "trapping-grounds.choose-location",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "bird" },
            amount: { kind: "constant", value: 1 },
            // 440.2.c/185.2.a：被“打出”的新 token 先在链上创建，再由打出流程接手。
            mode: { kind: "constant", value: "play" },
            linkKey: { kind: "constant", value: "birdToken" },
            location: {
              kind: "linked-value",
              instructionId: "trapping-grounds.choose-location",
              key: "location"
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
