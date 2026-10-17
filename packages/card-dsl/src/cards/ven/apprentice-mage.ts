import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Apprentice Mage (ven-047-166) — Unit, Mind, Bilgewater.
 *
 * 原文：
 *   [Empower] :rb_energy_2: (:rb_energy_2:: Empower me. Use only if not Empowered.)
 *   When I become [Empowered], [Predict 2]. (Look at the top 2 cards of your Main
 *   Deck. Recycle any of them and put the rest back in any order.)
 *   [Empowered][>] I have +1 :rb_might:.
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1 / 827.1.c / 827.1.c.1 / 442：Empower 是 Activated Ability 关键词，
 *   本卡印刷费用 2 Energy；按契约 3.7 只声明
 *   { kind: "keyword", keyword: "empower", value: 2 }。
 * - 828.1.d："When I become Empowered" 是 Dependent Ability 的 Condition 之一，
 *   它在其来源成为 Empowered 时 Active 并触发；状态变化由动作层在完成后发出
 *   empowered-changed（events/timing-points.ts，payload 含 previousCount /
 *   currentCount，828.1.c 要求只对增加方向触发）。
 * - 437 Predict：437.1 定义预测一张牌（看牌，可回收）；437.1.a 明确预测多张时看
 *   相应数量、回收其中任意张、其余按任意顺序放回；437.2 是 Limited Action，只能由
 *   游戏效果指示；437.3 的格式是 "Predict X."；437.4 说明不足时尽可能多看、不因
 *   预测而 Burn Out。
 *   本体拆成三条已合入原语：
 *   1. effect.inspect：scope top、amount 2、choose 允许 0..2 张进入回收；
 *      "看牌库顶 N 张" 必须由上游提供有序 picksSpecId，原语明确拒绝用无序 query
 *      近似（契约 3.6 的 zoneSlice 才是按区域顺序取牌）。程序里给出稳定的
 *      有序范围 id "apprentice-mage.predict-top-2"，由调用方按该 id 提供牌库顶
 *      两张（保序），不在卡里猜顺序。
 *   2. effect.recycle：回收所选，objects 取前序 inspect 的链接值（417.1/417.6）。
 *   3. effect.order：destination top、count = 2 - 实际回收张数、chooseOrder 让玩家
 *      按任意顺序放回（437.1.a）；张数由 arithmetic(sub) + linked-value 计算，
 *      不写死。
 * - "[Empowered][>] I have +1 :rb_might:."：828.1.b/828.1.c 的 Dependent
 *   Ability，静态 +1 Might 属 layers 的 continuous.might（arithmetic 图层）。
 *
 * 结构说明：对象引用只用契约 3.6 的符号选择器；指令按真实结算顺序链接
 * （inspect → recycle → order），不为了测试方便强行链接。
 *
 * 复核（2026-10-17，第一轮 M2 覆盖率复核，逐条对照旧 judgeReason）：
 * - continuous.might 指令原语随 RIFT-258 合入（注册表可见），+1 [M] 缺的只是 442.1.a 的
 *   Empowered 门控：ObjectSnapshot / Condition 都没有该二元状态，layers/engine.ts 的
 *   conditionMatches 对未知 condition kind 落回 true，所以「I have +1 [M]」不是可执行门控。
 * - effect.inspect / effect.recycle / effect.order 三条原语是合入的，golden 用有序 picks
 *   真实执行整条 Predict 2（含回收 0/1 张的两种边界与缺有序范围时的明确阻断）。
 * - 仍不可执行的是：(a) Empower / Empowered KeywordDef（827.1.c.1 / 828.1.c）；
 *   (b) 828.1d 的「成为 Empowered」触发（empowered-changed 的增量方向过滤与订阅）；
 *   (c) effect.inspect 的 argsSchema 仍要求 object-property 的 object 是运行时 ObjectRef，
 *   吃不下契约 3.6 的符号 player 选择器，所以生产链路上取不到「来源控制者的牌库顶」。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "empower",
    value: 2
  },
  {
    kind: "triggered",
    trigger: {
      at: "empowered-changed",
      filter: {
        event: "empowered-changed",
        filter: { source: "self" }
      }
    },
    optional: false,
    body: [
      {
        id: "apprentice-mage.predict-look",
        op: "effect.inspect",
        args: {
          player: {
            kind: "object-property",
            object: "source",
            property: "controller"
          },
          zone: { kind: "constant", value: "deck" },
          scope: { kind: "constant", value: "top" },
          picksSpecId: { kind: "constant", value: "apprentice-mage.predict-top-2" },
          amount: { kind: "constant", value: 2 },
          choose: { kind: "constant", value: true },
          chooseCount: { kind: "constant", value: { min: 0, max: 2 } },
          choiceId: { kind: "constant", value: "apprentice-mage.predict" },
          pickedKey: { kind: "constant", value: "predict-looked-at" },
          choosePicksKey: { kind: "constant", value: "predict-recycle" }
        }
      },
      {
        id: "apprentice-mage.predict-recycle",
        op: "effect.recycle",
        args: {
          objects: {
            kind: "linked",
            instructionId: "apprentice-mage.predict-look",
            key: "predict-recycle"
          }
        },
        linkedTo: "apprentice-mage.predict-look"
      },
      {
        id: "apprentice-mage.predict-put-back",
        op: "effect.order",
        args: {
          destination: { kind: "constant", value: "top" },
          count: {
            kind: "arithmetic",
            operator: "sub",
            operands: [
              { kind: "constant", value: 2 },
              {
                kind: "linked-value",
                instructionId: "apprentice-mage.predict-recycle",
                key: "recycledCount"
              }
            ]
          },
          chooseOrder: { kind: "constant", value: true }
        },
        linkedTo: "apprentice-mage.predict-recycle"
      }
    ]
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: { kind: "constant", value: 1 }
    },
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "empowered" }
    }
  }
];

export default {
  canonicalCardId: "card.hash-ca70aa40eda9b90185f38679f3d22f38f003f40ea76c2154efad0a8a820c23e4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前四处缺口：(1)「[Empower] 2」与「[Empowered]」没有 KeywordDef——827.1.c.1 的起动费用与 " +
    "828.1.c 的状态门控无实现；(2) 442.1.a 的 Empowered 二元状态不在 ObjectSnapshot / Condition 中，" +
    "layers/engine.ts 的 conditionMatches 对未知 condition kind 落回 true，所以「+1 :rb_might:」不是" +
    "可执行门控（continuous.might 指令原语本身已随 RIFT-258 合入）；(3) 828.1.d 的「When I become " +
    "[Empowered]」需要 empowered-changed 的增量方向过滤与订阅（时点与 previousCount/currentCount 载荷" +
    "已合入，过滤与接线未合入）；(4) effect.inspect 的 argsSchema 仍要求 object-property 的 object " +
    "是运行时 ObjectRef，吃不下契约 3.6 的符号 player 选择器（object: \"source\"），因此生产链路上取不到" +
    "来源控制者的牌库顶（原语按契约拒绝无序 query 近似，只有 zoneSlice 保序）。" +
    "已合入的 inspect / recycle / order 在测试内核里按有序 picks 真实执行；不近似实现状态门控与查看范围来源。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_2: (:rb_energy_2:: Empower me. Use only if not Empowered.)\n" +
    "When I become [Empowered], [Predict 2]. (Look at the top 2 cards of your Main Deck. Recycle any of them and put the rest back in any order.)\n" +
    "[Empowered][>] I have +1 :rb_might:."
} satisfies CardProgram;
