// Scenario: movement-illegal-effect-move-becomes-recall (CR v1.5 449.2.c)
import test from 'node:test';

test.todo(
  'movement-illegal-effect-move-becomes-recall: missing the corrective Recall of 449.2.c — ' +
  'src/effects/instructions/effect.move.ts owns no path-restriction re-check and the substitute ' +
  'Recall action is blocked (mode:"recall" returns negated/impossible with blockedReason), so an ' +
  'illegal destination cannot yet be turned into a Recall',
);
