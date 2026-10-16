import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Dunebreaker (sfd-027-221) — Unit, Fury, The Void.
 * energy 7, power 1 (Fury), Might 7.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-027-221，逐字，含换行）:
 *   "If you have two or fewer cards in your hand, I enter ready.\n"
 *   "When I hold, draw 2."
 *
 * 规则依据（CR v1.5）:
 * - "I enter ready"（359.2.c、369.3 例 Master Yi, Honed）：这是入场替代效果——把单位的
 *   「横置入场」替换为「就绪入场」；effect.ready 文件头明确本原语不参与该流程，不能用
 *   「先横置入场再 effect.ready」近似（805.6.a 同源：不经过先横置再就绪，也不补发
 *   becomes-ready 事件）。因此按契约 3.1 的 replacement 形状表达。
 *   「If you have two or fewer cards in your hand」是替代效果的适用条件（369.3 的
 *   "identified by describing how the unit enters"），写在替代能力自身的 condition 上。
 * - "When I hold"（383.4.d、383.4.d.2.a）：Hold Effect，时点 hold（scoring/ 发射，
 *   ruleRefs 315.2.b.2/471.2/473.2.b），filter 用内层 source: "self" 指称本卡。
 * - "draw 2"：414.3/414.1.a，缺省抽牌者与来源是能力控制者的 Main Deck 顶；已合入的
 *   effect.draw 只提交封闭的 draw GameAction，牌库顺序与 Burn Out 由内核负责。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 入场替代依赖 replacement.enter 的接线与执行（契约 3.1 的 replacement 能力到事件管线
 *   替代注册的适配路径尚未合入；sfd/breakneck-mech、sfd/vayne-hunter 记录同一批次缺口），
 *   且条件里的「手牌 ≤ 2 张」需要一个手牌数量谓词（ObjectSnapshot/Expr 没有手牌计数读取），
 *   既非静态常量也非已有的 count 过滤键。
 * - hold 触发本身只用已合入时点与 effect.draw，golden 测试对 draw 体做真实执行。
 * 依赖：RIFT-89~91（replacement.enter / layers 批次）、手牌数量条件表达、触发→链管线
 * （RIFT-33/RIFT-120）。不近似实现（不把 enter ready 写成事后 effect.ready，也不把
 * 手牌条件写成常量）。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: {
      event: "object-enters-board",
      filter: { self: true, exhausted: true }
    },
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "objects",
        filter: { zone: "hand", owner: "controller" }
      },
      operator: "lte",
      right: { kind: "constant", value: 2 }
    },
    with: [
      {
        id: "dunebreaker.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  },
  {
    kind: "triggered",
    trigger: { at: "hold", filter: { event: "hold", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        id: "dunebreaker.draw-2",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 2 } }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-85f0797777f47ae8cbaf1fc45bef08bec2cab5e31a48fa3cff8568018fc7ff8d",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「If you have two or fewer cards in your hand, I enter ready」是入场替代效果（359.2.c、369.3；" +
    "effect.ready 文件头明确不参与入场替代，不能近似为先横置再重置）：缺 replacement.enter 的接线与执行" +
    "（契约 3.1 replacement 能力 → 事件管线替代注册尚无适配路径，sfd/breakneck-mech 与 sfd/vayne-hunter 记录同一缺口），" +
    "并且「你手牌 ≤ 2 张」的 count 过滤器（zone: hand + owner: controller）无法正确求值：" +
    "owner: \"controller\" 是 Finalize 目标管线专用的占位符（见 sfd/pit-rookie、ogs/annie-stubborn 的注释），" +
    "解释器的 count 直接经 ctx.query 读取，不做该占位符归一化，因此计数会落到 0 而非真实手牌数——" +
    "在归一化落地前断言该条件等于把「必定成立」写成预期，按红线不近似实现。" +
    "hold 触发（383.4.d，时点 hold）与 effect.draw 已合入并有执行测试。" +
    "依赖：RIFT-89~91（replacement.enter / layers 批次）、手牌数量条件表达、RIFT-33/RIFT-120（触发进链）。不近似实现。",
  abilities,
  sourceText:
    "If you have two or fewer cards in your hand, I enter ready.\n" +
    "When I hold, draw 2."
} satisfies CardProgram;

export default program;
