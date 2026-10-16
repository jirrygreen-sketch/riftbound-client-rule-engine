import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "@riftbound/card-dsl";

import deathknell from "../../../dist/effects/keywords/Deathknell.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { isTimingPointId } from "../../../dist/events/timing-points.js";
import { world } from "../../../dist/effects/testing/index.js";

const HOST = "sfd-021-221";

/** Wrap the expansion in the smallest validateCardProgram-compatible program. */
function wrapProgram(abilities) {
  return {
    canonicalCardId: HOST,
    rulesetVersion: "core-1.5",
    status: "executable",
    abilities,
    sourceText: "[Deathknell][>] Draw 1."
  };
}

test("Deathknell KeywordDef identity: name, non-valued, separate stacking (CR 808.1 / 808.2)", () => {
  assert.equal(deathknell.keyword, "Deathknell");
  assert.equal(deathknell.valued, false);
  assert.equal(deathknell.stacking, "separate");
  assert.ok(deathknell.ruleRefs.includes("808.1.c"));
  assert.ok(deathknell.ruleRefs.includes("808.1.d.2"));
  assert.ok(deathknell.ruleRefs.includes("808.2"));
  assert.ok(deathknell.ruleRefs.includes("808.2.a"));
});

test("Deathknell expands to one mandatory triggered ability on object-killed (CR 808.1.c / 808.1.d)", () => {
  const abilities = deathknell.expand({ host: { canonicalCardId: HOST } });
  assert.equal(abilities.length, 1);
  const ability = abilities[0];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "object-killed");
  assert.ok(isTimingPointId(ability.trigger.at));
  assert.deepEqual(ability.trigger.filter, { self: true, cause: "kill", destination: "trash" });
  assert.equal(ability.body.length, 1);
  assert.equal(ability.body[0].op, "trigger.leave");
  assert.equal(ability.body[0].id, "deathknell:" + HOST + ":leave");
});

test("Deathknell expansion passes validateCardProgram (contract 3.7)", () => {
  const program = wrapProgram(deathknell.expand({ host: { canonicalCardId: HOST } }));
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Deathknell stacking stays separate: each instance expands its own trigger (CR 808.2)", () => {
  // v1.5 808.2/808.2.a: multiple Deathknell instances trigger separately; the controller
  // chooses their chain order. The keyword therefore never merges into a summed single ability.
  // Each expand call returns an independent ability object; when a card carries several
  // Deathknell instances the card program holds one expanded ability per instance, and the
  // engine keeps them separate (unlike the summed Assault/Shield/Disarm values in 807.2).
  const first = deathknell.expand({ host: { canonicalCardId: HOST } });
  const second = deathknell.expand({ host: { canonicalCardId: HOST } });
  assert.equal(deathknell.stacking, "separate");
  assert.notEqual(first, second, "each expand call returns independent ability objects");
  assert.deepEqual(first, second, "instances with the same host expand identically");
  // The card program owning two Deathknell instances lists both keyword abilities; the
  // engine expands each one into its own triggered ability and adds both to the chain.
  // CardProgram keyword abilities store the lowercase slug; KeywordDef.keyword is the
  // printed bracket name (contract 3.7) and the registry indexes the printed name.
  const program = wrapProgram([
    { kind: "keyword", keyword: "deathknell" },
    { kind: "keyword", keyword: "deathknell" }
  ]);
  const result = validateCardProgram(program);
  assert.equal(result.ok, true);
  assert.equal(result.value.abilities.length, 2);
});

test("Deathknell expansion is host-scoped: the instruction id carries the canonical card id", () => {
  const other = deathknell.expand({ host: { canonicalCardId: "ogn-042-298" } });
  assert.equal(other[0].body[0].id, "deathknell:ogn-042-298:leave");
  // The valueless keyword ignores any stray numeric input.
  const withValue = deathknell.expand({ value: 3, host: { canonicalCardId: HOST } });
  assert.deepEqual(withValue, deathknell.expand({ host: { canonicalCardId: HOST } }));
});

test("Deathknell expansion registers in the generated keyword registry", () => {
  const registered = keywordDefinitionsById.get("Deathknell");
  assert.ok(registered);
  assert.equal(registered, deathknell);
});

test("Deathknell trigger subscription body executes on the reference kernel at object-killed", () => {
  // The expansion body only references the not-yet-merged trigger.leave primitive; register a
  // minimal stand-in that records the subscription so the merged interpreter runs end to end.
  // This is test-only wiring, not an approximation of trigger.leave semantics.
  const kernel = world().unit("host-unit").build();
  kernel.timingPoint = "object-killed";
  const subscriptions = [];
  const registry = new Map([
    ["trigger.leave", {
      op: "trigger.leave",
      argsSchema: { parse: args => args },
      execute: (ctx, args) => {
        subscriptions.push({ args, timingPoint: ctx.timingPoint, source: ctx.source.ref.id });
        return { status: "executed", events: [] };
      }
    }]
  ]);

  const [ability] = deathknell.expand({ host: { canonicalCardId: HOST } });
  const outcome = runAbilityBody(ability.body, kernel, registry);

  assert.equal(outcome.status, "executed");
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].timingPoint, "object-killed");
  assert.deepEqual(subscriptions[0].args, { cause: "kill" });
});
