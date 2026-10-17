import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/karthus-eternal.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import deathknell from "../../../../engine-core/dist/effects/keywords/Deathknell.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL = "card.hash-f3293211dd6f878acb245cc2cf0f2d2f2b066eed84ddbc009999e2176265a0ae";
const [ability] = program.abilities;

test("ogn-236-298 Karthus, Eternal: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-236-298 Karthus, Eternal: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /808\.1/);
  assert.match(program.judgeReason, /RIFT-82/);
  assert.match(program.judgeReason, /frequencyKey/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(program.sourceText, "Your [Deathknell] effects trigger an additional time.");
});

test("ogn-236-298 Karthus, Eternal: one static trigger-multiplicity effect scoped to friendly Deathknells", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.trigger-multiplicity");
  assert.equal(ability.effect.mode, "additional");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });
  assert.deepEqual(ability.effect.appliesTo, {
    keyword: "deathknell",
    controller: "controller",
    zone: "board"
  });
  assert.equal(ability.condition, undefined);
});

test("ogn-236-298 Karthus, Eternal: the Deathknell consumer it depends on is still incomplete", () => {
  // The keyword definition exists and is registered (CR 808.1), but its expansion
  // still emits trigger.leave (no execution evidence yet), and events/pipeline.ts
  // has no multiplicity hook: the extra-trigger model has nothing to multiply yet.
  assert.equal(keywordDefinitionsById.get("Deathknell"), deathknell);
  assert.equal(deathknell.keyword, "Deathknell");
  // CR 808.2: each Deathknell instance triggers separately; there is no multiplicity hook.
  assert.equal(deathknell.stacking, "separate");
  const expansion = deathknell.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.length, 1);
  assert.equal(expansion[0].body[0].op, "trigger.leave");
});

test.todo(
  "ogn-236-298 Karthus, Eternal: multiplying a Deathknell trigger during trigger collection " +
    "(CR 808.1/808.2, 383.3.e; cf. the Red Brambleback example in 383.4.g.2) needs a trigger-" +
    "multiplicity model in events/ (frequencyKey/consume is dedupe-only), the trigger.leave " +
    "primitive for the Deathknell expansion (RIFT-82) and the RIFT-257 keyword-to-trigger binding"
);
