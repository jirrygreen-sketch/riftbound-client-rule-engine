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
 * status 判定（README 第 2 节）：Temporary 的 KeywordDef 已合入
 * （effects/keywords/Temporary.ts：816.1.b 展开为 beginning-start 的
 * 「kill this」触发，effect.kill 已合入），但整张卡仍不可执行：
 * 1. 展开出的触发无法进入管线：TriggerSpec/EventPattern 的封闭事件词表
 *    （events/trigger-spec.ts 的 EVENT_PATTERN_TYPES）不含 beginning-start，
 *    pipeline.registerTrigger 的 assertTriggerSpec 会拒绝该事件名；
 * 2. 关键词展开虽然已有程序绑定入口，但 beginning-start 仍无法通过触发
 *    事件词表和注册校验进入实时事件管线。
 */
const sprite = {
  canonicalCardId: "card.hash-610cc33146e5be610b1b548bd327d47a44aba21edb081e7669cba4971753ccef",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Temporary 的 KeywordDef 已合入（effects/keywords/Temporary.ts：816.1.b 展开为" +
    "「在控制者 Beginning Phase 开始时（beginning-start，计分前）kill this」的触发，effect.kill 已合入），" +
    "但整卡仍不可执行：(1) beginning-start 时点本身已由回合流程发出（turn/flow.ts 的 enter/emit），" +
    "但 TriggerSpec 的事件词表（events/trigger-spec.ts 的 EVENT_PATTERN_TYPES）不含该阶段时点，" +
    "registerTrigger 的 assertTriggerSpec 会以 invalid-event-type 拒绝该展开的 filter；(2) 因而" +
    "beginning-start 仍无法进入实时事件管线。不近似实现。",
  abilities: [{ kind: "keyword", keyword: "temporary" }],
  sourceText:
    "[Temporary] (Kill me at the start of your Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default sprite;
