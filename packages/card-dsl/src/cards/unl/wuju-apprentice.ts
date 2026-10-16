import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Wuju Apprentice (unl-040-219) — Unit, 2 Energy, Might 2, Calm, tag Ionia.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-040-219，逐字）：
 *   [Hunt] (When I conquer or hold, gain 1 XP.)
 *   [Level 6][>] When you play me, draw 1. (While you have 6+ XP, get the effect.)
 *
 * 规则依据（CR v1.5）：
 * - [Hunt]：823.1 的 Triggered Ability 关键词（既是 Conquer 也是 Hold effect，823.1.b）；
 *   823.1.c.1 的功能写法是 “When I Conquer or Hold, my controller gains X XP”，823.1.c.2 规定
 *   省略 X 时按 1（提醒文字同值），823.1.c.3 的 Hunt Value 与 823.2 的求和由关键词文件与注册表负责。
 *   按契约 3.7 / README 第 5 节，卡文件只声明 `{ kind: "keyword", keyword: "hunt" }`。
 * - [Level 6][>]：824.1 的 Dependent Keyword；824.1.a 给出 “［Level [N]]［>] [Text]” 的格式，
 *   824.1.b / 824.1.b.1 说明从关键词到子句结尾整段是 Level Ability，功能上等于“当你有 [N] 点或
 *   更多 XP 时，本牌获得「[Text]」”，824.1.b.2 的 [Text] 是 Dependent Ability；824.1.c 规定只要
 *   控制者有 [N] XP，依赖能力即为 Active（824.1.c.1 换控制者重判、824.1.d 掉到 [N] 以下立即
 *   Inactive）；824.2 说明是否拥有 Level 是可读取特征。本卡的 [Text] 是
 *   “When you play me, draw 1.” 所以依赖能力是一条打出触发（383.4.a / 420.4.a，时点 card-played，
 *   来源为自身）。
 * - “draw 1”：414.1 / 414.3 的抽牌，已合入的 effect.draw 只提交封闭集合里的 draw 动作，
 *   抽牌者缺省为能力控制者（190.6.d 的隐含 “you”）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 没有 Hunt 的 KeywordDef（effects/keywords/ 无 Hunt 文件），823.1.b 的 conquer / hold 两个
 *   触发与 effect.xp 展开无从执行（823.1.c.2 的默认值 1 由关键词文件承担）。
 * - 没有 Level 的展开（kw-level）：824.1.c 的“[N] XP 或更多时依赖能力 Active、掉到以下立即
 *   Inactive”需要可求值的 XP 谓词，而冻结的 Condition 只有 always/never/expression/compare/
 *   all/any/not，PlayerSnapshot.xp 没有进入 Expr 的路径，count 表达式只数被查询对象。因此本程序
 *   把 824.1.c 的门控保留为 TriggerSpec.condition 的 compare 形状（与 unl/wuju-master 的处理一致），
 *   并明确它不是可执行的 XP 读取。
 * - 卡牌 keyword 能力 → KeywordDef 展开 → 触发注册的生产方也未合入（契约 3.5/3.7）。
 * 依赖：kw-hunt 与 kw-level 关键词任务（ability-templates 的 kw-hunt / kw-level 行）与
 * RIFT-89/90（条件/谓词管线）、RIFT-33/RIFT-120（触发→链）。
 * 不近似实现：不手写 Hunt 的 conquer/hold 触发体，也不把 6+ XP 门控删成无条件能力；
 * “draw 1” 本体只用已合入的 effect.draw，golden 用解释器 + 参考内核真实执行。
 */
const abilities: Ability[] = [
  // 823.1.c.2：印刷省略 Hunt Value，按 1 处理。
  { kind: "keyword", keyword: "hunt" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } },
      // 824.1.c 的门控：控制者有 6 点或更多 XP 时依赖能力 Active。
      // 保留形状（见 judgeReason）：合并的 Condition 读不到 PlayerSnapshot.xp。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "controller-xp",
          filter: { player: "controller" }
        },
        operator: "gte",
        right: { kind: "constant", value: 6 }
      }
    },
    optional: false,
    body: [
      {
        id: "wuju-apprentice.draw-1",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-e074cc6d861492ad66a59dfbd4aee7f822557cbb0d0e6d32f02e2690c97a07a2",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处缺口，均不近似实现：(1) [Hunt]（823.1）没有 KeywordDef：effects/keywords/ 下无 Hunt 文件，" +
    "823.1.b/823.1.c.1 的 conquer 与 hold 触发（823.1.c.2 省略值按 1、823.2 多来源求和）以及 " +
    "卡牌 keyword 能力 → 关键词展开 → 触发注册的生产方（契约 3.5/3.7）都未合入，hold 侧的" +
    "“本卡是在场固守的那一个单位”载荷绑定（383.4.d.2/.2.a）也没有接线。" +
    "(2) [Level 6][>]（824.1）没有展开：824.1.b.1 的“当你有 [N] 点或更多 XP 时获得 [Text]”与 " +
    "824.1.c/824.1.d 的动态 Active/Inactive 需要可求值的 XP 谓词，而合并的 Condition 只有 " +
    "always/never/expression/compare/all/any/not，PlayerSnapshot.xp 没有进入 Expr 的路径（count 只数被查询对象），" +
    "因此本程序的 TriggerSpec.condition 只是 824.1.c 门控的保留形状，不可执行。" +
    "依赖：kw-hunt 与 kw-level 关键词任务（ability-templates 的对应行）、RIFT-89/90（条件/谓词管线）、" +
    "RIFT-33/RIFT-120（触发→链）。“draw 1” 本体只用已合入的 effect.draw（414.1/414.3），" +
    "golden 用解释器 + 参考内核真实执行。",
  abilities,
  sourceText:
    "[Hunt] (When I conquer or hold, gain 1 XP.)\n" +
    "[Level 6][>] When you play me, draw 1. (While you have 6+ XP, get the effect.)"
} satisfies CardProgram;

export default program;
