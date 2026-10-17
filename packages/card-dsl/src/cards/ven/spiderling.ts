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
 * RIFT-672：amount 必须是同名集合的 count，不能用 count >= 1 门控常量 +1。
 * characteristics.name 保留既有 object-property 表达式描述名称自指；这不是已支持的
 * 动态过滤器语义，仍须统一契约与消费者。生产图层尚不求值 count amount，整卡不升级。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，缺口均不近似实现：
 * 1. [Hidden] 的 KeywordDef 已合入，cost/kinds/hidden.ts 也已合入 hide/play 两种费用
 *    计划（811.1.b），但 Hide 行动的打出许可、面朝下区域限制、Hidden 移动与 811.1.d
 *    的反应式打出接线仍缺（hidden.ts 文件头明确归属 zone/timing 侧）。
 * 2. “with my name” 的名称自指没有可求值谓词：合并过滤器只按字面值比较，读不到宿主当前
 *    名称；“for each” 的 count amount（N 个同名 → +N）图层求值路径未合入。
 * 3. 第三行的构筑许可没有消费方：engine-core/src/deck/index.ts 只是占位 export，契约的
 *    deckbuilding?: DeckbuildingDecision[] 没有已定义的 kind 词汇与校验消费方，因此只在数据里
 *    保留一条描述性记录，不由卡内自造一套构筑限制（deckLimit 图层查询已存在，但未接 deckbuilding 字段）。
 * 已支持部分：“other units here” 子过滤器在参考内核里可计数；不把它当作完整名称条件。
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
      // 143.2.a：“for each” 是持续的 +N，不是一次性的 +1 或 Buff。
      amount: {
        kind: "count",
        subject: "other-units-here-with-my-name",
        filter: {
          type: "unit",
          zone: "board",
          controller: "controller",
          sameLocationAs: "self",
          exclude: "self",
          // 保留名称比较两端；动态特征表达式仍没有求值消费者，见 judgeReason。
          characteristics: {
            name: { kind: "object-property", object: "self", property: "name" }
          }
        }
      }
    }
  }
];

export default {
  canonicalCardId: "card.hash-1400b3c0af1e862d41c3291804cf107f4abf2a01f86c47c825fafff617f972a7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺口（复核 2026-10-17，均不近似实现）：(1) [Hidden] 的 KeywordDef 与 cost/kinds/hidden.ts 的 " +
    "hide/play 费用计划（811.1.b）均已合入，但 Hide 行动的打出许可、面朝下区域限制、Hidden 移动与 " +
    "811.1.d 的反应式打出接线仍缺（hidden.ts 文件头归属 zone/timing 侧）；" +
    "(2)「for each other unit you control here with my name」的名称自指没有可求值谓词（合并过滤器只做字面比较，" +
    "读不到宿主当前名称；characteristics.name 中的 self.name 表达式仅保留描述性 IR，需统一契约与消费者），" +
    "且 continuous.might 图层尚不求值 count amount，N 倍缩放（N 个同名 → +N）的求值路径未合入；" +
    "卡牌侧 continuous.might 注册入口已合入，不再是缺口；" +
    "(3)「Your deck can have any number of cards named Spiderling」是 103.3.b 的 Deck Constraint Permission，" +
    "但 engine-core/src/deck/index.ts 只是占位 export，deckbuilding 的 kind 词汇与消费方未定义，" +
    "因此只保留描述性记录，不在卡内自造构筑限制（deckLimit 图层查询已存在，但未接 deckbuilding 字段）。" +
    "已支持部分：count + sameLocationAs + exclude 的子集合在 golden 中真实求值；模板 keyword-static-672 " +
    "通过实际付费打出验证无其他同名单位时的边界，不能证明 Hidden 或动态 +N 已执行。" +
    "依赖：Hidden 打出许可接线、名称谓词、N 倍 amount 求值、deckbuilding 消费者。",
  abilities,
  // 103.3.b / 103.3.b.1：本印刷覆盖「同名牌最多 3 张」的默认限制；只作为数据记录，
  // 构筑期强制由未合入的 deck 消费方负责（见 judgeReason 第 3 点）。
  deckbuilding: [{ kind: "unlimited-copies-of-this-name" }],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "I have +1 :rb_might: for each other unit you control here with my name.\n" +
    "Your deck can have any number of cards named Spiderling."
} satisfies CardProgram;
