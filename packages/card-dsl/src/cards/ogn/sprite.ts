import type { CardProgram } from "../../ir/index.js";

/**
 * Sprite (ogn-274-298) — Colorless Fae unit token.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-274-298):
 *   [Temporary] (Kill me at the start of your Beginning Phase, before scoring.)
 *
 * 规则依据（CR v1.5）：
 * - 816.1：Temporary 是触发能力关键词；816.1.a 出现在永久物上。
 * - 816.1.b：功能上等于「At the start of this permanent's controller's
 *   Beginning Phase, before scoring, kill this.」。
 * - 816.1.c：触发条件是「该永久物控制者的 Beginning Phase 开始」。
 * - 816.2 / 816.2.a：多个 Temporary 实例冗余，无论多少个都只触发一次。
 * - 816.3：是否具有 Temporary 是可读取的特征。
 * - 187.2：3 [M] Sprite token 是无领域（domainless）单位 token，3 Might、
 *   Fae 标签、具有 Temporary；Might/标签/关键词由产生它的效果的 token 定义
 *   给出（187），不属于本卡自身的能力文本。
 *
 * 结构：整张卡只有关键词能力，按契约 3.1 / README 第 5 节写
 * `{ kind: "keyword", keyword: "temporary" }`（无印刷数值，省略 value）。
 * 展开（订阅自身控制者的 Beginning Phase 开始、在该时点 kill this）由
 * engine-core 的关键词注册表负责（契约 3.7），卡牌程序不重复展开。
 *
 * status 判定（README 第 2 节）：keywords/ 目录当前没有 Temporary 定义
 * （已合入的 16 个关键词不含 Temporary；ability-templates 的 kw-temporary
 * 行同样把 trigger.phase + effect.kill 列为待实现），且没有内核路径把
 * 关键词能力接入时点与链，因此整张卡保持 judge-required，不近似实现。
 */
const sprite = {
  canonicalCardId: "card.hash-610cc33146e5be610b1b548bd327d47a44aba21edb081e7669cba4971753ccef",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Temporary 关键词展开（CR 816.1.b / 816.1.c）：engine-core 的 " +
    "effects/keywords/ 当前没有 Temporary 定义（RIFT-83/84 的 16 个已合入关键词不含它），" +
    "需要把 816.1.b 展开为「在控制者 Beginning Phase 开始时（beginning-start，早于计分）kill this」的" +
    "触发能力（effect.kill 原语已合入）；同时没有内核路径把卡牌的 keyword 能力解析到 KeywordDef 并接入时点与链" +
    "（契约 3.5）。依赖：新增 keywords/Temporary.ts（关键词工作流 RIFT-81~88 的同类任务）、" +
    "ability-templates.md 的 kw-temporary 行（trigger.phase + effect.kill）。不近似实现。",
  abilities: [{ kind: "keyword", keyword: "temporary" }],
  sourceText:
    "[Temporary] (Kill me at the start of your Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default sprite;
