// Scenario: movement-deploy-gear-killed-when-opponent-holds (CR v1.5 830.1.b, 471.2)
import test from 'node:test';

test.todo(
  'movement-deploy-gear-killed-when-opponent-holds: missing the hold-trigger registration and the ' +
  'Battlefield identity on the scoring event — src/effects/keywords/Deploy.ts emits its hold trigger ' +
  'as IR data only (its header notes the hold trigger registration and the cleanup/recall exemption ' +
  'consumers are not merged), so "when an opponent holds here, kill this" cannot be executed',
);
