import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Cursed Sarcophagus (unl-148-219) — Gear, 4 energy + 1 Chaos power, Might null（无印刷 Might）。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json, unl-148-219）：
 *   "When you play this, banish all units from your trash.\n" +
 *   ":rb_exhaust:: Play a unit banished with this. (You must pay its costs.)"
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a / 383.4.a.1："When you play this" 是 Gear 的 Play Effect，对应时点
 *   card-played（359 / 407），filter 指向本卡自身。
 * - 428.1 / 428.2："banish all units from your trash" 是 Banish 动作；trash 是公开区域
 *   （108.2.d），"all units" 是按特征自动选定的集合（355.10.d：没有可做的选择），
 *   因此用 selection "all" + min 0 的非目标 pick，不是 TargetSpec。
 * - 415.4 / 415.5 / 404.1.a：第二段的 ":rb_exhaust:" 是费用（横置来源），能力本身是
 *   Gear 的启动能力（151 / 151.2）。
 * - "Play a unit banished with this" 引用的是同一张牌印刷文本内的 Linked Ability
 *   （CR 394–398：398 明确规定组件能力只能与同一组能力影响的对象互动）。
 * - "(You must pay its costs.)" 要求按正常 Play 流程支付该单位的印刷费用（420.3）。
 *
 * status = judge-required（缺口不近似实现）：
 * - "banished with this" 的 Linked Ability 作用域没有可执行追踪：契约 3.6 的
 *   ObjectSelector 只有 self / source / target / pick / linked，`linked` 只能读到**同一次
 *   解析**内前序指令写入的链接值；两条能力分属不同链项（card-played 触发与 [E] 启动能力），
 *   第一次放逐的记录在第二次解析时无法经 ctx.linked 取回（428.3.a / 395–398）。改用 zone
 *   查询 banishment 会把其它效果放逐的单位也算进来，398 明确禁止。
 * - 即使对象可选取，"Play ... (You must pay its costs.)" 还需要按该单位的印刷费用走打出
 *   流程（420.3）；已合入的 effect.play 要求已 Finalize 的费用计划，本卡不能自己推导印刷费用。
 *   原文没有印刷目的地，所以指令体不写 location，交给 359.2.b / 420.3 的正常 Play 流程决定
 *   打出位置（不硬写成 base 近似）。
 * 第一段（trash → banishment）用已合入的 effect.banish 由 golden 真实执行；第二段保留
 * 可审查结构。依赖：Linked Ability 追踪（CR 394–398 / 428.3.a）与 CardProgram → Finalize 的
 * 打出费用计划接线（RIFT-349 后续）；不近似实现。
 */
const abilities: Ability[] = [
  {
    // 383.4.a.1："When you play this" → card-played（自身打出）。
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self", player: "self" } }
    },
    optional: false,
    body: [
      {
        id: "cursed-sarcophagus.banish-trash-units",
        op: "effect.banish",
        args: {
          // 355.10.d / 355.9.a.1："all units from your trash" 是按特征选定的集合，
          // 不是目标，故用非目标 pick 读取（ctx.picks）。
          objects: { kind: "constant", value: { pick: "cursed-sarcophagus.trash-units" } },
          linkKey: { kind: "constant", value: "banishedTrashUnits" }
        },
        picks: [
          {
            id: "cursed-sarcophagus.trash-units",
            // "your trash"：效果控制者的 trash（190.6.d 的隐含 you）。
            options: ["all-units-in-your-trash"],
            filter: { zone: "trash", type: "unit", owner: "self" },
            min: 0,
            max: null,
            selection: "all"
          }
        ]
      }
    ]
  },
  {
    // 151 / 151.2：Gear 的启动能力；费用为横置来源（415.4 / 415.5）。
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      payments: [{ kind: "exhaust", object: "self" }]
    },
    body: [
      {
        id: "cursed-sarcophagus.play-banished-unit",
        op: "effect.play",
        args: {
          // "a unit banished with this"（394–398 / 428.3.a）：本卡的放逐记录没有可执行
          // 读取路径（见 judgeReason），因此用占位选择器保留形状；不去查询整个
          // banishment（那会把其它效果的放逐对象算进来）。
          pick: { kind: "constant", value: "cursed-sarcophagus.unit-banished-with-this" }
          // 不写 location：原文没有指定目的地，单位按 359.2.b / 420.3 的正常 Play
          // 流程决定打出位置（Base 或自己控制的战场），硬写 base 属近似实现。
          // "(You must pay its costs.)"：需要该单位的 Finalize 费用计划（420.3），
          // 由 CardProgram → Finalize 的费用计划接线提供（见 judgeReason）。
        },
        picks: [
          {
            id: "cursed-sarcophagus.unit-banished-with-this",
            options: ["runtime:units-banished-with-cursed-sarcophagus"],
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-fb1cb45cbf77fdbc4ca293043af3cc16004e296598831688330ddb35495711c7",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「Play a unit banished with this」无可执行路径：(1)「banished with this」是同一张牌印刷文本内的 " +
    "Linked Ability 作用域（CR 394–398 / 428.3.a；396 把该组能力界定在同一张牌的印刷文本内，398 明确" +
    "组件能力只能与同一组能力影响的对象互动），但契约 3.6 的 ObjectSelector 只有 self/source/target/pick/" +
    "linked，`linked` 仅能读取同一次解析内前序指令写入的链接值；本卡两条能力属于不同链项（card-played " +
    "触发与 [E] 启动能力），第一次放逐的记录在第二次解析时无法取回，因此选不出正确对象；改用 zone 查询 " +
    "banishment 会把其它效果放逐的单位也算进来（398 禁止）。(2) 即使对象可选取，「(You must pay its costs.)」" +
    "要求按该单位的印刷费用走正常打出流程（420.3），已合入的 effect.play 只接受已 Finalize 的费用计划、" +
    "不推导印刷费用（RIFT-349 后续）。第一段 banish（428.1）用已合入的 effect.banish 由 golden 真实执行；" +
    "不近似实现。依赖：Linked Ability 追踪（CR 394–398 / 428.3.a）与 CardProgram → Finalize 的打出费用计划接线。",
  abilities,
  sourceText:
    "When you play this, banish all units from your trash.\n" +
    ":rb_exhaust:: Play a unit banished with this. (You must pay its costs.)"
};

export default program satisfies CardProgram;
