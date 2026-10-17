import type { CardProgram } from "../../ir/index.js";

/**
 * Kai'Sa, Evolutionary (ogn-112-298), CR v1.5 810 / 355.10.a / 356.1.b.2.
 *
 * 复核（2026-10-17，第三轮 M2 覆盖率复核）：
 * - 已合入并实测：RIFT-257 的程序绑定（含 Ganking 的 continuous.movement 静态注册，
 *   programs/statics.ts → layers）、RIFT-260 的替代/入场管线、RIFT-261 的 cost.pay/cost.modify、
 *   effect.play 的“用调用方给定的 finalized 计划打出目标”路径、以及 cost/cost-plan.ts 的
 *   baseModifications ignore-base energy（实测：printed energy 2 / Fury Power 1 → total energy 0、
 *   power 保留 [{ amount: 1, allowedDomains: ["Fury"] }]，符合 356.1.b.2 的“只忽略 Energy”）。
 *   这些都是部分证据；整卡仍不可执行。
 * - 仍缺（缺口一，动态目标过滤）：355.10.a 的“Energy cost less than your points”需要按控制者
 *   当前 points 与候选法术的印刷 Energy 做跨对象数值比较。程序声明的占位键
 *   energyLessThan 不是已知过滤字段：programs/filters.ts 的 translateObjectFilter 直接抛
 *   Unsupported filter field energyLessThan（已实测），整卡触发注册因此失败；
 *   layers/filter.ts 与 chain 的 ctx.query 也会静默忽略未知键（fail-open）。
 * - 仍缺（缺口二，费用计划绑定）：356.1.b.2 要求为**实际选中**的那张法术生成 ignore-base-energy
 *   的计划并接入嵌套打出的 Finalize。程序保留的 `{ finalized: true, energy: 0 }` 只是形状：
 *   它没有携带所选牌的印刷 Power（effect.play 只把 cost.energy/cost.power 转成常量计划，
 *   chain/engine.ts 的 effect-cost 分支），因此不能当作完整可执行的费用计划。
 * - 仍缺（缺口三，「Then recycle it」的对象引用）：effect.play 只链接成功**次数**
 *   （ctx.link("played", n)，实测 linked.played === 1），不发布打出对象的引用；程序引用的
 *   playedObjects 键没有生产者。effect.recycle 接受 linked 值，但上游没有该对象绑定。
 * - 仍缺（缺口四，Ganking 许可形状）：Ganking 展开写字符串 permission，而规则查询
 *   layers/rules/query.ts 的 movement() 读 permission.routes 数组（已实测 canGank 仍为 false）。
 *   与 ogn/kayn-unleashed 同一缺口，适配不在本卡 write scope。
 */
const kaisaEvolutionary = {
  canonicalCardId: "card.hash-697cf91efe23c8a9d145276f047432baac8d3218d9975045d3e27ad7573275ec",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口：(1) 动态目标过滤——355.10.a 的 Energy cost less than your points 需要候选法术印刷 Energy 与控制者 " +
    "points 的跨对象比较，程序占位键 energyLessThan 不被识别（programs/filters.ts 抛 Unsupported filter field " +
    "energyLessThan，整卡注册失败；layers/filter.ts 与 chain ctx.query 对未知键静默忽略）。(2) 费用计划绑定——" +
    "356.1.b.2 要为实际选中的法术生成 ignore-base-energy 计划并接入嵌套 Finalize；程序里的 { finalized: true, " +
    "energy: 0 } 未携带所选牌印刷 Power（effect.play 只把 cost 常量化成 plan），不是可执行计划。(3) Then recycle it " +
    "需要打出对象的当前引用；effect.play 只链接 played 次数（linked.played === 1），playedObjects 无生产者。" +
    "(4) Ganking 展开的字符串 permission 与 movement 规则查询要求的 permission.routes 数组不匹配（810.1.b，与 kayn 同缺口）。" +
    "其中 (1) 的跨对象数值比较属 RIFT-359（条件谓词）家族的进行中工作（该分支 4f4b5b2 只扩充事件/结果谓词，" +
    "不含跨对象印刷费用比较，且未合入 HEAD）；(2)(3) 归费用计划与 effect.play 链接值的接线任务。" +
    "已合入并实测：RIFT-257 程序绑定与 Ganking 静态注册、RIFT-261 cost.pay/cost.modify、cost/cost-plan.ts 的 " +
    "ignore-base energy（energy 归零、Power 保留）。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "ganking" },
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquer", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "kaisa.opt-in",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Play a spell from your trash without paying its Energy cost?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "kaisa.play-spell",
                  op: "effect.play",
                  args: {
                    // 355.10.a / 355.10.a.1：Trash 是公开区域 → 使用 targets 选目标。
                    target: { kind: "constant", value: "kaisa.trash-spell" },
                    // 356.1.b.2：只忽略 Energy（base Energy cost 置 0），Power 仍须按被
                    // 选牌的印刷费用支付 —— 后者只有结算时才知道，静态 IR 生成不出可支付
                    // 的 finalized 计划，因此这里的计划只是形状（本卡 judge-required，
                    // 所选牌费用绑定补齐前不得当作可执行费用）。
                    cost: { kind: "constant", value: { finalized: true, energy: 0 } }
                  },
                  targets: [
                    {
                      id: "kaisa.trash-spell",
                      filter: {
                        zone: "trash",
                        owner: "controller",
                        type: "spell",
                        // 动态条件：「Energy cost less than your points」需要
                        // Finalize 期的跨对象数值比较，保留占位形状。
                        energyLessThan: "controller-points"
                      },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                },
                {
                  id: "kaisa.recycle-it",
                  op: "effect.recycle",
                  linkedTo: "kaisa.play-spell",
                  args: {
                    // “Then recycle it” 指刚打出的那张牌；effect.play 目前只链接
                    // 成功次数，缺少对象引用绑定（见 judgeReason）。
                    objects: {
                      kind: "linked-value",
                      instructionId: "kaisa.play-spell",
                      key: "playedObjects"
                    }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
    "When I conquer, you may play a spell from your trash with Energy cost less than your points without paying its Energy cost. Then recycle it. (You must still pay its Power cost.)"
} satisfies CardProgram;

export default kaisaEvolutionary;
