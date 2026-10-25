import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// RIFT-1062: found in a real two-browser M1 run on macOS. The combat damage
// input read event.currentTarget inside a state updater; React runs updaters
// after the event has finished dispatching, when currentTarget is null, so the
// first keystroke threw and blanked the board in the middle of combat. Static
// markup renders cannot fire input events, so the source is checked instead:
// a functional `setX(updater)` must not read `.currentTarget`/`.target` of a
// value captured from outside the updater (the event).

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/u.test(name) ? [path] : [];
  });
}

function declaredNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (child: ts.Node): void => {
    if ((ts.isParameter(child) || ts.isVariableDeclaration(child)) && ts.isIdentifier(child.name)) names.add(child.name.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

/** Lines (1-based) where a functional state update reads an outer value's currentTarget/target. */
export function eventReadsInUpdaters(fileName: string, text: string): number[] {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^set[A-Z]/u.test(node.expression.text)) {
      const updater = node.arguments[0];
      if (updater !== undefined && (ts.isArrowFunction(updater) || ts.isFunctionExpression(updater))) {
        const local = declaredNames(updater);
        const scan = (child: ts.Node): void => {
          if (ts.isPropertyAccessExpression(child) && ["currentTarget", "target"].includes(child.name.text) &&
              ts.isIdentifier(child.expression) && !local.has(child.expression.text)) {
            lines.push(file.getLineAndCharacterOfPosition(child.getStart(file)).line + 1);
          }
          ts.forEachChild(child, scan);
        };
        scan(updater);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return lines;
}

describe("RIFT-1062 state updaters never read the event", () => {
  it("detects multi-line updaters, ignores comments and reads made before the update", () => {
    const sample = [
      "const a = (event) => setDrafts(current => ({",
      "  ...current,",
      "  x: event.currentTarget.value,",
      "}));",
      "// setDrafts(current => ({ ...current, x: event.currentTarget.value }))",
      "const b = (event) => { const value = event.currentTarget.value; setDrafts(current => ({ ...current, x: value })); };",
      "const c = () => setRows(current => current.map(row => row.target));",
      "const d = (e) => setOpen(function (open) { return e.target === null ? open : !open; });"
    ].join("\n");
    expect(eventReadsInUpdaters("sample.tsx", sample)).toEqual([3, 8]);
  });

  it("finds no functional state update in desktop-client src that reads the event", () => {
    const root = new URL("../../src", import.meta.url).pathname;
    const offenders = sources(root).flatMap(path =>
      eventReadsInUpdaters(path, readFileSync(path, "utf8")).map(line => `${path.slice(root.length)}:${line}`));
    expect(offenders).toEqual([]);
  });
});
