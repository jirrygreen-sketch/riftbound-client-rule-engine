// CR v1.5 383.4.g.2 golden test — scenario `triggers-activate-named-trigger-not-real-event`
// (docs/rules/scenarios/triggers.yaml).
//
// 383.4.g.2: the named part of the condition is fulfilled, but no actual such event
// occurs. Red Brambleback's "Your conquer effects for conquering here trigger an
// additional time" therefore must not fire for effects activated by Reckoner's Arena.
//
// 状态：test.todo。缺什么：命名触发激活入口 + 触发倍率消费者。
// 现状：
//   * 与 383.4.g.1 同源：没有命名触发激活入口，就没有“非真实事件”的激活路径可测；
//     合成一次真实 conquer 会直接违反 383.4.g.2。
//   * Red Brambleback 的“额外触发一次”本身也还没有消费者：卡程序把该句记录为
//     `continuous.trigger-multiplicity` 静态声明（status judge-required，理由引用本场景），
//     `src/` 内没有任何模块读取它。
//   * 按规则红线不近似实现，也不写“断言该功能不存在”的测试。
// 需要的机制：命名触发激活入口 + 触发倍率消费者（`realConquerOnly` 语义）。
import test from 'node:test';

test.todo('triggers-activate-named-trigger-not-real-event (383.4.g.2): 缺命名触发激活入口与触发倍率消费者——激活路径不存在，Red Brambleback 的 additional-time 声明无消费者，无法验证“具名激活不产生真实事件、不加触发次数”');
