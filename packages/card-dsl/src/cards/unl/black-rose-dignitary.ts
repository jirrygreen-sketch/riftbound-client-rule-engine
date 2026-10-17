import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Black Rose Dignitary (unl-152-219) — Unit, Order, tag Noxus.
 * energy 3（power: null，无印刷力量费）, Might 2.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-152-219，逐字）：
 *   [Assault] (+1 :rb_might: while I'm an attacker.)
 *   [Deathknell][>] Channel 1 rune exhausted. (When I die, get the effect.)
 *
 * 规则依据（CR v1.5）：
 * - [Assault]（807.1.b.3：省略数值视为 1；807.1.c 功能上等于“当我是攻击者时 +1 [M]”；
 *   807.1.d/807.1.d.1：攻击者身份由 Combat 在 466.2.c.3 赋予并在保持期间生效）是关键词；
 *   卡牌只声明（契约 3.1/3.7、README 第 5 节），展开归 effects/keywords/Assault.ts。
 * - [Deathknell]（808.1/808.1.c：功能上等于 “When I die, [Effect]”；808.1.d / 429.1.a.1.b：
 *   触发在替代处理后、实际换区前收集）是触发式能力关键词；其 [Effect] 正文由卡牌程序显式持有，
 *   时点用封闭枚举的 object-killed。
 * - 431.1：Channel 把 Rune Deck 顶的符文放到棋盘上的 Rune 区；431.2/431.2.a 允许效果规定入场状态
 *   （本卡规定 “exhausted”），用已合入的 effect.channel（amount 1、exhausted true）。
 *   431.4.b 明确“由游戏效果指示的 Channel”正是该原语覆盖的范围（Channel Phase 的常规 Channel 不属这里）。
 *
 * status = judge-required（缺口不近似实现）：
 * - [Assault] 的 KeywordDef 展开、卡牌程序静态绑定和 arithmetic 图层已经接通；但展开条件读取
 *   `designation`，而 ObjectSnapshot 提供的是 `combatRole`，生产绑定器对缺失属性 fail-closed，
 *   因而不能只在攻击者期间应用 +1 Might。
 * - [Deathknell] 的 KeywordDef 展开与 object-killed 触发注册已经接通；展开体仍引用没有
 *   InstructionDef 的 trigger.leave，且死亡被替代时移除触发、最后已知信息和离场前收集的完整
 *   语义尚未由该原语承载。
 * 依赖：契约 3.8 的 combatRole/Attacker 特征、trigger.leave 原语及其死亡替代/LKI 语义。
 * Channel 本体（effect.channel，431.1/431.2）已合入，golden 用解释器 + 参考内核真实执行。
 */
const abilities: Ability[] = [
  // 807.1.b.3：印刷未带数值 → Assault 1（默认值由 KeywordDef 提供，卡内不写 value 冒充）。
  { kind: "keyword", keyword: "assault" },
  { kind: "keyword", keyword: "deathknell" },
  {
    // 808.1.c 的 “When I die, [Effect]” 展开结果：触发与正文都显式写在卡内。
    kind: "triggered",
    trigger: {
      at: "object-killed",
      filter: { self: true }
    },
    optional: false,
    body: [
      {
        id: "black-rose-dignitary.channel-rune",
        op: "effect.channel",
        args: {
          amount: { kind: "constant", value: 1 },
          // 431.2：效果规定符文以横置状态进入。
          exhausted: { kind: "constant", value: true }
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-8797765d08c9c34c140c5971815c031caaf8974b4575d37dea511ac5a37f6016",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口，均不近似实现：(1) [Assault]（807.1.c/807.1.d）的 KeywordDef 展开、卡牌程序静态绑定和 arithmetic 图层" +
    "已经接通，但展开条件读取 designation，而 ObjectSnapshot 提供的是 combatRole；生产绑定器对缺失属性 fail-closed，" +
    "不能只在攻击者期间应用 +1 Might。(2) [Deathknell] 的 KeywordDef 展开与 object-killed" +
    "触发注册已经接通，但展开体仍引用没有 InstructionDef 的 trigger.leave；死亡被替代时移除触发、" +
    "最后已知信息和离场前收集的语义也没有可执行承载。依赖：契约 3.8 的 combatRole/Attacker 特征、" +
    "trigger.leave 原语及其死亡替代/LKI 语义。Channel 1 rune exhausted 本体（effect.channel，431.1/431.2）已合入，" +
    "golden 用解释器 + 参考内核真实执行该半段。",
  abilities,
  sourceText:
    "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
    "[Deathknell][>] Channel 1 rune exhausted. (When I die, get the effect.)"
} satisfies CardProgram;
