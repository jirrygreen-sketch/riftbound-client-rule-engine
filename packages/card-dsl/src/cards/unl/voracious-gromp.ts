import type { CardProgram } from "../../ir/index.js";

/**
 * Voracious Gromp (unl-100-219) — Unit，能量 5，无印刷力量，Might 5，领域 Body，标签 Freljord。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-100-219，逐字）：
 *   [Hunt 3] (When I conquer or hold, gain 3 XP.)
 *
 * 规则依据（CR v1.5）：
 * - 823.1 / 823.1.a：Hunt 是触发式能力关键词，只存在于 Unit 上。
 * - 823.1.b：Hunt 同时是 Conquer 与 Hold 效果；823.1.c 的格式是 “Hunt X”，
 *   823.1.c.3 称 X 为 Hunt Value（本卡 X = 3）。
 * - 823.1.c.1：功能上等于 “When I Conquer or Hold, my controller gains X XP.”；
 *   获得者按 190.6.d 的隐含指向是能力控制者（即该单位的控制者）。
 * - 823.2：多来源授予的 Hunt 数值相加（叠加规则属关键词展开）。
 * - 823.3：是否拥有 Hunt 是可读取的单位特征。
 * - 730.1 / 733：Gain X XP 把获得者的 XP 增加 X；XP 无上限，数量在结算时取值。
 *
 * 结构（契约 3.1 / README 第 5 节）：整张卡只有印刷的 [Hunt 3]，按
 * `{ kind: "keyword", keyword: "hunt", value: 3 }` 只声明关键词（本关键词带数值，不能省略 value）。
 * 展开（订阅 conquer / hold 两个封闭时点、823.2 的数值相加合为一个触发、body 调用已合入的
 * effect.xp）由 engine-core 的关键词注册表负责（契约 3.7）；卡文件不手写同一套展开逻辑，
 * 也不自行推进链或优先权。
 *
 * status = judge-required（README 第 2 节：所需关键词依赖尚不可执行）：
 * effects/keywords/ 没有 Hunt 定义（已合入的关键词不含 Hunt），因此 Hunt 值 3 无法
 * 展开为 conquer/hold 触发；并且没有 CardProgram→时点/链的触发注册（契约 3.5），
 * 即使展开体存在也进不了链。effect.xp 原语（730.1/733）本身已合入，golden 用参考内核
 * 真实执行「gain 3 XP」这一步；局部原语执行不构成整卡证据，见 judgeReason 与 test.todo。
 */
export default {
  canonicalCardId:
    "card.hash-f8b8f40872bd80284cc23f0fb215719625d48e00be1b8ed248c2a494ad0a5bad",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 [Hunt 3] 的关键词展开与触发接线，均不近似实现：(1) effects/keywords/ 没有 Hunt 定义，" +
    "823.1.c.1 需要把 Hunt 值展开为 conquer 与 hold 两个时点订阅、以 effect.xp 为 body 的触发能力，" +
    "并按 823.2 把多来源 Hunt 数值相加合为一个触发（stacking 由 KeywordDef 声明）；" +
    "(2) 没有 CardProgram→时点/链的触发注册（契约 3.5），conquer / hold（events/timing-points.ts 的 " +
    "scoring 类时点）没有任何订阅方把本卡的触发能力注册进单管线（引擎批 4 / RIFT-120 接线）。" +
    "effect.xp 原语本身已合入，golden 用参考内核真实执行「gain 3 XP」这一步；依赖关键词工作流（新增 " +
    "keywords/Hunt.ts）与引擎批 4 的触发/事件管线。",
  abilities: [
    // 823.1：印刷的 [Hunt 3]；展开由关键词注册表负责，卡文件只声明关键词与数值。
    { kind: "keyword", keyword: "hunt", value: 3 }
  ],
  sourceText: "[Hunt 3] (When I conquer or hold, gain 3 XP.)"
} satisfies CardProgram;
