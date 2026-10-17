// Golden test placeholder for the setup chapter FFA3 scenario
//   setup-battlefield-selection-ffa3
// (docs/rules/scenarios/setup.yaml).
//
// CR v1.5 489.4: the FFA3 Battlefield Count is three. 489.5: each player
// randomly selects one of their three Battlefields, the other two are discarded,
// and the selected Battlefields are placed simultaneously between the three
// players before play.
//
// The merged rules layer is a two-seat driver: TurnFlow rejects any turnOrder or
// battlefield list that is not exactly two entries ("This driver supports 1v1
// only" / "Duel requires two distinct battlefields"), createMatch takes exactly
// two decks, and src/state has no three-seat seating beyond the reference test
// kernel. There is no FFA3 mode model to drive the scenario.
import test from 'node:test';

test.todo('setup-battlefield-selection-ffa3 (489.4 / 489.5): three seats each select one of three Battlefields into a three-Battlefield zone — blocked: TurnFlow is 1v1 only (src/turn/flow.ts rejects turnOrder/battlefield counts other than two) and createMatch takes exactly two decks');
