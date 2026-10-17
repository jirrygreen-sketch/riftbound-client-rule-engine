import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Jhin, Murderous Artist (unl-022-219) — Unit, 4 energy, 1 power, Might 4,
 * Fury, tags Jhin/Ionia/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-022-219，逐字）：
 *   [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell
 *   or ability.)
 *   [Ganking] (I can move from battlefield to battlefield.)
 *   When I move, [Add] :rb_energy_1::rb_rune_rainbow:. (Abilities that add
 *   resources can't be reacted to.)
 *
 * 规则依据（CR v1.5）：
 * - [Deflect]（809.1）：被动能力关键词；被动地让对手选择我时多付 [A]（809.1.c）。卡只声明
 *   keyword（契约 3.7），展开（target.tax 静态效果）由 effects/keywords/Deflect.ts 负责。
 * - [Ganking]（810.1）：被动能力关键词，为单位的标准移动增加“战场→战场”许可（810.1.b/144.4.c）。
 *   同理只声明 keyword，展开由 effects/keywords/Ganking.ts 负责。
 * - “When I move”（421.1 / 449.1）：成功的 Move 才触发；封闭表的 object-moved 带起止地点种类与
 *   id 的载荷。filter 用事件来源锚点指向本卡（与其他 “When I move” 卡同型）。
 * - “[Add] :rb_energy_1::rb_rune_rainbow:”：430.1/430.5 的 Add 动作，加 1 Energy + 1 点 [A]（任意域）
 *   Power；430.2.a 规定 Add 能力结算时不传递 Priority/Focus，但该窗口属链/费用管线。
 * - 括号里的提醒句不是独立能力（430 附近的提醒文本口径）。
 *
 * status = judge-required（按 2026-10-16 合入批次复核；缺口不近似实现）：
 * - [A]（任意域 Power，135.2.e.5 / 163.2.b）不可表达：契约与内核的 Domain 是 Fury/Calm/Mind/Body/Chaos/Order
 *   六域封闭集合，effect.resources 的文件头明确记录 Universal Power 不可表达、绝不用某个域近似；
 *   本卡把 [A] 记为描述性的 power: [rainbow]（与已合入 ogn/daughter-of-the-void 同一记法），原语对其返回
 *   negated(impossible)——golden 锁定这条失败证据，而不是选一个域冒充。
 * - [Deflect]（809.1.c 的目标税）/[Ganking]（810.1.b 的战场间移动许可）的 KeywordDef 都已合入，
 *   programs/keywords.ts 也会展开它们；静态绑定已存在，但 target.tax 没有映射到目标计划的消费方，
 *   而 Ganking 的 permission 形状仍没有被移动规则查询消费。
 * - object-moved 触发缺注册路径：programs/filters.ts 把 {source:"self"} 归一化为宿主 object 过滤器，
 *   但封闭 EVENT_PATTERN_TYPES 没有 "object-moved"（别名是 zone-entered/zone-left），registerProgramTriggers
 *   抛 invalid-event-type；且 move-location 的发射不带 timing-points.ts 声明的起止地点载荷。
 * 可真实执行的部分：Add 的 1 Energy 半段（effect.resources 的 energy 参数）与关键词声明的结构校验。
 * 依赖：通用 Power 表达（契约变更）、target.tax / movement permission 消费方、
 * object-moved 触发拼写与移动事件载荷。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deflect" },
  { kind: "keyword", keyword: "ganking" },
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      // 421.1/449.1：“When I move” 指本卡成功完成一次 Move。
      filter: { event: "object-moved", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        // “When I move, [Add] :rb_energy_1::rb_rune_rainbow:.”
        id: "jhin.add-energy-and-universal-power",
        op: "effect.resources",
        args: {
          energy: { kind: "constant", value: 1 },
          // [A]：任意域 Power。六域封闭集合下没有可执行值，保留描述性记号（见 judgeReason）。
          power: { kind: "constant", value: ["rainbow"] }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-3539a53a7ed8decc559cac147b6167db91015277a9e34f52eed7548acab3e468",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处缺口，均不近似实现（已按 2026-10-16 合入批次复核）：" +
    "(1) [Add] :rb_rune_rainbow: 的 [A] 任意域 Power 不可表达：契约与内核的 Domain 是 Fury/Calm/Mind/Body/Chaos/Order " +
    "六域封闭集合，effect.resources 的文件头明确记录 163.2.b 的 Universal Power 不可表达、绝不用某个域近似；" +
    "本卡以描述性 power: [rainbow] 保留记号，原语对其返回 negated(impossible)，golden 锁定该失败证据而不是选一个域冒充。" +
    "(2) [Deflect]/[Ganking] 的 KeywordDef 已合入且卡牌 static 已有绑定路径；但 target.tax 尚未接入目标计划的额外费用，" +
    "Ganking 的 continuous.movement permission 形状也尚未被移动规则查询消费。" +
    "(3) object-moved 触发无法注册：封闭 EVENT_PATTERN_TYPES（events/trigger-spec.ts）不含 \"object-moved\"，" +
    "registerProgramTriggers 因此抛 invalid-event-type；move-location 的发射也不带 timing-points.ts 声明的起止地点载荷。" +
    "已可真实执行的部分：effect.resources 的 1 Energy 半段（golden 覆盖）。" +
    "依赖：通用 Power 表达（契约变更）、target.tax / movement permission 消费方、object-moved 触发拼写与移动事件载荷。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
    "When I move, [Add] :rb_energy_1::rb_rune_rainbow:. (Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;

export default program;
