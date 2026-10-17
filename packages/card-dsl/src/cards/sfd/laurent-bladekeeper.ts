import type { CardProgram } from "../../ir/index.js";

/**
 * Laurent Bladekeeper (sfd-096-221) — Unit, 3 energy, 无印刷 Power, Might 3，
 * 领域 Body，标签 Demacia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json sfd-096-221，逐字）：
 *   "Ganking (I can move from battlefield to battlefield.)"
 *
 * 规则依据（Core Rules v1.5）：
 * - 810.1 / 810.1.a / 810.1.b：Ganking 是单位上的 Passive Ability 关键词，功能上等于
 *   「我可以用标准移动从一个战场移动到另一个战场」。
 * - 810.1.c / 810.1.c.1 / 810.1.c.2 / 810.1.c.3：它为单位的 Standard Move 增加许可，
 *   不移除原有选项、不产生启动费用、不提供额外移动次数；144.4.c / 144.4.c.1 是移动侧的
 *   规则落点。
 * - 括号内文字是关键词的规则释义（reminder text），不是独立指令；按 README 第 5 节只声明
 *   { kind: "keyword", keyword: "ganking" }，展开归 effects/keywords/Ganking.ts（810 已并入
 *   该文件：static continuous.movement）。卡程序不重写移动规则。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-16）。
 * - 关键词声明本身可校验，KeywordDef 已注册（RIFT-83），RIFT-257 的 expandProgram
 *   会把它解析为 static continuous.movement 展开；RIFT-258 的 continuous.movement
 *   指令与 layers/rules/query.ts 的 movement() 查询也已合入（golden 证明该展开
 *   注册后 query.movement(...).canGank === true）。
 * - 仍缺端到端消费方：zones/movement.ts 的 Standard Move 只从调用方传入的
 *   hasGanking 求值器读取战场→战场许可（Ganking.ts 文件头自述「移动系统尚无读取
 *   continuous.movement 许可的接口」），没有「卡牌程序 → 关键词展开 → 移动系统」
 *   的接线（契约 3.5/3.7）；layers/engine.ts 的 ability 分支也只认 effect.movement
 *   记录形状，与展开的 permission/addsPermission 形状不一致。
 * - 因此整卡不宣称 executable；不把关键词近似成数值修正，也不在卡里手写移动许可。
 */
export default {
  canonicalCardId: "card.hash-d7b135744e67346532eafa70ee68b6299b7a78117c7e704b524f1c7c3c538d72",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Ganking]（810.1.b/810.1.c）的 KeywordDef（effects/keywords/Ganking.ts，RIFT-83）已注册，" +
    "RIFT-257 的 expandProgram 会把它解析为 static continuous.movement 展开，RIFT-258 的指令与 " +
    "layers/rules/query.ts 的 movement() 查询也已合入（golden 证明注册后 query 的 canGank 为 true）；" +
    "仍缺端到端消费方：zones/movement.ts 的 Standard Move 只从调用方传入的 hasGanking 求值器读取战场→战场许可，" +
    "没有「卡牌程序 → 关键词展开 → 移动系统」的接线（契约 3.5/3.7），且 layers/engine.ts 的 ability 分支只认 " +
    "effect.movement 记录形状，与展开的 permission/addsPermission 形状不一致。" +
    "依赖：移动系统读取 continuous.movement 许可。不近似实现。",
  abilities: [{ kind: "keyword", keyword: "ganking" }],
  sourceText: "Ganking (I can move from battlefield to battlefield.)"
} satisfies CardProgram;
