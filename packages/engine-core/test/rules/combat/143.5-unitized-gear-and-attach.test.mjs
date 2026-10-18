// Scenarios whose full expectation needs the Lady of Clockwork trait rewrite or an
// attach instruction, plus the Combat start they then stage
// (CR v1.5 143.5, 143.5.a, 143.5.b, 830, 830.1.b, 830.1.b.1, 435.1.h, 435.1.h.2,
//  718.6, 718.6.a, 190.3.a, 323.11, 323.12, 466.2.c.1.a, 471.2):
//   combat-deploy-gear-becomes-unit-stages-showdown-orianna
//   combat-attached-gear-becomes-unit-detaches                  (combat half)
//   combat-negative-attach-unit-noop                            (combat framing)
//   combat-deploy-hold-kills-enemy-gear
//
// The detachment semantics themselves ARE executed — see
// test/rules/layers/143.5.b-attached-equipment-becomes-unit-detaches.test.mjs and
// test/rules/layers/143.5-attach-unit-to-permanent-nothing-happens.test.mjs. The
// combat-framed versions above additionally need the real card program and/or an
// attach instruction path.
import test from 'node:test';

test.todo(
  'combat-deploy-gear-becomes-unit-stages-showdown-orianna (830 / 143.5.b / 190.3.a / 323.11): Lady of '
  + 'Clockwork must turn a friendly Deploy Gear into a Unit Gear, apply Contested for its controller and '
  + 'then stage/open the Combat in Cleanup. Missing: the RAD-145 card program is `judge-required` '
  + '(packages/card-dsl/src/cards/rad/lady-of-clockwork.ts records the three gaps — a cost slot on '
  + 'TriggeredAbility for "you may pay 1", a trait-layer type rewrite plus Might set bound to one '
  + 'instruction, and the "until you choose another gear with me" duration), and the staged Combat still '
  + 'cannot open (combat-start-transaction)',
);

test.todo(
  'combat-attached-gear-becomes-unit-detaches (143.5.b / 435.1.h.2 / 718.6.a): the combat-framed version of '
  + 'an attached Gear becoming a Unit through a card effect and immediately detaching. The detachment rule '
  + 'itself is executed in test/rules/layers/143.5.b-attached-equipment-becomes-unit-detaches.test.mjs; '
  + 'this scenario additionally needs the Lady of Clockwork activation (judge-required program) to trigger '
  + 'it, so it cannot be driven end to end yet',
);

test.todo(
  'combat-negative-attach-unit-noop (143.5.a / 718.6.a): the combat framing expects the attach command to be '
  + 'REFUSED as an illegal action (rejected reason "illegal-attach"). The rule semantics ("nothing '
  + 'happens") are already executed through the real effect.attach primitive in '
  + 'test/rules/layers/143.5-attach-unit-to-permanent-nothing-happens.test.mjs; what is missing is an '
  + 'attach command validator at the action-admission layer — src/chain/engine.ts has no attach action and '
  + 'the frozen GameAction set exposes attach only as an effect primitive action',
);

test.todo(
  'combat-deploy-hold-kills-enemy-gear (830.1.b / 471.2 / 315.2.b.2): the opponent\'s Hold at the Battlefield '
  + 'kills the Deploy Gear deployed there. Missing: the Deploy keyword\'s hold trigger is not registrable — '
  + 'its filter `{ event: "hold", here: true, player: "opponent" }` is rejected by src/programs/filters.ts '
  + '("Unsupported filter field here") and by the frozen TriggerSpec EventPattern, and the hold timing '
  + 'details carry only battlefieldId (no host-relative "here" selector). The same gap is registered from '
  + 'the scoring chapter in test/rules/scoring/830.1.b-deploy-on-hold.test.mjs',
);
