import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import program from "../../../dist/cards/ogs/garen-commander.js";

const CANONICAL =
  "card.hash-74b83d5a2a718072a63d9ce9431ec68047c326c6c61dad708fc3642b6b3c76a2";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };

/** Replace the card's symbolic "controller" filter value with a concrete player id. */
function substituteController(value, playerId) {
  if (Array.isArray(value)) return value.map(item => substituteController(item, playerId));
  if (value === null || typeof value !== "object") return value === "controller" ? playerId : value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, substituteController(item, playerId)])
  );
}

test("ogs-013-024 Garen, Commander: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, "Other friendly units have +1 :rb_might: here.");
});

test("ogs-013-024 Garen, Commander: judgeReason names continuous.might and the dynamic here/other set", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /here|sameLocationAs/);
});

test("ogs-013-024 Garen, Commander: one static +1 Might effect scoped to other friendly units here", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });
  // "Other friendly units ... here": the controller's units at the host's
  // current location, excluding the host (CR 053.3, 143.2, 355.10.d,
  // 359.3.f.2). The anchors are contract 3.6 ObjectSelectors, bound at runtime.
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    controller: "controller",
    exclude: "source",
    sameLocationAs: "source"
  });
});

test("ogs-013-024 Garen, Commander: the here/other filter matches exactly the co-located friendly units", () => {
  // The layer consumer is missing (judgeReason); this locks the filter anchors
  // through the merged interpreter's selector resolution by driving the same
  // anchor filter with the merged effect.ready set selector, which readies the
  // matched set and links it. Only "other friendly units here" may match.
  const kernel = world()
    .unit("garen", { location: BATTLEFIELD, exhausted: false })
    .unit("ally-here", { location: BATTLEFIELD, exhausted: true })
    .unit("ally-elsewhere", { location: { type: "base", player: "A" }, exhausted: true })
    .unit("enemy-here", { owner: "B", location: BATTLEFIELD, exhausted: true })
    .build();

  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("garen") });
  // The reference kernel compares filter values literally, so the card's symbolic
  // "controller" placeholder is substituted with the acting player here (the same
  // convention as sfd/show-of-strength.test.mjs); production resolves it.
  const filter = substituteController(program.abilities[0].effect.filter, scoped.controller);
  const outcome = runAbilityBody(
    [
      {
        id: "garen.ready-set",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "query", filter } } }
      }
    ],
    scoped
  );

  assert.equal(outcome.status, "executed");
  const readied = outcome.linkedValues["garen.ready-set.readied"];
  assert.deepEqual(readied.objects.map(ref => ref.id), ["ally-here"]);
  assert.equal(readied.count, 1);
  // The host itself, a unit at another location, and an enemy co-located unit are not in the set.
  assert.equal(scoped.getObject("garen").exhausted, false);
  assert.equal(scoped.getObject("ally-elsewhere").exhausted, true);
  assert.equal(scoped.getObject("enemy-here").exhausted, true);
});

test.todo(
  "ogs-013-024 Garen, Commander: other friendly units at the host's current location get +1 Might in the " +
    "arithmetic layer (CR 143.2, 053.3, 355.10.d, 359.3.f.2) — depends on the layers/continuous-effect " +
    "registration path and dynamic host/location binding (RIFT-91, RIFT-89/90)"
);
