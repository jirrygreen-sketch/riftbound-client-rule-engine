import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Miss Fortune, Buccaneer (ogn-193-298) — Unit, 4 energy + 1 Chaos power, 4 Might.
 *
 * Printed text:
 *   You may play me to an open battlefield.
 *   Friendly units may be played to open battlefields.
 *
 * 规则依据（CR v1.5）：
 * - 355.2 / 355.2.a：单位打出时选择合法 Location，默认只有控制者的 Base 或
 *   其控制的战场；355.2.b：游戏效果可以授予默认之外的合法位置。
 * - 170.11.c：Battlefield 称为 “open” 当且仅当它既 unoccupied（170.11.a：没有单位）
 *   又 uncontrolled（170.11.b：无玩家控制）。两句原文用的都是这个定义。
 * - 两句都是**静态许可**（“may be played”），不是触发能力也不是可选指令：
 *   “You may play me to an open battlefield” 只给本卡自己加一个合法位置；
 *   “Friendly units may be played to open battlefields” 是一个持续授予（本卡在场期间，
 *   控制者的所有友方单位都获得该许可）。契约 3.1 的 play 能力只有 restriction（限制）
 *   字段，没有许可字段，故按同类先例（sfd/dauntless-vanguard.ts 的
 *   `play-location-permission` 静态效果）表达两条能力，由 layers/Finalize 消费。
 *
 * status 判定（README 第 2 节）：judge-required。RIFT-259 已合入 `continuous.location`
 * 指令与 layers/rules 的 `playLocations` 查询，但两条许可仍没有执行路径：没有任何消费者
 * 调用 `playLocations` —— Finalize 的合法位置校验（chain/engine.ts 只校验
 * requirements/restrictions 与锁定目标）不读图层许可，170.11.a/b/c 的 "open battlefield"
 * 判定没有接线；也没有已合入路径把 CardProgram 的 static 能力绑定进图层（RIFT-257 的
 * 程序绑定）。本卡没有任何可执行原语，因此没有执行类 golden 用例。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "play-location-permission",
      value: {
        kind: "constant",
        value: {
          zone: "battlefield",
          battlefield: { occupied: false, controlled: false },
          appliesTo: "self"
        }
      },
      duration: "while-in-hand"
    },
    condition: { kind: "always" }
  },
  {
    kind: "static",
    effect: {
      kind: "play-location-permission",
      value: {
        kind: "constant",
        value: {
          zone: "battlefield",
          battlefield: { occupied: false, controlled: false },
          appliesTo: "friendly-units"
        }
      },
      duration: "while-on-board"
    },
    condition: { kind: "always" }
  }
];

const program = {
  canonicalCardId: "card.hash-713732fef292fb529d388efbec2020949fdfaeca0c39e3afeb5ed43119a7f3e5",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两条能力都是“打出位置许可”的静态持续效果（355.2.b / 170.11.c），但仍无消费方：" +
    "(1) RIFT-259 已合入 continuous.location 指令与 layers/rules 的 playLocations 查询，" +
    "但没有任何调用方——Finalize 的合法打出位置校验（chain/engine.ts 只校验 " +
    "requirements/restrictions 与锁定目标）不读图层许可，170.11.a/b/c 的 open battlefield" +
    "（unoccupied 且 uncontrolled）判定没有接线；" +
    "(2) 没有已合入路径把 CardProgram 的 static 能力注册进图层（RIFT-257 的程序绑定），" +
    "play-location-permission 只是等待消费者与绑定的声明数据。" +
    "本卡不含可执行原语，golden 测试只做校验与结构断言；不近似实现。",
  abilities,
  sourceText:
    "You may play me to an open battlefield.\nFriendly units may be played to open battlefields."
} satisfies CardProgram;

export default program;
