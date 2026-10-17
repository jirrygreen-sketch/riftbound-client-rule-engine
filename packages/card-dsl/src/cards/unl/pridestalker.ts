import type { CardProgram } from "../../ir/index.js";

/**
 * Pridestalker (unl-183-219) — Legend, Fury/Body, tag Rengar.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-183-219，逐字）：
 *   When you play a unit, give a unit +1 :rb_might: this turn.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a.4：“when another object is played” 的触发不是 Play Effect；时点用
 *   封闭表的 card-played，filter 取事件对象为 unit 且由能力控制者控制。
 * - 355.9 / 355.10：“give a unit” 是单个由玩家选择的单位，属选目标（targets），
 *   不是 pick（355.7：pick 不触发“成为目标”相关触发）。
 * - “+1 [M] this turn” 是带 end-of-turn 期限的临时 Might 修正：effect.buff 的
 *   文档明确临时 Might 归 layers 的 continuous.might（CR 702/703 的 Buff 计数
 *   是另一回事），因此需要未合并的原语与到期消费者。
 *
 * status = judge-required。自本程序初写后合入的依赖：continuous.might 原语（RIFT-258：
 * 经 ctx.addContinuous 注册 arithmetic 层效果、end-of-turn 期限按 315.4/468.7.c 到期、
 * 479.4.b 的印刷下限），以及 CardProgram → TriggerRegistration 绑定（RIFT-257：
 * card-played 订阅、Finalize 锁定目标、触发生成链项）。body 因此改用该原语的真实
 * args 形状（args.objects 指向 TargetSpec，契约 3.6 的符号选择器），不再只是记录意图；
 * golden 用生产链适配器 + 参考内核真实执行“敌方打出不触发 / 己方打出触发 / arithmetic
 * 注册与到期”，不近似用 effect.buff 表达（Buff 是 702 的计数器）。
 *
 * 仍不能宣称整卡可执行的一处缺口（不近似实现）：本卡是 Legend，而合并的卡牌程序
 * 绑定把 card-played 的 activeZones 定为 ['board']（programs/triggers.ts 的 permanent
 * 分支），对局生命周期却把 Legend 创建在 chain 区并留在那里（game/lifecycle.ts 的
 * createToken；契约 ZoneId 没有 legend-zone 成员，CR 107.4 的 Legend Zone 未建模）。
 * 真实对局里这条触发因此匹配不到自己的来源；只有把 Legend 放进 Board 的场景（golden
 * 的初始局面）能执行。该缺口属共享契约与生命周期，不在本卡可修范围内。
 *
 * 依赖：契约 ZoneId 增加 legend-zone 且生命周期把 Legend 放进该区（或
 * programs/triggers.ts 为 Legend 派生正确的 activeZones）。
 */
export default {
  canonicalCardId:
    "card.hash-0498072c7fa1411e598b868d1675b34cf40890cde5ab313bf5598e1fcf1f08eb",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "副作用与绑定已合入并可真实执行：continuous.might（RIFT-258）按 143.2.a/475 注册 arithmetic 层修正、" +
    "按 315.4/468.7.c 以 end-of-turn 到期；CardProgram → TriggerRegistration（RIFT-257）建立 card-played 订阅" +
    "并在 Finalize 锁定目标。仍有的唯一缺口：本卡是 Legend，而合并绑定把 card-played 订阅的 activeZones 定为 " +
    "['board']（programs/triggers.ts 的 permanent 分支），对局生命周期却把 Legend 创建在 chain 区并留在那里" +
    "（game/lifecycle.ts 的 createToken；契约 ZoneId 无 legend-zone 成员，CR 107.4 的 Legend Zone 未建模），" +
    "因此真实对局中该触发永远匹配不到来源，只有把 Legend 放进 Board 的初始局面（golden）能执行。" +
    "依赖共享契约：ZoneId 增加 legend-zone 并把 Legend 放进该区（或 programs/triggers.ts 为 Legend 派生 activeZones）。" +
    "不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          // “you play a unit”：事件对象是刚打出的单位，由能力控制者控制。
          object: { type: "unit", controller: "self" }
        }
      },
      optional: false,
      body: [
        {
          id: "pridestalker.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            // 315.4 / 468.7.c：“this turn” 由 layers 的 duration alias 解析为 end-of-turn。
            duration: { kind: "constant", value: "this-turn" },
            // 合并原语的选择符：由 Finalize 锁定的目标经 TargetSpec id 读取
            // （355.10 / 契约 3.6 的 objects 形状）。
            objects: {
              kind: "constant",
              value: { kind: "target", id: "pridestalker.unit" }
            }
          },
          targets: [
            {
              id: "pridestalker.unit",
              // “a unit”：任意单位，由能力控制者在结算前选择（355.10）。
              filter: { zone: "board", type: "unit" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When you play a unit, give a unit +1 :rb_might: this turn."
} satisfies CardProgram;
