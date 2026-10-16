import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/renata-glasc-industrialist.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-f24db41d4c6576e3cd77510e93f4c384bab9ccb151eba3ce9a3666b6862b79d3";
const [ability] = program.abilities;
const [enterReady] = ability.with;

test("sfd-171-221 Renata Glasc, Industrialist: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Entry overrides are not supported/);
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.equal(program.sourceText, "Your tokens enter ready.");
});

test("sfd-171-221 Renata Glasc, Industrialist: entry replacement over this controller's tokens", () => {
  // 369.1 / 369.3: describing how a permanent enters is a Replacement Effect;
  // the merged Accelerate expansion uses this exact shape.
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "replacement");
  assert.deepEqual(ability.replaces, {
    event: "object-enters-board",
    filter: { type: "token", controller: "self" }
  });
  assert.equal(ability.with.length, 1);
  assert.equal(enterReady.id, "renata.tokens-enter-ready");
  assert.equal(enterReady.op, "effect.ready");
  // The entering token of the replaced event is not a target choice (355.10.c)
  // and no merged selector binds it; the referent stays symbolic.
  assert.deepEqual(enterReady.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "renata.entering-token" }
  });
  assert.deepEqual(enterReady.targets, [
    {
      id: "renata.entering-token",
      filter: { type: "token", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("sfd-171-221 Renata Glasc, Industrialist: the merged token action supports no entry override", () => {
  // 143.4 / 184.1 / 185.2.d: the entry state is owned by creation. The merged
  // primitive documents "Entry overrides are not supported"; an unknown
  // argument is rejected rather than silently ignored.
  const kernel = world().player("A").build();
  // The frozen schema rejects an entry-state argument outright instead of
  // silently accepting and ignoring it.
  assert.throws(
    () =>
      runInstruction(
        token,
        {
          token: { kind: "constant", value: "mech" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "create" },
          location: { kind: "constant", value: { type: "base", player: "A" } },
          entersExhausted: { kind: "constant", value: false }
        },
        { world: kernel }
      ),
    /Invalid effect\.token argument: entersExhausted/
  );
  assert.equal(kernel.objects.filter((object) => object.isToken).length, 0);
});

test.todo(
  "sfd-171-221 Renata Glasc, Industrialist: register the card replacement and read the entering token " +
    "of the replaced event so tokens enter ready instead of entering exhausted then readying " +
    "(replacement.enter, engine batch 4/5)"
);
