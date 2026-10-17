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
 * status = judge-required：关键词展开与卡牌程序生命周期已合入，但 Shield 展开读取
 * designation，而生产 ObjectSnapshot 在战斗中提供 combatRole。当前图层条件求值没有
 * combatRole → designation 的适配，因此真实防守快照仍按印刷 Might 计算；不能用测试
 * 手动补写 designation 来宣称整卡可执行。待生产路径完成该映射并有正向执行证据后再升级。
 */
const zephyrSage = {
  canonicalCardId:
    "card.hash-2b68503e65fe0121f9346680649fa82fb83b4edc1e53b3a7416db4848ce941c6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Shield 的 KeywordDef 展开与 CardProgram 生命周期绑定已合入（RIFT-257）：" +
    "effects/keywords/Shield.ts 产生 compare(object-property(self, 'designation'), eq, 'defender')，" +
    "但生产 ObjectSnapshot 的战斗字段是 combatRole（契约 3.8），当前图层条件求值没有" +
    " combatRole → designation 的映射，因此真实防守单位仍保持印刷 Might，不能证明 CR 814.1.c " +
    "的 +1 可执行。保持 judge-required，待生产路径具备该适配与正向执行测试后升级。",
  abilities: [{ kind: "keyword", keyword: "shield" }],
  sourceText: "[Shield] (+1 :rb_might: while I'm a defender.)"
} satisfies CardProgram;

export default zephyrSage;
