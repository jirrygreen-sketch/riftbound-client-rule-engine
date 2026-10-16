// Scenario: movement-deploy-gear-killed-when-opponent-holds (CR v1.5 830.1.b, 471.2)
import test from 'node:test';

test.todo(
  'movement-deploy-gear-killed-when-opponent-holds: TurnFlow already emits hold with ' +
  'details.battlefieldId, but the Deploy keyword IR trigger still needs registration and filter ' +
  'adaptation: Deploy.expand uses {event:"hold", here:true}, while the frozen EventPattern ' +
  'uses event:"held" and has no host-relative here selector. Without that consumer, ' +
  '"when an opponent holds here, kill this" cannot be executed as the Deploy keyword',
);
