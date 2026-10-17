import type { CardProgram } from "../../ir/index.js";

/**
 * Arise! (sfd-198-221) — Spell, 6 energy + 1 Calm power, tags Azir/Signature.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-198-221，逐字）:
 *   "Play a 2 :rb_might: Sand Soldier unit token for each Equipment you control.
 *    Then ready two of them."
 *
 * 规则依据（CR v1.5）：
 * - "Play a … Sand Soldier unit token"：被"打出"的新 token 按 440.2.c / 185.2.a
 *   先在链上创建、再由 play 动作接手完成打出流程；已合入的 effect.token 以
 *   mode: "play" 走这条 create-on-chain + play 路径（契约变更记录 RIFT-62）。
 *   Sand Soldier 是 187.3 定义的 2 Might Shurima 单位 token，定义 id "sand-soldier"
 *   在冻结定义表内（不带额外能力），token 的 energy/power 按 185.3.a 保持 null。
 * - "for each Equipment you control"：数量是结算时的集合计数（359.3.e.11 的"尽可能执行"
 *   前提），用已合入的 count 表达式读 controller: "self"、tags: ["Equipment"] 的 gear
 *   集合；Equipment 是 Gear 的 tag 特征（150/150.1/150.5），不是另一个对象类型。
 *   该集合不是目标（355.10.d：按特征程序化选出、玩家无从选择的集合不成为目标）。
 * - token 的打出目的地：355.2/355.2.a 的默认合法地点是控制者基地或控制者控制的战场。
 *   卡面没有指定地点，因此按 440.2.b.1（未指定区域时创建到"可被打出的任意地点"）由打出流程
 *   在 Finalize 选择；卡程序不给 effect.token 写死 locations（写死等于替玩家发明选择，
 *   355.2 的选择属于打出流程），golden 测试按调用方已选定的具体基地地点执行真实原语。
 * - "Then ready two of them."："them" 回指本次创建/打出的 token，用 linkedTo 读取
 *   effect.token 的链接收据（359.3.e.14 的结果引用；链接值对象在解释器里被解析为引用列表）。
 *   "two" 是数量上界（amount: 2，359.3.e.11 不足时按实际可用数量执行），不是目标选择：
 *   这些 token 不是被卡牌选择的对象，因此不写 TargetSpec / PickSpec。就绪本身是 effect.ready
 *   的 { type: "ready", object } 动作（416.1）。
 *
 * 当前复核：保持 judge-required；具体未接通路径见 judgeReason。
 */
const arise = {
  canonicalCardId: "card.hash-390865ebc7ca61e906a68cd399d7f1300d7ddcba26677e93cbba334e99b8dee9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "355.2/355.2.a 的 token 打出地点仍未绑定：target/location 已能枚举 LocationRef，但解释器只为 effect.move 归一化 LocationExpr，" +
    "effect.token.location/locations 只接受具体运行时引用（{\"type\":\"location\"} 形式会被 \"Invalid effect.token argument: location\" 拒绝），卡程序又不能写死玩家的选择。" +
    "生产打出流程也缺 token 程序：effect.token 的 CardProgram 不携带能力，programs/play.ts 的 token 打出交接（describePlay → registry.get）会以 unknown-program 失败，创建/每次打出的合法地点、费用与 440.2.c 的链处理尚未接通。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "arise.play-sand-soldiers",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "sand-soldier" },
            // "for each Equipment you control": 结算时计数（359.3.e.11）。
            amount: {
              kind: "count",
              subject: "gear",
              filter: { type: "gear", tags: ["Equipment"], controller: "self" }
            },
            // 440.2.c / 185.2.a：被"打出"的新 token 先在链上创建，由 play 接手。
            mode: { kind: "constant", value: "play" },
            // locations 由打出流程的 Finalize 选择（355.2/355.2.a）；见 judgeReason，
            // 卡程序不写死地点。
            linkKey: { kind: "constant", value: "sandSoldiers" }
          }
        },
        {
          // "Then ready two of them."："them" 是上一条指令创建/打出的 token
          // （359.3.e.14 的结果引用），amount 2 是数量上界（359.3.e.11）。
          id: "arise.ready-two",
          op: "effect.ready",
          linkedTo: "arise.play-sand-soldiers",
          args: {
            objects: {
              kind: "linked-value",
              instructionId: "arise.play-sand-soldiers",
              key: "sandSoldiers"
            },
            amount: { kind: "constant", value: 2 },
            linkKey: { kind: "constant", value: "readied" }
          }
        }
      ]
    }
  ],
  sourceText:
    "Play a 2 :rb_might: Sand Soldier unit token for each Equipment you control. " +
    "Then ready two of them."
} satisfies CardProgram;

export default arise;
