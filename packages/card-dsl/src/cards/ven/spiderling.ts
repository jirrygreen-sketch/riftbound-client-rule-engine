import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Spiderling (ven-097-166) — Unit, Chaos, tags Shadow Isles/Spider.
 * 3 Energy, no printed Power（`power: null`，不是 0），Might 1。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-097-166，逐字）：
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)
 *   I have +1 :rb_might: for each other unit you control here with my name.
 *   Your deck can have any number of cards named Spiderling.
 *
 * 规则依据（Core Rules v1.5）：
 * - 811：​[Hidden] 是执行 Hide 自由行动的前提关键词；卡只声明关键词身份，展开属
 *   effects/keywords/Hidden.ts（契约 3.7、README 第 5 节）。
 * - 143.2.a / 475–477：“I have +1 :rb_might: for each …” 是算术图层（arithmetic）的持续
 *   Might 修正，不是 702 的 Buff 计数器（本卡不放置任何 Buff）。
 * - “for each other unit you control here with my name” 是按特征程序化选出的集合计数
 *   （355.10.d）："other" 排除宿主自身（355.9.c），"here" 是与宿主同一地点（359.3.f.1），
 *   "you control" 是宿主控制者，“with my name” 是名称自指。
 * - 103.3.b：主牌库默认“同名牌最多 3 张”；本卡的第三行是 Deck Constraint Permission，
 *   允许任意数量同名（103.3.b.1 说明精选冠军也计入 3 张上限，而本卡是显式覆盖）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，四处缺口均不近似实现：
 * 1. [Hidden] 的 KeywordDef 已合入，但其消费方缺失：Hidden.ts 自己记录 cost.hidden /
 *    cost.pay / effect.zone / continuous.timing 均未合入，Hide 行动与面朝下区域的免费打出
 *    许可没有执行路径（RIFT-89/RIFT-91）。
 * 2. “with my name” 的名称自指没有可求值谓词：合并过滤器只按字面值比较，读不到宿主当前名称；
 *    另外已合入 layers/engine.ts 的 conditionMatches 只识别 always/never/type/has-tag/
 *    has-keyword，其余 Condition（含 compare/count）一律返回 true，因此这条“for each”也不能
 *    被诚实求值（RIFT-91 后续的图层谓词）。
 * 3. 没有把 CardProgram 的 static continuous.might 注册成 ContinuousEffectSpec 的卡牌侧入口
 *    （RIFT-91 只交付了图层引擎）。
 * 4. 第三行的构筑许可没有消费方：engine-core/src/deck/index.ts 只是占位 export，契约的
 *    deckbuilding?: DeckbuildingDecision[] 没有已定义的 kind 词汇与校验消费方，因此只在数据里
 *    保留一条描述性记录，不由卡内自造一套构筑限制（同 sfd/forgefire-cape 的记录口径）。
 * 已支持部分：“other units here” 的集合计数（count + sameLocationAs + exclude）可以用
 * condition.predicate 在参考内核里真实求值，见 golden 测试；名称条件与图层注册写 test.todo。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "hidden"
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
    // “for each other unit you control here with my name”：至少 1 个满足条件才有 +1。
    // 条件形状按契约 3.6 写出（exclude="self" 表达 other，sameLocationAs="self" 表达 here）；
    // “with my name” 与图层求值缺口见 judgeReason 第 2、3 点。
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "other-units-here-with-my-name",
        filter: {
          type: "unit",
          zone: "board",
          controller: "controller",
          sameLocationAs: "self",
          exclude: "self"
        }
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

export default {
  canonicalCardId: "card.hash-1400b3c0af1e862d41c3291804cf107f4abf2a01f86c47c825fafff617f972a7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：(1) [Hidden] 的 KeywordDef 已合入但没有消费方——Hidden.ts 记录 cost.hidden / " +
    "cost.pay / effect.zone / continuous.timing 均未合入，Hide 行动与面朝下区域的免费打出许可无执行路径（RIFT-89/RIFT-91）；" +
    "(2)「for each other unit you control here with my name」的名称自指没有可求值谓词（合并过滤器只做字面比较，" +
    "读不到宿主当前名称），且已合入 layers/engine.ts 的 conditionMatches 只识别 always/never/type/has-tag/has-keyword，" +
    "其余 Condition（含 compare/count）一律返回 true（RIFT-91 后续的图层谓词）；" +
    "(3) 没有把 CardProgram 的 static continuous.might 注册成 ContinuousEffectSpec 的卡牌侧入口；" +
    "(4)「Your deck can have any number of cards named Spiderling」是 103.3.b 的 Deck Constraint Permission，" +
    "但 engine-core/src/deck/index.ts 只是占位 export，deckbuilding 的 kind 词汇与消费方未定义，" +
    "因此只保留描述性记录，不在卡内自造构筑限制。已支持部分：count + sameLocationAs + exclude 的集合计数用 " +
    "condition.predicate 在 golden 中真实求值。依赖：RIFT-89/RIFT-91 与名称谓词、deckbuilding 消费者。",
  abilities,
  // 103.3.b / 103.3.b.1：本印刷覆盖「同名牌最多 3 张」的默认限制；只作为数据记录，
  // 构筑期强制由未合入的 deck 消费方负责（见 judgeReason 第 4 点）。
  deckbuilding: [{ kind: "unlimited-copies-of-this-name" }],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "I have +1 :rb_might: for each other unit you control here with my name.\n" +
    "Your deck can have any number of cards named Spiderling."
} satisfies CardProgram;
