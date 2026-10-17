import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Dramatic Visionary (unl-062-219) — Unit，能量 4，无印刷力量，Might 4，领域 Mind，标签 Ionia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-062-219，逐字）：
 *   [Deathknell][>] [Predict 2]. (When I die, look at the top two cards of your
 *   Main Deck. Recycle any of them and put the rest back in any order.)
 *
 * 规则依据（CR v1.5）：
 * - 808.1 / 808.1.b：Deathknell 是触发式能力关键词，格式 “[Deathknell][>] [Effect]”；
 *   808.1.c 功能上等于 “When I die, [Effect].”，本卡的 [Effect] 是 “Predict 2”。
 * - 808.1.d / 429.1.a.1.b：触发点是宿主被 Killing 并送入 Trash（封闭时点 object-killed）；
 *   自身死亡触发在换区前作为 Pending Item 入链，808.1.d.1 死亡被替代时移出链，
 *   808.1.d.3 要求在换区前记录来源的位置与属性。
 * - 437.1 / 437.1.a：Predicting = 看牌库顶 X 张，回收其中任意张，其余按任意顺序放回牌库顶。
 * - 437.2 / 437.2.a：“Predict X.” 是指令格式的 Limited Action，只能由游戏效果指示。
 * - 437.3 / 437.3.a：省略数值时 X=1；本卡印有 2。437.4 / 437.4.a：牌库不足时尽可能多看、
 *   不因此 Burn Out。
 * - “your Main Deck” 的隐含 you 是能力控制者（190.6.d）；程序先经 condition.value 绑定
 *   来源控制者，再由 effect.inspect 读取该链接值（与已合入的 ogn/stacked-deck 同型）。
 *   直接写 object-property 符号选择器会被已合入的 effect.inspect argsSchema 拒绝
 *   （该 schema 的 object-property.object 仍要求运行时 ObjectRef），因此不使用那种写法。
 *
 * 结构（契约 3.1 / 3.9）：
 * - abilities[0] 只声明 { kind: "keyword", keyword: "deathknell" }（README 第 5 节）；
 *   展开（订阅 object-killed、trigger.leave、死亡替代移出链）由 keywords/Deathknell.ts 负责。
 * - abilities[1] 写 [Effect] 本体：Predict 2 的三步按真实结算顺序链接
 *   （inspect top 2 → recycle 被选中的 → order 其余），与已合入的 ven/apprentice-mage 同型。
 *
 * status = judge-required（缺口不近似实现，见 judgeReason）：Deathknell 展开仍不可执行。
 * Predict 2 本体（三步原语）与有序牌库顶 PickSpec.zoneSlice 生命周期已合入，
 * golden 通过 Finalize 计划提供真实顺序；CardProgram 的触发注册入口已合入，
 * 但会在 Deathknell 展开阶段被其 trigger.leave 缺口阻断。
 */
const abilities: Ability[] = [
  {
    // 808.1：印刷的 [Deathknell] 声明，展开由关键词注册表负责（契约 3.7）。
    kind: "keyword",
    keyword: "deathknell"
  },
  {
    // 808.1.c 的「When I die, [Effect]」本体：Predict 2。
    kind: "triggered",
    trigger: { at: "object-killed", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "dramatic-visionary.bind-controller",
        op: "condition.value",
        args: {
          // “your Main Deck” 的 you：能力控制者（190.6.d）。符号选择器 “source” 由
          // 解释器绑定到来源最后已知快照，不写运行时 ObjectRef。
          value: { kind: "object-property", object: "source", property: "controller" },
          key: { kind: "constant", value: "controller" }
        }
      },
      {
        // 437.1 / 437.1.a：“look at the top two cards of your Main Deck”。top scope 的
        // 有序范围必须由上游按 zoneSlice 顺序提供（契约 3.6）；原语拒绝用无序 query 近似。
        id: "dramatic-visionary.predict-look",
        op: "effect.inspect",
        linkedTo: "dramatic-visionary.bind-controller",
        args: {
          player: {
            kind: "linked-value",
            instructionId: "dramatic-visionary.bind-controller",
            key: "controller"
          },
          zone: { kind: "constant", value: "deck" },
          scope: { kind: "constant", value: "top" },
          amount: { kind: "constant", value: 2 },
          picksSpecId: { kind: "constant", value: "dramatic-visionary.predict-top-2" },
          choose: { kind: "constant", value: true },
          // 437.1.a：“Recycle any of them” = 0..2 张进入回收选择。
          chooseCount: { kind: "constant", value: { min: 0, max: 2 } },
          choiceId: { kind: "constant", value: "dramatic-visionary.predict" },
          pickedKey: { kind: "constant", value: "predict-looked-at" },
          choosePicksKey: { kind: "constant", value: "predict-recycle" }
        },
        picks: [
          {
            id: "dramatic-visionary.predict-top-2",
            options: [],
            ordered: true,
            selection: "all",
            zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 2 } }
          }
        ]
      },
      {
        // 417.1 / 417.1.a：被选中（选择回收）的牌回收到对应牌库底部；未选中时为 0 张。
        id: "dramatic-visionary.predict-recycle",
        op: "effect.recycle",
        linkedTo: "dramatic-visionary.predict-look",
        args: {
          objects: {
            kind: "linked",
            instructionId: "dramatic-visionary.predict-look",
            key: "predict-recycle"
          }
        }
      },
      {
        // 437.1.a：“put the rest back in any order”：张数 = 2 - 实际回收张数，用
        // linked-value 计算而不是写死；chooseOrder 让玩家决定放回顺序。
        id: "dramatic-visionary.predict-put-back",
        op: "effect.order",
        linkedTo: "dramatic-visionary.predict-recycle",
        args: {
          destination: { kind: "constant", value: "top" },
          count: {
            kind: "arithmetic",
            operator: "sub",
            operands: [
              { kind: "constant", value: 2 },
              {
                kind: "linked-value",
                instructionId: "dramatic-visionary.predict-recycle",
                key: "recycledCount"
              }
            ]
          },
          chooseOrder: { kind: "constant", value: true }
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-9638bc0d7af1a05e5d627ef7b87dd78c4c9702d56c4e121fffe661393fbd3456",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1) [Deathknell] 展开不可执行——keywords/Deathknell.ts 的展开体把触发体写成 " +
    "trigger.leave，而 effects/instructions/ 没有该原语文件（仓库内只有关键词注释与展开体引用它），" +
    "808.1.d.1 死亡被替代时把触发移出链、808.1.d.3 换区前记录来源位置与属性、429.1.a.1.b 的 Pending Item 收集都没有卡牌可用路径。" +
    "(2) effect.inspect 的 top scope 现已通过 PickSpec.zoneSlice 在 Finalize 锁定有序牌库顶（契约 3.6），" +
    "Predict 2 本体（437.1/437.1.a/437.3.a/437.4）三步已用已合入原语写出，golden 通过同一有序计划真实执行；" +
    "CardProgram 的 triggerRegistrations 入口已合入，但会在 Deathknell 的 trigger.leave 展开缺口处停止。",
  abilities,
  sourceText:
    "[Deathknell][>] [Predict 2]. (When I die, look at the top two cards of your Main Deck. " +
    "Recycle any of them and put the rest back in any order.)"
} satisfies CardProgram;
