import type { CardProgram } from "../../ir/index.js";

/**
 * Zephyr Sage (ogs-005-024) — Unit, 6 Energy, 1 Power (Calm), 6 Might, Calm, Ionia/Bird.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogs-005-024）：
 *   [Shield] (+1 :rb_might: while I'm a defender.)
 *
 * 规则依据（CR v1.5）：
 * - 814.1 / 814.1.a：Shield 是被动能力关键词，出现在单位上；
 * - 814.1.b.3：省略数值时 X 视为 1，因此 keyword 能力不带 value（默认值由关键词
 *   文件展开时按 1 处理）；
 * - 814.1.c：功能上等价于「只要我是防守方，我就有 +X [M]」；
 * - 814.1.d / 814.1.d.1：防守方 = 战斗中取得 Defender designation（461 / 466.2.c.3），
 *   Shield 只在维持该 designation 期间生效；
 * - 814.2：多个来源授予的 Shield 数值相加（stacking: sum，由关键词文件声明）；
 * - 814.3：是否拥有 Shield 是可被引用的特征，由 keyword 能力条目承载。
 *
 * 卡牌只声明关键词（契约 3.1/3.7、README 第 5 节）；展开（static
 * continuous.might + designation=defender 条件）由 effects/keywords/Shield.ts 负责，
 * 卡文件不重复实现，也不写单卡结算代码。
 *
 * status = judge-required：见 judgeReason —— 没有生产方把卡牌的 keyword 能力
 * 解析为 KeywordDef 展开并接入图层，且 814.1.d 的 Defender designation 不在
 * ObjectSnapshot 中；缺一即不能宣称整卡可执行。
 */
const zephyrSage = {
  canonicalCardId:
    "card.hash-2b68503e65fe0121f9346680649fa82fb83b4edc1e53b3a7416db4848ce941c6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Shield 的展开文件（effects/keywords/Shield.ts：static continuous.might + " +
    "compare(object-property(self, 'designation'), eq, 'defender')）已合入，但合并内核缺三处执行路径：" +
    "(1) 没有生产方把卡牌的 keyword 能力解析为 KeywordDef 展开并注册成 continuous 效果（契约 3.5/3.7）：" +
    "layers/engine.ts 的 registerContinuousEffect 当前没有任何调用方，ResolveContext.addContinuous 只被原语调用、" +
    "读不到卡牌程序的静态/关键词能力；(2) 814.1.d 的 Defender designation 不是 ObjectSnapshot 特征" +
    "（契约 3.8 的 combatRole 增补未进当前 HEAD，interpreter 的 ObjectSnapshot 无该字段）；" +
    "(3) layers/engine.ts 的 conditionMatches 只识别 always/never/type/has-tag/has-keyword，" +
    "未识别的 compare 条件按 true 处理，接线完成后 +1 Might 会被无条件套用、无法只在防守时生效。" +
    "注：duel/shield-description-v1 + createDuelShieldOfficialProgramRegistryV1 + combat/derived-might.ts 对本印刷" +
    "（ogs-005-024）有精确来源元组识别，但那条路径读卡牌目录来源元组、不消费本 CardProgram 的 keyword 能力，" +
    "且需显式 opt-in，不能作为整卡执行证据。依赖：RIFT-81（kw-assault-shield 关键词展开，声明部分已合入）、" +
    "RIFT-91（layers-continuous 条件与卡牌接线）、契约 3.8 combatRole 落地。不近似实现。",
  abilities: [{ kind: "keyword", keyword: "shield" }],
  sourceText: "[Shield] (+1 :rb_might: while I'm a defender.)"
} satisfies CardProgram;

export default zephyrSage;
