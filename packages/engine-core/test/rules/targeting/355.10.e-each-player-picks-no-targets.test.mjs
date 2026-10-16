// Scenario: targeting-each-player-picks-no-targets (CR v1.5 355.10.e, 412.1)
//
// Cull the Weak ("Each player kills one of their units.") does not target: each
// player, including the caster, chooses a unit while the spell resolves.
import test from 'node:test';

// 355.10.e requires a resolution-time choice made separately by every player.
// The merged kernel only offers ctx.choose to the ability controller
// (effect.kill asks ctx.controller for its own selection), and no merged
// primitive collects one choice per player. Implementing this scenario with the
// controller's single choice would invent the other players' picks, so it stays
// a todo until a per-player choice primitive (or an interpreter lifecycle
// adapter for 412.1 "each player") is merged.
test.todo('targeting-each-player-picks-no-targets: blocked on a per-player resolution choice (355.10.e / 412.1) — missing op/选择原语 for "each player chooses", effect.kill only asks the ability controller');
