// Shared golden-test harness for the RIFT-225 UNL unit programs.
//
// The merged chain adapter (engine-core/dist/chain/interpreter-adapter.js) wraps a
// registered primitive's IR arguments in one primitiveArgs constant and then decodes
// only the literal fields listed in its own LITERAL_FIELDS table. Two consequences
// matter for these cards:
//   1. effect.reveal's "pick" is not in that table, so a reveal driven by a
//      non-target pick is rejected at dispatch with "pick must be a non-empty id"
//      (reported in the card's judgeReason / test.todo, contract change request).
//   2. effect.discard / effect.ready / effect.inspect expect Expr nodes, while the
//      adapter hands them already-decoded literals.
// testRegistry() reproduces the adapter's two steps exactly and additionally decodes
// the fields this task's cards need, so the golden tests execute the real primitives
// over the real (unmodified) IR arguments. It is test-only wiring: it changes no
// primitive semantics and does not stand in for missing production wiring.

import { instructionDefinitionsById } from "../../../../../engine-core/dist/effects/instructions/registry.generated.js";

const unwrapLiteral = (value) =>
  value && typeof value === "object" && (value.kind === "constant" || value.kind === "literal")
    ? value.value
    : value;

// The adapter's table verbatim (engine-core/src/chain/interpreter-adapter.ts), plus
// the one entry this task's cards need and the adapter lacks: effect.reveal's pick.
const LITERAL_FIELDS = {
  "effect.draw": ["target", "pick", "choice", "linkKey"],
  "effect.damage": ["target", "combat"],
  "effect.counter": ["target"],
  "effect.buff": ["mode", "target", "chooser", "chooseUpTo"],
  "effect.exhaust": ["target", "pick", "choice"],
  "effect.kill": ["target", "picks", "self", "reason"],
  "effect.detach": ["pick"],
  "effect.play": ["target", "pick", "choice", "linkKey"],
  "effect.recycle": ["target", "from"],
  "effect.zone": ["target", "pick", "choice"],
  // Not decode-ready in the merged adapter (see the file header):
  "effect.reveal": ["pick", "target"]
};

function decodePrimitiveArgs(op, value) {
  const raw = { ...value.primitiveArgs };
  for (const key of LITERAL_FIELDS[op] ?? []) {
    if (raw[key] !== undefined) raw[key] = unwrapLiteral(raw[key]);
  }
  return raw;
}

/** Mirror of the adapter's prepare( ): registered primitives get one constant envelope. */
export function prepareBody(body) {
  return body.map((instruction) => {
    if (instructionDefinitionsById.has(instruction.op)) {
      return {
        ...instruction,
        args: { primitiveArgs: { kind: "constant", value: instruction.args } }
      };
    }
    const args = Object.fromEntries(
      Object.entries(instruction.args).map(([key, expression]) => {
        if (expression.kind === "constant" && key === "body" && Array.isArray(expression.value)) {
          return [key, { ...expression, value: prepareBody(expression.value) }];
        }
        if (expression.kind === "constant" && key === "modes" && Array.isArray(expression.value)) {
          return [
            key,
            {
              ...expression,
              value: expression.value.map((mode) => ({ ...mode, body: prepareBody(mode.body) }))
            }
          ];
        }
        return [key, expression];
      })
    );
    return { ...instruction, args };
  });
}

/** The merged primitive registry with the decode table above applied. */
export function testRegistry() {
  return new Map(
    [...instructionDefinitionsById].map(([op, definition]) => [
      op,
      {
        op,
        argsSchema: {
          parse: (value) => definition.argsSchema.parse(decodePrimitiveArgs(op, value))
        },
        execute: (context, args) => definition.execute(context, args)
      }
    ])
  );
}
