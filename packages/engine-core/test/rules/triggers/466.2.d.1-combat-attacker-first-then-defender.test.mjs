// CR v1.5 466.2.d / 466.2.d.1 golden test — scenario `triggers-combat-attacker-first-then-defender`
// (docs/rules/scenarios/triggers.yaml).
//
// 466.2.d.1: when establishing Attacker and Defender has caused Triggered Abilities
// to become Pending, the Attacking player (who has Focus) places theirs on the Chain
// first, followed by all non-Defender players in Turn Order, followed by the Defending
// player last.
//
// 状态：test.todo。缺什么：战斗开启的原子事务（Attacker/Defender designation）。
// 现状：
//   * 合并内核里没有 attack/defense designation 的生产者：`attack-declared` 与
//     `defense-declared` 只作为已声明时点存在，`src/` 中除 Disarm 的关键词展开外没有
//     任何模块发布它们（`events/producers/` 只有 zone-change / might-change /
//     ability-activation）。
//   * `combat/flow.ts` 在把 Showdown 升级为 Combat 时抛
//     `TurnCombatBlockedError('combat-start-transaction', 'Combat start needs an atomic
//     simultaneous timing wave + roles (CR 466.2)')`，即战斗链的攻守分组顺序尚无实现。
//   * 事件管线的默认顺序是 303.2.a 的回合顺序，用它冒充 466.2.d.1 的攻击方优先会
//     造出错误的顺序；按规则红线不近似实现，也不写“断言该功能不存在”的测试。
// 需要的机制：Combat 开启的原子事务（同时发布 combat-start/showdown-close、写入
// attacker/defender designation，并按攻方 → 回合顺序 → 守方建立触发波）。
import test from 'node:test';

test.todo('triggers-combat-attacker-first-then-defender (466.2.d.1): 缺战斗开启的原子事务与攻守 designation 生产者——attack-declared/defense-declared 无发布者，CombatFlow 对战斗链建立抛 combat-start-transaction；默认回合顺序不能冒充攻方优先');
