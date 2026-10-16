import type { CardProgram } from "../../ir/index.js";

/**
 * On the Hunt (sfd-204-221) — Spell, 1 energy + 2 Body power, tags
 * Sivir/Signature. Might null (spells have no printed Might).
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-204-221，逐字）:
 *   "Ready your units."
 *
 * 规则依据（CR v1.5）：
 * - 无 [Action]/[Reaction] 印刷行：法术默认按 Action 时机（159.2.a），卡程序不额外声明
 *   速度关键词（与 void-seeker / firestorm 的处理一致）。
 * - "Ready your units." 是程序化集合，不是目标：355.10.d 规定按特征程序化选出、玩家无从
 *   选择的集合不是 Target（355.10.d.1 把例外限定为从不做选择的集合），355.10.g 的对照
 *   示例也把 "Ready your legend." 归为非目标选择。因此整条指令不写 TargetSpec / PickSpec，
 *   而用已合入 effect.ready 的非目标集合形态 { kind: "query", filter }（该原语文档：
 *   "Ready your units." 正是 query 形态的使用场景，355.10.d/355.10.d.1）。
 * - "your units" = 能力控制者控制的场上单位；"you" 的绑定用 controller: "self"
 *   （契约 3.6 的 PlayerSelector，chain/engine.ts 的 query 归一化把 self 解析为能力控制者）。
 * - effect.ready 提交封闭 GameAction { type: "ready", object }（416.1/416.1.b/416.1.c：
 *   已就绪对象不再重置、不产生事件），只经 ResolveContext 读写，不自行推进优先权。
 *
 * status 判定（cards/README.md 第 2 节）：executable —— 整张卡只有这一句无选择限制的集合
 * 就绪指令，原语已合入，golden 用解释器 + 测试内核真实执行（含已就绪单位不重复重置、
 * 敌方单位不受影响、拒绝为空集合的边界）。
 */
const onTheHunt = {
  canonicalCardId: "card.hash-619e8c7224e121c07463a5df717ede038bc215b47679f537e42c290d78c92f07",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "on-the-hunt.ready-units",
          op: "effect.ready",
          args: {
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                filter: { type: "unit", zone: "board", controller: "self" }
              }
            },
            linkKey: { kind: "constant", value: "readied" }
          }
        }
      ]
    }
  ],
  sourceText: "Ready your units."
} satisfies CardProgram;

export default onTheHunt;
