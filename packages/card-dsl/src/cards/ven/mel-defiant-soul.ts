import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Mel, Defiant Soul (ven-110-166) — Unit, Chaos, tags Noxus/Mel/Champion.
 * 5 Energy, no printed Power（`power: null`，不是 0），Might 4。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-110-166，逐字）：
 *   [Empower] — Discard a spell (Pay the cost: Empower me. Use only if not Empowered.)
 *   When I become [Empowered], banish an enemy unit at a battlefield with 3 :rb_might: or less.
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1 / 827.1.c：[Empower] 是启动能力关键词，格式为 “Empower [Cost]”；827.1.c.2 明确
 *   Empower 费用可以包含**非资源费用**，本卡的 “Discard a spell” 就是这样的费用；827.1.c.1 的
 *   功能文本为「[Cost]：Empower this。仅当未 Empowered 时启动。」827.1.b.1 说明来源自身
 *   不是目标。卡只声明关键词身份，不自行展开费用（契约 3.7、README 第 5 节）。
 * - 423 / 423.3：Discard 作为费用必须在 Finalize 能完整执行；“a spell” 在手里是私有信息
 *   （355.10.a：非公开区域的牌不是 target），支付时由该玩家选择。
 * - 828.1.d：「When I become [Empowered]」是 Dependent Ability 的触发条件；442.2.a 规定成为
 *   Empowered 是可引用的事件，封闭时点对应 empowered-changed（828.1.c 要求只取增加方向）。
 * - 355.9.a.1 / 355.10.a.1：“an enemy unit at a battlefield” 里的单位在战场上，是目标；
 *   “at a battlefield” 按 355.10.b 只是该目标的限制，不额外指向战场。
 * - 428.1 / 428.2 / 428.5：“banish” 把该单位从其区域放入其拥有者的 Banishment，不是 Kill
 *   （428.2.a）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，三处缺口均不近似实现：
 * 1. keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef（RIFT-81~88 批次不含
 *    它们），827.1.c.1 的启动费用与 827.1.c.2 的 “Discard a spell” 非资源费用无法展开；
 *    cost/plan-values.ts 的非标准费用也只支持 exhaust/discard/recycle/kill/reveal/spend-buff，
 *    费用种类与 Empower 关键词到费用计划的接线仍缺；KeywordAbility 只声明关键词身份，
 *    不在本卡重复伪造另一条启动能力。
 * 2. 442.1.a 的 Empowered 二元状态不在 ObjectSnapshot / Condition 里，empowered-changed 的载荷
 *    也没有增加方向过滤的消费方（同 souls-reflection/covert-informant，RIFT-87）；这同时阻断
 *    “when I become Empowered”的依赖能力门控。
 * 3. “with 3 :rb_might: or less” 是单位当前 Might 的数值上限（143.2.a 的有效 Might）：冻结的
 *    ObjectFilter 没有 Might 谓词，已合入过滤器（layers/filter.ts、参考内核）也不读这类键——
 *    把它当已实现会让本卡放逐任意敌方单位（同 sfd/sandshifter、unl/conscription）。
 *    触发翻译和注册适配器本身已合入。
 * 已支持部分：effect.banish 本体（把锁定的敌方单位放入其拥有者的 Banishment）在 golden 中
 * 真实执行，含 Might 上限未被求值时的 fail-open 证据与目标失效边界。
 */
const abilities: Ability[] = [
  {
    // 印刷费是“Discard a spell”（827.1.c.2 的非资源费用），见 judgeReason 第 1 点；
    // 不伪造第二条启动能力。
    kind: "keyword",
    keyword: "empower"
  },
  {
    kind: "triggered",
    trigger: {
      // 828.1.d / 442.2.a：成为 Empowered 的时点；“增加方向”过滤器见 judgeReason 第 2 点。
      at: "empowered-changed",
      filter: {
        event: "empowered-changed",
        filter: { player: "self", direction: "increase" }
      }
    },
    optional: false,
    body: [
      {
        id: "mel.banish-weak-enemy-unit",
        op: "effect.banish",
        args: {
          objects: {
            kind: "constant",
            value: { target: "mel.enemy-unit-at-a-battlefield" }
          },
          amount: { kind: "constant", value: 1 },
          linkKey: { kind: "constant", value: "banished" }
        },
        targets: [
          {
            id: "mel.enemy-unit-at-a-battlefield",
            // “an enemy unit at a battlefield”：控制者为对手（740.1.b），位置限制为战场
            // （355.10.b）；mightLte 是 143.2.a 当前 Might 上限的描述性记录（无消费方，
            // 见 judgeReason 第 3 点）。
            filter: {
              type: "unit",
              zone: "board",
              controller: "opponent",
              location: "battlefield",
              mightLte: 3
            },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-ac23c451a781cab424bef57b9033b37b366730f18b5699ec3fdfd4a7cb61f807",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef，" +
    "827.1.c.1 的启动费用与 827.1.c.2 的「Discard a spell」非资源费用无法展开，当前仍缺 Empower " +
    "关键词到费用计划的接线与可支付的 spell 弃牌费用（契约 3.1 的 KeywordAbility 只承载关键词身份）；" +
    "(2) 442.1.a 的 Empowered 二元状态不在 ObjectSnapshot / Condition 里，empowered-changed 载荷也没有增加方向过滤的" +
    "消费方（这同时阻断依赖能力门控）；(3)「with 3 :rb_might: or less」是 143.2.a 的当前 Might 上限，冻结 ObjectFilter 没有 Might 谓词、" +
    "已合入过滤器也不读该键（写成过滤器会让本卡放逐任意敌方单位）；" +
    "触发注册适配器已合入。已支持部分：effect.banish 本体在 golden 中按锁定目标真实执行。",
  abilities,
  sourceText:
    "[Empower] — Discard a spell (Pay the cost: Empower me. Use only if not Empowered.)\n" +
    "When I become [Empowered], banish an enemy unit at a battlefield with 3 :rb_might: or less."
} satisfies CardProgram;
