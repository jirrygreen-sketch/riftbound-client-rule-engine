// Scenario: movement-nondeploy-gear-recalled-in-cleanup (CR v1.5 459.1, 323.6, 149.3)
import test from 'node:test';

test.todo(
  'movement-nondeploy-gear-recalled-in-cleanup: missing the Cleanup Recall action — ' +
  'src/turn/flow.ts throws TurnCombatBlockedError("recall-action") for the 323.6 case instead of ' +
  'performing the recall, because no game action distinguishes a Recall from a Move (458)',
);
