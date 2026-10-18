// CR v1.5 370.1.c.1 golden test — scenario `triggers-replacement-secret-zone-simultaneous`
// (docs/rules/scenarios/triggers.yaml).
//
// 370.1.c.1: a Game Object's Replacement Effect that applies to an event involving
// that same object while it is in a secret zone applies to and replaces the event
// simultaneously with the event occurring. Nocturne, Horrifying ("As you look at or
// reveal me from the top of your deck, you may banish me. If you do, you may play me
// for [A].") is the CR example.
//
// 状态：test.todo。缺什么：秘密区域的同刻替代协议 + 卡面在执行前已是 judge-required。
// 现状：
//   * 当事卡本身就是 judge-required：`card-dsl/src/cards/ogn/nocturne-horrifying.ts` 的
//     status 为 judge-required（“If you do, you may play me for [A]” 的 play-for-cost
//     路径与卡面条件不可执行），执行它等于近似实现未裁定语义。
//   * 即使用等价的合成程序，替代层的可规划 opcode 集合（replacement/planner.ts）里
//     没有 effect.banish，无法表达“banish me”的 instead 主体。
//   * 事件管线只在动作提交后扫描替代（`replacement/bind.ts` 的 activeZones 覆盖秘密
//     区域，但没有“与揭示同时适用”的协议），没有 370.1.c.1 的同刻观察入口。
//   * 按规则红线不近似实现，也不写“断言该功能不存在”的测试。
// 需要的机制：秘密区域同刻替代协议 + effect.banish（或等价换区）进入替代规划 opcode 集
// + Nocturne 卡面的 play-for-cost 裁定。
import test from 'node:test';

test.todo('triggers-replacement-secret-zone-simultaneous (370.1.c.1): 缺秘密区域同刻替代协议——替代层没有“与揭示同时适用”的入口，planner 不支持 effect.banish，且 Nocturne, Horrifying 自身仍是 judge-required');
