// Scenarios `turn-draw-burnout-recycles-trash-and-gives-point` (CR v1.5 315.4.b.1 /
// 414.4 / 432.2) and `turn-burnout-repeated-until-opponent-wins` (CR v1.5 432.3 /
// 432.3.c.1).
//
// Burn Out is a multi-step structural rule task: recycle the whole Trash into the
// Main Deck (randomized, 432.2.b), the burned-out player chooses an opponent to gain
// 1 point (432.2.c), then the remaining draws complete (432.2.d); on an empty Deck
// and Trash the process repeats and the points become unreplaceable, with an
// immediate win at the Victory Score (432.3.c.1). The merged new-layer kernel has no
// such task: `src/turn/flow.ts` `draw` fails closed with `TurnCombatBlockedError`
// code `burn-out` rather than drawing fewer cards or fabricating the point. A blocked
// boundary assertion for the first scenario already exists at
// test/turn/flow.test.mjs; these todos record the missing pieces.
import test from 'node:test';

test.todo('turn-draw-burnout-recycles-trash-and-gives-point: blocked — Burn Out needs a structural rules task (module: src/turn/flow.ts draw task + src/events/pipeline.ts atomic batch/rollback; op: none (game action sequence, not an instruction); timing: 315.4.b.1 Draw Phase per 432.2). Source: src/turn/flow.ts `draw` throws status=blocked code=burn-out. Required steps: recycle the entire Trash into the Main Deck randomized (432.2.b), the burner chooses an opponent who gains 1 point (432.2.c), then the remainder of the draw completes (432.2.d). Existing blocked-boundary test: test/turn/flow.test.mjs «turn-draw-burnout-recycles-trash-and-gives-point».');

test.todo('turn-burnout-repeated-until-opponent-wins: blocked — repeated Burn Out on an empty Deck and Trash must award an unreplaceable point per cycle and end the game immediately at the Victory Score without waiting for a Cleanup (CR 432.3.a / 432.3.b / 432.3.c.1; module: src/turn/flow.ts draw task + structural rules task; op: none; timing: 315.4.b.2 Draw Phase). Source: src/turn/flow.ts `draw` throws status=blocked code=burn-out and the victory path only runs inside Cleanup (src/turn/flow.ts `cleanup`). src/game/lifecycle.ts implements this loop for the pre-match Mulligan path only; TurnFlow has no Draw-Phase equivalent.');
