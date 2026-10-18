import type { CardProgram } from "../../ir/index.js";

/**
 * Megatusk (unl-126-219) — Unit, Chaos, tag Bilgewater。
 * catalog：energy 6、power null（无印刷力量）、might 6。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-126-219，逐字）：
 *   Spend 3 XP: Give your units here [Ganking] this turn. (We can move from
 *   battlefield to battlefield.)
 *
 * 规则依据（CR v1.5）：
 * - 204.1.b / 377.1：冒号之前的 “Spend 3 XP” 是启动能力的基础费用（730.2 Spend XP）；
 *   415.5 的 exhaust 符号不是本卡的写法。费用形态对齐已合入的费用管线
 *   （cost/plan-values.ts 的 `kind: "xp"` 支付组件 + payment.ts 的 spend-xp 动作）。
 * - 376 / 377.3 / 310.1.a：启动能力进链；本卡没有印刷 [Action]/[Reaction]，按默认
 *   Action 时机（同 unl/bashful-bloom 的写法）。
 * - “Give your units here [Ganking] this turn”：801.3.a.2（授予关键词的效果须写明期限）
 *   与 317.2.c（所有 “this turn” 效果在 Expiration Step 同时到期）；Ganking 的
 *   KeywordDef（810.1–810.3，stacking single）与 layers 的 duration 机制已合入。
 *   “your units here” 是 359.3.f 的 here 指代（来源当前位置），用契约 3.6 的
 *   `sameLocationAs: "source"` 锚点表达；“here 的你的单位”是按特征选定的完整集合、
 *   没有可选余地（355.10.d：程序化选定的对象不是目标），因此用 `selection: "all"`、
 *   `min: 0`（同 rad/the-ball、ogn/kogmaw-caustic 对集合的写法），不是 “up to”。
 *
 * status = judge-required（2026-10-18 RIFT-662 复核，实测）：
 * - 已合入且可执行：3 XP 启动费用（730.2）、continuous.grant-keyword 原语与按运行期位置
 *   的「your units here」查询。模板测试经生产链真实支付 3 XP 并把 [Ganking] 注册到
 *   来源与同战场友方单位（810.3 特征）；执行证据见
 *   test/cards/templates/activated-activated-continuous-grant-key-662.test.mjs。
 * - 动态授予路径仍缺关键词重展开与生命周期接线：continuous.grant-keyword 只在 ability
 *   图层登记 Ganking 特征，没有调用 Ganking KeywordDef.expand，也没有为被授予对象注册
 *   与其期限绑定的 continuous.movement，并在授予到期时撤销该派生许可。因此本卡结算后
 *   canGank 仍为 false（810.1.c / 144.4.c.1）。
 * - 静态绑定另有一个独立形状问题：createEngineStaticBinder 直接登记 authored
 *   continuous.movement 时保留字符串 permission，而 movement() 读取 permission.routes；
 *   continuous.movement 原语本身会把字符串归一为 routes，但静态绑定没有走该原语。
 *   这影响静态展开的关键词，不等同于本卡动态授予缺少重展开。
 * - effect.move 只负责对象重定位，按规则不检查 Ganking 许可；缺少的是标准移动规则查询所需的
 *   动态许可注册，不是 effect.move 内的额外消费方。
 */
export default {
  canonicalCardId:
    "card.hash-1c5a34df03f1f2101ee472f6d3fd4673e56683b49f28e64e3d9d4291bc6d8448",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Give your units here [Ganking] this turn」的 continuous.grant-keyword 原语、运行期位置查询、" +
    "Ganking KeywordDef 与 ability-layer 注册均已合入，模板测试经生产链真实执行（授予来源与同战场友方单位，" +
    "810.3）；实际剩余缺口是动态关键词重展开及生命周期接线：当前只登记 Ganking 特征，" +
    "没有为被授予对象调用 KeywordDef.expand 注册与其期限绑定的 continuous.movement，" +
    "也没有在授予到期时撤销派生移动许可，故 canGank 仍为 false（810.1.c / 144.4.c.1）。" +
    "另有一个独立的静态绑定形状问题：continuous.movement 原语本身已把字符串 permission 归一为 " +
    "permission.routes，但 createEngineStaticBinder 直接登记静态展开时保留字符串，而 movement() 读取 " +
    "permission.routes。effect.move 只做重定位，按规则无需 Ganking 许可，不是缺失的消费方。" +
    "已合入且可执行的是启动费用（204.1.b / 730.2 的 “Spend 3 XP”），模板测试真实支付并验证 XP 不足时被拒绝。" +
    "不近似实现。",
  abilities: [
    {
      kind: "activated",
      timing: "action",
      cost: {
        // 204.1.b：冒号前的基础费用。730.2：Spend XP 减少该玩家已标记的 XP。
        kind: "activated",
        payments: [{ kind: "xp", amount: { kind: "constant", value: 3 } }]
      },
      body: [
        {
          id: "megatusk.grant-ganking",
          // 「Give your units here [Ganking] this turn」——801.3.a.2 的限时关键词授予。
          // continuous.grant-keyword 的执行入口已合入；结构按关键词能力的小写
          // id 与 end-of-turn 期限书写。
          op: "continuous.grant-keyword",
          args: {
            // 810.3：被注册的 KeywordId 是 "Ganking"（keywords/Ganking.ts）；
            // 授予后的特征按该 id 可引用。
            keyword: { kind: "constant", value: "Ganking" },
            duration: { kind: "constant", value: "end-of-turn" },
            // “your units here” is a criteria-based set (355.10.d), so the
            // interpreter resolves it through a query rather than a target.
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                filter: {
                  type: "unit",
                  controller: "self",
                  zone: "board",
                  sameLocationAs: "source"
                }
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "Spend 3 XP: Give your units here [Ganking] this turn. (We can move from " +
    "battlefield to battlefield.)"
} satisfies CardProgram;
