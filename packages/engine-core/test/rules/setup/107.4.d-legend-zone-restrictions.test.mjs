// Golden test placeholders for the setup chapter negative scenarios
//   setup-champion-legend-cannot-be-displaced
//   setup-non-champion-legend-zone-restriction
// (docs/rules/scenarios/setup.yaml).
//
// CR v1.5 107.4.d: the Champion Legend cannot be removed, moved, or displaced
// from the Legend Zone. 107.4.d.1: some effects may add a legend card or token
// to the Legend Zone. 107.4.d.2: non-Champion legends may be removed from the
// Legend Zone but cannot exist anywhere else. 174.2.b: legends are established
// at the start of a game and remain in place. 174.3 / 174.4: legends cannot be
// destroyed or moved out.
//
// Both scenarios need an effect that tries to move or banish a legend, so the
// missing pieces are the instruction op and the zone model, not the setup path.
import test from 'node:test';

// 107.4.d / 174.3 / 174.4: banish or move a Champion Legend must be impossible.
// The contract has no legend-zone member: `ZoneId` in src/effects/contract.ts is
// hand | deck | rune-deck | trash | banishment | board | rune-zone | chain, and
// `ZoneDestination` has the same gap, so no GameAction can express "move this
// object to / out of the Legend Zone" and no instruction op exists for it
// (src/effects/instructions/ has no legend op; the registry has 42 entries, none
// of them legend-related). The match lifecycle creates the legend as a Chain
// token and records it in MatchSetupReport.legendZone, but that report is the
// only legend-zone representation in the new kernel.
test.todo('setup-champion-legend-cannot-be-displaced (107.4.d / 174.3 / 174.4): a Banish-target-legend effect must not move the Champion Legend — blocked: no legend-zone ZoneId/ZoneDestination in src/effects/contract.ts and no registered effect.* op that targets the Legend Zone');

// 107.4.d.2: a non-Champion legend may leave the Legend Zone but cannot exist
// in any other zone. That needs the same missing zone member plus the rule 055
// partial-resolution behaviour for the illegal destination (the same
// "impossible outcome" path `scoring-...` style tests use). Nothing in the new
// tree models a non-Champion legend at all: the match setup only holds the one
// Champion Legend per seat, and src/zones/permanent-state.ts keeps legends in a
// `zone.kind === 'legend-zone'` record with no transition validator for them.
test.todo('setup-non-champion-legend-zone-restriction (107.4.d.2): "return target legend to hand" must fail instead of moving the legend — blocked: no legend-zone zone member + no non-Champion legend model (src/zones/permanent-state.ts legendStates is champion-legend-only)');
