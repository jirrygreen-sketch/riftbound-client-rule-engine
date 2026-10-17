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
 * 「kill this」触发，effect.kill 已合入），但整张卡仍不可执行（复核
 * 2026-10-17，缺口均已实测）：
 * 1. 展开出的触发无法进入管线：TriggerSpec/EventPattern 的封闭事件词表
 *    （events/trigger-spec.ts 的 EVENT_PATTERN_TYPES）不含 beginning-start，
 *    对展开结果直接调用 assertTriggerSpec 会抛 TriggerSpecValidationError
 *    （invalid-event-type），因此 pipeline.registerTrigger 无法登记该触发；
 * 2. 关键词展开已有程序绑定入口（programs/keywords.ts 的 expandProgram），
 *    但 registerProgramTriggers 在真实 attachProgramLifecycle 下仍以同一
 *    校验失败，beginning-start 无法进入实时事件管线；
 * 3. 本卡是 token 身的卡面（187.2 的 3 Might Sprite），而 effect.token 的冻结
 *    定义表不含 sprite，因此“作为 token 被产生”这一侧也没有可执行定义——
 *    本文件只负责它自身的 Temporary 关键词声明。
 */
const sprite = {
  canonicalCardId: "card.hash-610cc33146e5be610b1b548bd327d47a44aba21edb081e7669cba4971753ccef",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Temporary 的 KeywordDef 已合入（effects/keywords/Temporary.ts：816.1.b 展开为「在控制者 Beginning Phase " +
    "开始时（beginning-start，计分前）kill this」的触发，effect.kill 已合入），但整卡仍不可执行（复核 " +
    "2026-10-17，均已实测）：(1) TriggerSpec 的事件词表（events/trigger-spec.ts 的 EVENT_PATTERN_TYPES）不含 " +
    "beginning-start，对展开结果调用 assertTriggerSpec 会抛 TriggerSpecValidationError（invalid-event-type），" +
    "因此 pipeline.registerTrigger 无法登记该触发；时点本身已由 turn/flow.ts 发出（enter/emit），缺的是事件词表/绑定适配。" +
    "(2) 关键词展开的程序绑定入口（programs/keywords.ts 的 expandProgram）已合入，但真实 attachProgramLifecycle 下 " +
    "registerProgramTriggers 仍以同一校验失败，beginning-start 进不了实时事件管线。" +
    "(3) 本卡是 187.2 的 3 Might Sprite token 卡面，而 effect.token 的冻结定义表不含 sprite，token 产生侧也没有可执行定义。" +
    "依赖：beginning-start 的触发事件词表/管线接线与 sprite token 定义。不近似实现。",
  abilities: [{ kind: "keyword", keyword: "temporary" }],
  sourceText:
    "[Temporary] (Kill me at the start of your Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default sprite;
