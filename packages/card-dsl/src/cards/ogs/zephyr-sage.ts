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
 * status = executable：整卡能力均有真实执行证据——
 * - 关键词展开经 expandProgram（keywords.ts，stacking: sum）合入；
 * - 生产卡牌程序 → 图层路径已合入：attachProgramLifecycle + createEngineStaticBinder
 *   把展开后的 static continuous.might 注册进图层注册表；
 * - CR 814.1.d.1 的防守期门由条件闭包承载：求值时的生产 environment 通过
 *   layers.snapshot 读取 LayeredObjectSnapshot；当前快照没有 designation 特征时
 *   object-property 抛 MissingInformation、条件按 fail-closed 处理为 false
 *   （防守期外 +1 不生效），不会退化为无条件 +1。桥接测试把当次战斗的
 *   combatRole/designation 挂到求值快照上，证明条件为真时 +1 精确生效、条件为假或
 *   解除绑定时回到印刷 Might（CR 814.2 的求和由 expandProgram 聚合）。
 */
const zephyrSage = {
  canonicalCardId:
    "card.hash-2b68503e65fe0121f9346680649fa82fb83b4edc1e53b3a7416db4848ce941c6",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [{ kind: "keyword", keyword: "shield" }],
  sourceText: "[Shield] (+1 :rb_might: while I'm a defender.)"
} satisfies CardProgram;

export default zephyrSage;
