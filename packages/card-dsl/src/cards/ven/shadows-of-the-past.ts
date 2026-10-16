import type { CardProgram } from "../../ir/index.js";

/**
 * Shadows of the Past（ven-103-166）— Spell，3 Energy + 1 Chaos Power，领域 Chaos。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-103-166，逐字）：
 *   "Return up to 2 units from trashes to their owners' hands."
 *
 * 规则依据（Core Rules v1.5）：
 * - "up to 2 units from trashes"：355.13 规定 "up to" 可以选任意数量（含 0），并允许在没有任何目标
 *   的情况下打出该牌；355.12 说明"对若干游戏对象执行游戏动作"时每个被选对象都是独立选择的目标。
 *   因此是一个 TargetSpec：selection "up-to"、min 0、max 2。
 * - "from trashes" 是公开区域（108.2.d：Trash 是 Public Information），355.9.a 的例子里正有
 *   "Recycle a unit from your trash" 这条：牌在公开区域被点名 → 是 Target（355.10.a 的例外不适用）。
 *   该句没有限定"你的"，因此两个目标可以来自任一玩家的废牌堆（filter 不加 controller 限制）。
 * - "to their owners' hands"：目的地是各牌拥有者的手牌；已合入的 effect.zone 以 to: "hand" 提交
 *   区域移动动作（448.2），动作层按拥有者路由（108.1 / 123），卡牌不写玩家参数——与本仓
 *   ogn-170-298 Morbid Return、ogn-169-298 Gust 的写法一致。
 *
 * status = judge-required。缺口是一处、且不近似实现："from trashes"（复数、跨玩家）的候选集合读数
 * 没有生产者。已合入的 effect.zone 只接受 target（经 Finalize 目标计划锁定）或 pick（ctx.picks 的
 * 已选定引用）；TargetSpec.filter 的目标计划按控制器/拥有者字段过滤，契约 3.6 的 PlayerSelector
 * 只有 "self"/"opponent"/"any" 这类相对选择，而"任一玩家的废牌堆"需要跨玩家集合（355.9.a 允许，
 * 但 target/ 的候选枚举按 filter 逐对象匹配，没有"所有玩家的该区域"这一锚点）；同时"up to 2"要求
 * 目标数量在 Finalize 由选择者决定（355.13），已合入的 TargetSpec up-to 支持这一点，缺的只是跨玩家
 * 集合来源。依赖：RIFT-90（目标计划的跨玩家/区域集合与候选枚举）。golden 用已锁定目标真实执行
 * "废牌堆 → 拥有者手牌"的区域移动（含敌方牌回到敌方手牌的拥有者路由与失效引用 ignored 两个边界）。
 */
const shadowsOfThePast = {
  canonicalCardId: "card.hash-66b8b9aff7c3cbf41b72ad3e4354a07d6905da96adb60bde378d1638b8f87b6d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "一处缺口：「up to 2 units from trashes」（355.12/355.13 的两个可选目标、355.9.a 允许跨玩家的 Trash 作为目标，" +
    "108.2.d 说明 Trash 是公开信息）没有候选集合来源——已合入的 effect.zone 只消费 Finalize 锁定的 target 或 ctx.picks " +
    "的已选定引用，而 TargetSpec.filter 的候选枚举按逐对象字段匹配（controller/owner 只有 self/opponent/any 这类相对选择），" +
    "没有「所有玩家的该区域」这一锚点把全体玩家的 Trash 合成一个候选集合。目标数量本身已可表达（selection up-to、min 0、max 2，" +
    "355.13 允许选 0 个并照常打出）。依赖：RIFT-90（目标计划的跨玩家/区域候选枚举）。" +
    "golden 用已锁定目标真实执行「Trash → 拥有者手牌」的 effect.zone 移动（含敌方牌回到敌方手牌的 108.1 拥有者路由与失效引用 ignored），" +
    "但缺跨玩家候选来源时整卡不可执行。不近似实现（不改写成只取自己的 Trash）。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        // 印刷费用 3 Energy + 1 Chaos Power（catalog energy=3, power=1, domains ["Chaos"]）。
        energy: { kind: "constant", value: 3 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "shadows-of-the-past.return-units",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "shadows-of-the-past.units-in-trashes" },
            // 目的地是各牌拥有者的手牌：由动作层按拥有者路由（108.1 / 123）。
            to: { kind: "constant", value: "hand" },
            amount: { kind: "constant", value: 2 }
          },
          targets: [
            {
              id: "shadows-of-the-past.units-in-trashes",
              // "units from trashes"：公开区域里的单位牌（355.9.a/355.10.a），"up to 2"（355.13）
              // 用 selection "up-to" / min 0 / max 2；不带 controller 限制，但跨玩家的候选集合
              // 尚无生产者（见 judgeReason）。
              filter: { type: "unit", zone: "trash" },
              min: 0,
              max: 2,
              selection: "up-to"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "Return up to 2 units from trashes to their owners' hands."
} satisfies CardProgram;

export default shadowsOfThePast;
