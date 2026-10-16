import type { CardProgram } from "../../ir/index.js";

/**
 * Stalwart Poro (ogn-052-298) — Unit, 2 Energy, 2 Might, Calm, Poro.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-052-298）：
 *   [Shield] (+1 :rb_might: while I'm a defender.)
 *
 * 规则依据（CR v1.5）：
 * - 814.1 / 814.1.a：Shield 是被动能力关键词，出现在单位上；
 * - 814.1.b.3：省略数值时 X 视为 1，因此 keyword 能力不带 value（由关键词文件按
 *   默认值 1 展开）；
 * - 814.1.c：功能上等价于「只要我是防守方，我就有 +X [M]」；
 * - 814.1.d/814.1.d.1：防守方 = 战斗中取得 Defender designation，Shield 只在维持
 *   该 designation 期间生效；
 * - 814.2：多个来源授予的 Shield 数值相加（stacking: sum，由关键词文件声明）；
 * - 814.3：是否拥有 Shield 是可被引用的特征，由 keyword 能力条目承载。
 *
 * 卡牌只声明关键词（契约 3.1/3.7、README 第 5 节）；展开（static
 * continuous.might + designation=defender 条件）由 effects/keywords/Shield.ts 负责。
 *
 * status = judge-required：Shield 展开所需的 continuous.might 指令（RIFT-258）与
 * Shield KeywordDef（RIFT-81）均已合入，但整卡仍不可执行：没有消费方把卡牌静态能力/
 * 关键词展开注册成持续的 continuous.might 效果（卡牌程序绑定 RIFT-257），
 * 且 814.1.d 的 Defender designation 不在 ObjectSnapshot 中。
 */
const stalwartPoro = {
  canonicalCardId:
    "card.hash-d758a4eb01d27daf80036a95c8930bef4e01df5c77bf18f8f92392c7dd708701",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Shield 的展开文件（effects/keywords/Shield.ts：static continuous.might + " +
    "compare(object-property(self, 'designation'), eq, 'defender')）与 continuous.might 指令（RIFT-258）已合入，" +
    "但合并内核缺两处：(1) 没有消费方把卡牌静态能力/关键词展开注册成 continuous 效果" +
    "（卡牌程序绑定 RIFT-257；ResolveContext.addContinuous 目前只被原语调用，读不到卡牌程序的静态能力）；" +
    "(2) 814.1.d 的 Defender designation 不在 ObjectSnapshot 特征里" +
    "（契约 3.8 的 combatRole 增补仍停留在 RIFT-105 分支，未进 HEAD），且 layers/engine.ts 的 " +
    "conditionMatches 只识别 always/never/type/has-tag/has-keyword，未识别的 compare 条件按 true 处理，" +
    "会把 +1 Might 无条件套用。缺少的是「卡牌静态能力 → 图层注册」接线与 combatRole 特征，均不属于" +
    "本卡的 write scope；依赖：RIFT-257、契约 3.8 combatRole 落地。不近似实现。",
  abilities: [{ kind: "keyword", keyword: "shield" }],
  sourceText: "[Shield] (+1 :rb_might: while I'm a defender.)"
} satisfies CardProgram;

export default stalwartPoro;
