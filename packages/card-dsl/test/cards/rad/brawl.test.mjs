import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/brawl.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));

const CANONICAL = "card.hash-cad809540cf272ccc60c72a21f1a6766f3fdc07a03fa01da81c97bd46c428af7";
const [keyword, play] = program.abilities;
const grant = play.body[0];

test("rad-004-167 Brawl: program passes validateCardProgram and keeps the printing text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Give a unit [Assault] this turn equal to its Might. (+1 :rb_might: for each instance of Assault while it's an attacker.)"
  );
});

test("rad-004-167 Brawl: judge-required with the missing keyword-grant reason", () => {
  assert.equal(program.status, "judge-required");
  // The reason must name the missing semantics and the owning tasks, not just
  // "not implemented".
  assert.match(program.judgeReason, /continuous\.keyword/);
  assert.match(program.judgeReason, /RIFT-81/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("rad-004-167 Brawl: [Action] keyword plus a one-target grant of a dynamic Assault value", () => {
  assert.equal(program.abilities.length, 2);
  // [Action] is a speed keyword (CR 806 / 159.2.a) expanded by the keyword
  // registry; the card only names it.
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });

  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);
  assert.equal(grant.id, "brawl.grant-assault");
  // No merged primitive can grant a keyword (contract 3.7 continuous.keyword).
  assert.equal(grant.op, "continuous.grant-keyword");
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Assault" });
  // "equal to its Might" (CR 807.2) reads the chosen unit's current Might at
  // resolution through the target selector — not a printed constant.
  assert.deepEqual(grant.args.amount, {
    kind: "object-property",
    object: { target: "brawl.unit" },
    property: "might"
  });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "end-of-turn" });

  assert.equal(grant.targets.length, 1);
  assert.deepEqual(grant.targets[0], {
    id: "brawl.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(grant.picks, undefined);
  assert.equal(grant.linkedTo, undefined);
  assert.equal(grant.condition, undefined);
});

test("rad-004-167 Brawl: the printed 'equal to its Might' reads the target's real Might", () => {
  // The dynamic amount is the only part of this card that merged code can run:
  // the interpreter evaluates object-property against the locked target set
  // (contract 3.6 取值时机即调用时).
  const kernel = world()
    .unit("grown-unit", { owner: "A", might: 7 })
    .build();
  kernel.setTargets("brawl.unit", [kernel.ref("grown-unit")]);
  assert.equal(kernel.evaluate(grant.args.amount), 7);

  const other = world().unit("small-unit", { owner: "A", might: 2 }).build();
  other.setTargets("brawl.unit", [other.ref("small-unit")]);
  assert.equal(other.evaluate(grant.args.amount), 2);
});

test("rad-004-167 Brawl: the grant op is not registered, so the ability cannot resolve", () => {
  // Evidence that the card is not executable: the merged interpreter has no
  // opcode for the keyword grant and refuses the body instead of silently
  // no-oping it.
  const kernel = world().unit("unit", { owner: "A", might: 4 }).build();
  kernel.setTargets("brawl.unit", [kernel.ref("unit")]);
  assert.throws(() => runAbilityBody(play.body, kernel), /Unregistered instruction opcode: continuous\.grant-keyword/);
});

test.todo(
  "rad-004-167 Brawl: granting [Assault] equal to the target's Might this turn " +
    "(CR 807.2/807.3 + 801.3.a.2 duration) needs the merged keyword registry expansion " +
    "(RIFT-81 kw-assault-shield) and the layers consumer for a duration-bounded " +
    "continuous.keyword grant (RIFT-91 layers-continuous); the granted value must be " +
    "locked at resolution, not re-read later"
);
test.todo(
  "rad-004-167 Brawl: full chain play (3 Energy + 1 Chaos Power payment, [Action] showdown " +
    "permission) needs the Finalize cost plan adapter (RIFT-89) and chain admission"
);
