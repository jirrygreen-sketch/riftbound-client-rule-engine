import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  disempowerTransition,
  empowerTransition,
  empoweredState,
  readEmpowered,
  tryReadEmpowered
} from "../../dist/zones/empower-state.js";

const snapshot = values => ({
  ref: { id: "object", zoneEntryId: 1 },
  cardId: "test.empowered",
  name: "object",
  types: ["unit"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "board",
  location: { type: "battlefield", id: "battlefield-1" },
  might: 3,
  energy: null,
  power: null,
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false,
  ...values
});

test("the shared type contract keeps legacy snapshots valid and types Empowered as a count", async () => {
  const { default: typescript } = await import("typescript");
  const compiled = typescript.createProgram(
    [fileURLToPath(new URL("./empowered-contract.types.ts", import.meta.url))],
    {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      target: typescript.ScriptTarget.ES2022,
      module: typescript.ModuleKind.NodeNext,
      moduleResolution: typescript.ModuleResolutionKind.NodeNext
    }
  );
  const diagnostics = typescript.getPreEmitDiagnostics(compiled);
  assert.deepEqual(
    diagnostics.map(diagnostic => typescript.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    []
  );
});

test("legacy ObjectSnapshot construction remains valid without Empowered fields", () => {
  const legacy = snapshot({});
  assert.equal(Object.hasOwn(legacy, "empowered"), false);
  assert.equal(Object.hasOwn(legacy, "empoweredCount"), false);
  assert.equal(tryReadEmpowered(legacy), null);
  assert.throws(() => readEmpowered(legacy), /unavailable/);
});

test("canonical empowered and the empoweredCount compatibility spelling read the same count", () => {
  for (const count of [0, 1, 2, Number.MAX_SAFE_INTEGER]) {
    assert.equal(readEmpowered(snapshot({ empowered: count })), count);
    assert.equal(readEmpowered(snapshot({ empoweredCount: count })), count);
    assert.equal(readEmpowered(empoweredState(count)), count);
    assert.deepEqual(empoweredState(count), { empowered: count, empoweredCount: count });
  }
});

test("missing and invalid counts fail closed instead of becoming zero", () => {
  for (const values of [
    {},
    { empowered: null },
    { empowered: "1" },
    { empowered: -1 },
    { empowered: 1.5 },
    { empowered: Number.NaN },
    { empowered: Number.POSITIVE_INFINITY },
    { empoweredCount: -1 },
    { empoweredCount: 2.5 }
  ]) {
    const candidate = snapshot(values);
    assert.equal(tryReadEmpowered(candidate), null, JSON.stringify(values));
    assert.throws(() => readEmpowered(candidate), /Empowered state|nonnegative safe integer/);
  }
});

test("the existing reader gives canonical empowered precedence when both spellings are present", () => {
  assert.equal(readEmpowered(snapshot({ empowered: 2, empoweredCount: 2 })), 2);
  assert.equal(readEmpowered(snapshot({ empowered: 2, empoweredCount: 1 })), 2);
  assert.equal(readEmpowered(snapshot({ empowered: 0, empoweredCount: 2 })), 0);
});

test("Empower transitions distinguish zero, binary, stacking, and missing state", () => {
  assert.deepEqual(empowerTransition(snapshot({ empowered: 0 })), {
    previousCount: 0, currentCount: 1, appliedAmount: 1, changed: true
  });
  assert.deepEqual(empowerTransition(snapshot({ empowered: 1 })), {
    previousCount: 1, currentCount: 1, appliedAmount: 0, changed: false,
    reason: "already-empowered"
  });
  assert.deepEqual(empowerTransition(snapshot({ empowered: 1 }), { amount: 2, multiple: true, limit: 3 }), {
    previousCount: 1, currentCount: 3, appliedAmount: 2, changed: true
  });
  assert.throws(() => empowerTransition(snapshot({}), { multiple: true }), /unavailable/);
});

test("each Disempower removes exactly one status and zero is a no-op (CR v1.5 443.1.b)", () => {
  let state = snapshot({ empowered: 2 });
  const first = disempowerTransition(state);
  assert.deepEqual(first, {
    previousCount: 2, currentCount: 1, appliedAmount: 1, changed: true
  });
  state = { ...state, empowered: first.currentCount };
  const second = disempowerTransition(state);
  assert.deepEqual(second, {
    previousCount: 1, currentCount: 0, appliedAmount: 1, changed: true
  });
  state = { ...state, empowered: second.currentCount };
  assert.deepEqual(disempowerTransition(state), {
    previousCount: 0, currentCount: 0, appliedAmount: 0, changed: false,
    reason: "not-empowered"
  });
});

test("ordinary Buff markers are not an Empowered surrogate and remain unchanged", () => {
  const buffed = snapshot({ buffs: 3 });
  assert.equal(tryReadEmpowered(buffed), null);
  assert.throws(() => disempowerTransition(buffed), /unavailable/);
  assert.equal(buffed.buffs, 3);

  const empowered = snapshot({ buffs: 3, empowered: 2 });
  const transition = disempowerTransition(empowered);
  assert.equal(transition.currentCount, 1);
  assert.equal(empowered.buffs, 3);
});
