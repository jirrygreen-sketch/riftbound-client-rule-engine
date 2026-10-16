import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/cleave.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const [speed, play] = program.abilities;
const grantInstruction = play.body[0];
const targetSpec = grantInstruction.targets[0];

test("Cleave program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  // The reason must name the missing primitive and the dependent keyword
  // expansion, not just "not implemented".
  assert.match(program.judgeReason, /continuous\.keyword|continuous\.grant-keyword/);
  assert.match(program.judgeReason, /Assault/);
  assert.match(program.judgeReason, /designation/);
});

test("Cleave identity, status and sourceText match the printing", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-e946abd159c3e001431a6266172cc524d41158117457180e81e85ef7690a4354"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Give a unit [Assault 3] this turn. (+3 :rb_might: while it's an attacker.)"
  );
});

test("Cleave structure: [Action] plus a duration-bounded Assault 3 grant to one unit", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map(instruction => [instruction.id, instruction.op]),
    [["cleave.grant-assault-3", "continuous.grant-keyword"]]
  );

  // The printed cost is 1 Energy; this printing has no Power value (null in the
  // catalog), so no Power component is declared — null is not rewritten as 0.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 }
  });
  assert.equal(Object.hasOwn(play.cost, "power"), false);

  // The grant names the printed keyword and value and the end-of-turn duration
  // (317.2.c); the keyword expansion itself belongs to the Assault KeywordDef.
  assert.deepEqual(grantInstruction.args.keyword, { kind: "constant", value: "Assault" });
  assert.deepEqual(grantInstruction.args.value, { kind: "constant", value: 3 });
  assert.deepEqual(grantInstruction.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.equal(grantInstruction.linkedTo, undefined);
  assert.equal(grantInstruction.picks, undefined);

  assert.equal(grantInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "cleave.unit");
  assert.deepEqual(targetSpec.filter, { type: "unit", zone: "board" });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
});

test("Cleave golden execution: the unregistered grant fails closed and changes nothing", () => {
  // The program must not pretend to grant anything. With a legal locked target
  // the merged interpreter reaches the missing op and throws rather than
  // inventing a substitute, so the card cannot silently mutate Might through a
  // Buff counter or a no-op closure.
  const kernel = world().unit("friendly-unit", { might: 2, buffs: 0 }).build();
  kernel.setTargets("cleave.unit", [kernel.ref("friendly-unit")]);

  assert.throws(
    () => resolveChainBody(play.body, kernel),
    /Unregistered instruction opcode: continuous\.grant-keyword/
  );
  assert.equal(kernel.getObject("friendly-unit").might, 2);
  assert.equal(kernel.getObject("friendly-unit").buffs, 0);
  assert.equal(kernel.getObject("friendly-unit").keywords.length, 0);
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "Cleave: 'Give a unit [Assault 3] this turn' needs a duration-bounded " +
    "continuous keyword-grant primitive (continuous.keyword, excluded from the " +
    "RIFT-9 candidate route) plus attacker-designation support so the merged " +
    "Assault expansion can compute the +3 Might while the unit attacks (807.1.c / " +
    "807.1.d.1)."
);

test.todo(
  "Cleave: the end-of-turn expiry of the granted Assault must be applied " +
    "simultaneously with all other 'this turn' effects (317.2.c) by the timing " +
    "point driven duration handling."
);
