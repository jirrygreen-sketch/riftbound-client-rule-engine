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
 * status = executable。目标计划直接以 { type: "unit", zone: "trash" } 查询全体对象；
 * 不限定 owner/controller 就能枚举双方弃牌区，不需要额外的跨玩家集合锚点。golden 通过真实
 * Finalize/Resolve 目标计划选择 0/1/2 张，执行原始 body，并验证各自拥有者的手牌路由、
 * 部分/全部目标失效以及空弃牌区仍可选择 0 张（355.13 / 359.3.e）。
 */
const shadowsOfThePast = {
  canonicalCardId: "card.hash-66b8b9aff7c3cbf41b72ad3e4354a07d6905da96adb60bde378d1638b8f87b6d",
  rulesetVersion: "core-1.5",
  status: "executable",
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
              // 用 selection "up-to" / min 0 / max 2；不限制 owner/controller，候选覆盖双方弃牌区。
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
