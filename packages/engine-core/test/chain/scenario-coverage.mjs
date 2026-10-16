import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const tests = new Map();
for (const dir of ['chain', 'events']) {
  const base = path.join(root, 'packages/engine-core/test', dir);
  for (const file of readdirSync(base).filter(file => file.endsWith('.test.mjs'))) {
    for (const match of readFileSync(path.join(base, file), 'utf8').matchAll(/\btest\('((?:chain|priority|triggers)-[a-z0-9-]+)/g)) tests.set(match[1], `../../test/${dir}/${file}`);
  }
}
const reasons = {
  'chain-chronobreak-multiplayer-turn-order': '命名卡程序与多个拥有者的 Play 编排未接入；不能用手工加入单位链项冒充 Chronobreak。',
  'priority-noncombat-showdown-conquer': '非战斗对决后建立控制、征服由 scoring/combat 任务负责；本层已验证关闭及焦点。',
  'priority-combat-showdown-proceeds-to-damage': '后续战斗伤害编排属于 combat 任务，未改范围外模块。',
  'triggers-disarm-merged-single-trigger': '关键词展开的 Disarm 合并由 keyword 层提供，本层不解释关键词或卡牌文字。',
  'triggers-conquer-unit-present': '需要 scoring 的真实征服动作及单位在场判定，不能用时点注入冒充完整场景。',
  'triggers-conquer-point-replaced-still-triggers': '需要征服与得分两个独立动作的 scoring 接线。',
  'triggers-hold-unit-present': '需要 scoring 的真实固守及单位在场判定。',
  'triggers-hold-point-replaced-still-triggers': '需要固守与得分两个独立动作的 scoring 接线。',
  'triggers-activate-named-trigger-checks-other-conditions': '命名触发激活缺内部入口；已列契约变更请求，不绕过其余条件。',
  'triggers-activate-named-trigger-not-real-event': '同上；不合成未发生的攻击、征服或固守事件。',
  'triggers-replacement-secret-zone-simultaneous': '秘密区域“as reveal/look”例外需要状态执行器提供同刻观察及替代协议，普通事前拦截不足。',
  'triggers-delayed-window-ended-not-generated': '原语未传延迟窗口期限，见契约变更请求 3。',
  'triggers-nth-time-simultaneous-pick-one': '需要第 N 次事件资格和同刻择一的卡牌/历史适配器，不把 once 偷换成第 N 次。',
  'triggers-combat-attacker-first-then-defender': '466.2.d.1 要求 combat 提供攻守分组顺序；普通触发仍严格使用 303.2.a 的回合顺序。'
};
const lines = ['# 场景 ID 对照', '', '由 `node packages/engine-core/test/chain/scenario-coverage.mjs` 生成。覆盖口径见 README；不等同于完整卡牌/战斗验收。', ''];
for (const chapter of ['chain', 'priority', 'triggers']) {
  const ids = [...readFileSync(path.join(root, `docs/rules/scenarios/${chapter}.yaml`), 'utf8').matchAll(/^  - id: (\S+)/gm)].map(match => match[1]);
  const covered = ids.filter(id => tests.has(id)).length;
  if (covered < 15) throw new Error(`${chapter} requires 15 scenarios`);
  lines.push(`## ${chapter}：${covered}/${ids.length}`, '', '| 场景 ID | 状态 / 对照 |', '| --- | --- |');
  for (const id of ids) {
    if (tests.has(id)) lines.push(`| ${id} | 覆盖：[测试](${tests.get(id)}) |`);
    else {
      if (!reasons[id]) throw new Error(`Missing uncovered reason: ${id}`);
      lines.push(`| ${id} | 未覆盖：${reasons[id]} |`);
    }
  }
  lines.push('');
}
process.stdout.write(lines.join('\n'));
