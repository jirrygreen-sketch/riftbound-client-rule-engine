// Scenario: movement-gear-without-deploy-battlefield-rejected (CR v1.5 148.1.a.1, 830.1.b.1)
import test from 'node:test';

test.todo(
  'movement-gear-without-deploy-battlefield-rejected: missing the continuous.location consumer ' +
  'and the Finalize Play-Destination validator — neither src/chain/engine.ts nor ' +
  'src/target/target-plan.ts checks the chosen Play location, so a non-Deploy Gear given a ' +
  'Battlefield destination is not rejected at Finalize and no cost is refunded',
);
