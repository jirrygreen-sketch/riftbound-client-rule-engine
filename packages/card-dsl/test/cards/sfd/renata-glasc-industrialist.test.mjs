import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/renata-glasc-industrialist.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
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
  // RIFT-260 merged the replacement binding, so the accurate remaining gap is
  // the creation action not being a replaceable event plus the missing
  // production registration consumer.
  assert.match(program.judgeReason, /RIFT-260/);
  assert.match(program.judgeReason, /create-token/);
  assert.match(program.judgeReason, /replacement\.object/);
  assert.doesNotMatch(program.judgeReason, /replacement\.enter 族（调研 71 个身份）没有已合入实现/);
  assert.equal(program.sourceText, "Your tokens enter ready.");
  assert.equal(cardRegistryById.get(CANONICAL), program);
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

test("sfd-171-221 Renata Glasc, Industrialist: the printed Mech definition is the 3-Might Mech token", () => {
  // 187.4: the Mech unit token is a 3-Might Unit tagged Mech, with no printed
  // Energy or Power cost (185.3). The merged effect.token definition table and
  // the real creation action agree, which is the half the card's stipulation
  // would rewrite.
  const kernel = world().player("A").build();
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "mech" },
      amount: { kind: "constant", value: 1 },
      mode: { kind: "constant", value: "create" },
      location: { kind: "constant", value: { type: "base", player: "A" } }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  const [created] = kernel.objects.filter((object) => object.isToken);
  assert.equal(created.name, "Mech");
  assert.deepEqual(created.types, ["unit"]);
  assert.deepEqual(created.tags, ["Mech"]);
  assert.equal(created.might, 3);
  assert.equal(created.energy, null);
  assert.equal(created.power, null);
  assert.equal(created.zone, "board");
  assert.deepEqual(run.linked["token.objects"], [{ id: created.ref.id, zoneEntryId: created.ref.zoneEntryId }]);
});

test.todo(
  "sfd-171-221 Renata Glasc, Industrialist: a create-token action must become a matchable event " +
    "(or the creation action must accept an entry-orientation override), and a production caller must " +
    "register the CardProgram replacement with the replaced event's object, so tokens enter ready " +
    "instead of entering exhausted then readying (143.4 / 805.6) — RIFT-260 follow-up"
);

test("sfd-171-221 Renata Glasc, Industrialist: a bound replacement intercepts a board entry", () => {
  // Evidence for the judgeReason. RIFT-260's bindReplacement is live: a
  // replacement over object-enters-board really rewrites a token's board entry
  // (here: banishing it instead of readying it). The creation action is not a
  // matchable event yet, which is the card's remaining blocker.
  const kernel = world()
    .player("A")
    .unit("renata", { owner: "A", controller: "A", might: 4 })
    .build();
  const host = {
    object: (ref) => kernel.object(ref),
    objects: () => kernel.objects,
    context: () => kernel
  };
  const registered = [];
  const pipeline = {
    clock: { turn: 1 },
    registerReplacement: (registration) => registered.push(registration),
    unregisterReplacement: () => {}
  };
  kernel.perform({ type: "move-zone", object: kernel.ref("renata"), to: "base", location: { type: "base", player: "A" } });
  const hostRef = kernel.ref("renata");

  const bound = bindReplacement(
    {
      replaces: {},
      with: [{
        id: "renata.tokens-enter-ready",
        op: "replacement.event",
        args: {
          event: { kind: "constant", value: { event: "object-enters-board", filter: { type: "token" } } },
          instead: [{
            id: "banish-entering-object",
            op: "effect.zone",
            args: {
              target: { kind: "constant", value: { linked: "replacement.object" } },
              to: { kind: "constant", value: "banishment" }
            }
          }]
        }
      }]
    },
    hostRef,
    { host, pipeline }
  );
  assert.equal(registered.length, 1);

  // A real token entering the board through move-zone is intercepted.
  const tokenRef = kernel.addObject({
    ref: { id: "token-1", zoneEntryId: 1 },
    cardId: null,
    name: "Mech",
    types: ["unit"],
    tags: ["Mech"],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "chain",
    location: null,
    might: 3,
    energy: null,
    power: null,
    exhausted: true,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: true
  }, "chain");
  const entryAction = { type: "move-zone", object: tokenRef, to: "base", location: { type: "base", player: "A" } };
  assert.equal(bound.registration.matches(entryAction, entryAction), true);

  // The registration is live and applied through the merged pipeline for a
  // real board entry (the replacement rewrites it), so the card's entry data
  // is wired; only the creation event is outside the matchable action set.
  assert.equal(typeof bound.registration.apply, "function");
  assert.deepEqual(bound.registration.activeZones.includes("hand"), true);
});

