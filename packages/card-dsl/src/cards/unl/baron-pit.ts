import type { CardProgram } from "../../ir/index.js";

/**
 * Baron Pit (unl-t01) — Battlefield token, Colorless, tag Token.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-t01, 逐字)：
 *   (You can't start the game with a token battlefield.)
 *   Units can move here from anywhere.
 *
 * 规则依据（CR v1.5）：
 * - 135.2.d.1 / 135.2.d.3：括号内文字是提醒文本，出现、缺失或措辞都不影响游戏规则；
 *   该句是“token 不能作为起始战场”的提醒，出处是 deck building / setup 规则
 *   （103.5/113.1、487.4.a：战场在构筑时提供并在 setup 时放入 Battlefield Zone，
 *   而 token 不是可提供的卡牌；185.2.e 亦说明 token 战场不能被 recycle），
 *   因此卡面能力只有第二句。
 * - 187.9：Baron Pit battlefield token 是无域战场 token，带 “Units can move here
 *   from anywhere.”。
 * - 170 / 170.5 / 170.5.b：战场本身是 Location，可以作为移动的目的地；
 *   144.4 限定 Standard Move 的目的地（Base→Battlefield、Battlefield→Base、
 *   带 Ganking 的 Battlefield→Battlefield），因此“move here from anywhere”是给
 *   「目的地是本源战场」的移动增加起点的许可（任意起点），它不授予 Ganking，
 *   也不改变 449.2.a/451.2 等其他目的地限制。
 * - 449 / 449.1 / 449.2：移动由起点与终点定义，所以许可必须同时记录“任意起点”
 *   与“终点 = 本源战场（053.3 的 here）”。
 *
 * status = judge-required（逐个记录缺口，不近似实现）：
 * 1. 缺许可消费者的完整语义：已合入的 layers/LayerEngine 会把 continuous.movement
 *    记进 ObjectSnapshot.movement（allowed/canMove/canGank/restrictions），但它只认
 *    movement.canGank 这类布尔开关；「终点是本战场、起点任意」这种带目的地的许可
 *    没有可判定的字段，LayerEngine 也无法把“移动到这里”表达成一个许可键。
 * 2. 缺消费方：zones/movement.ts 的 Standard Move 只读自己的 readiness/timing 输入
 *    （phase/stateOpen/turnPlayerId/priorityPlayerId 与 DuelBoard 的位置表），从不读图层
 *    MovementPermissions，也没有“起点任意”的分支（同 sfd/ornns-forge、ogn/vilemaws-lair、
 *    ogn/windswept-hillock 的缺口）。
 * 3. 缺注册路径：没有已合入的生产方把 CardProgram 的 static 能力注册成
 *    ContinuousEffectSpec（registerContinuousEffect 没有调用方）。
 * 4. 目的地锚点：053.3 的 here 在过滤器里只有 sameLocationAs（对象所在位置）这种形态，
 *    它约束的是「被影响对象的位置」，不是「移动的目的地」；在目的地许可落地前，
 *    把 sameLocationAs 写进 filter 会把许可绑定到“已经在本战场的单位”，与卡面相反，
 *    因此这里不写它，只声明 destination: "self" 的目的地意图。
 * 依赖：RIFT-75（zones 批次的移动限制消费）与 RIFT-91（layers-continuous 注册）之后的
 * 目的地许可任务；不近似实现（不把许可写成一个假的 negated 占位指令）。
 */
export default {
  canonicalCardId: "card.hash-9a277d1f603718992521dc7464de01bdb5cc00d5d35d10081db5b0c9cfc4c3db",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "整卡不可执行，缺口不近似实现：(1)「Units can move here from anywhere」(187.9；449.1/449.2 以起点与终点定义移动) 是带**目的地**的移动许可" +
    "（终点 = 本源战场，起点任意）；已合入的 layers/LayerEngine 只把 continuous.movement 记成 allowed/canMove/canGank/restrictions 这几个布尔与字符串，" +
    "没有「终点为本战场、起点任意」的可判定字段。" +
    "(2) 没有消费方：zones/movement.ts 的 Standard Move 只读自己的 readiness/timing 输入（144.1.a/144.1.b、144.2、144.4），从不读图层 MovementPermissions，也没有任意起点的分支" +
    "（同 sfd/ornns-forge、ogn/vilemaws-lair、ogn/windswept-hillock 的缺口）。" +
    "(3) 没有已合入路径把 CardProgram 的 static 能力注册成 ContinuousEffectSpec（registerContinuousEffect 无调用方）。" +
    "(4) 053.3 的 here 在过滤器里只有 sameLocationAs（被影响**对象**的位置）形态，用它表达「移动的**目的地**」会把许可绑到已经在本战场的单位上，与卡面相反，因此不写该锚点。" +
    "括号内 “You can't start the game with a token battlefield.” 按 135.2.d.1/d.3 是提醒文本（构筑/开局规则 103.5/113.1、487.4.a 与 185.2.e），不是需要执行的能力。" +
    "依赖：RIFT-75（zones）与 RIFT-91（layers-continuous）之后的目的地许可任务。",
  sourceText: "(You can't start the game with a token battlefield.)\nUnits can move here from anywhere.",
  abilities: [
    {
      kind: "static",
      effect: {
        // 187.9 / 449.1–449.2：给「移动到本源战场」增加任意起点的许可；"
        // 许可只声明形状与目的地意图，消费方与可判定字段见 judgeReason。
        kind: "continuous.movement",
        permission: "standard-move-to-here-from-anywhere",
        move: "standard",
        destination: "self",
        origin: "anywhere",
        addsPermission: true,
        // “Units”：任意单位都可以这样移动，因此不是「本战场的单位」。
        filter: { type: "unit", zone: "board" }
      }
    }
  ]
} satisfies CardProgram;
