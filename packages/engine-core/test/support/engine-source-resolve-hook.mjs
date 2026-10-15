// Node ESM resolve hook mirroring the `engine-core-source-prefers-typescript`
// plugin in apps/game-server/vitest.config.ts.
//
// A relative `./x.js` specifier issued from a .ts file under
// packages/engine-core/src resolves to the sibling `x.ts` when that file
// exists. Everything else (dist/, node_modules, bare specifiers, node: URLs)
// falls through to Node's default resolution unchanged.
//
// The compiled `src/**/*.js` artifacts this used to shadow are gone; without
// this hook Node would try to read a `.js` file that no longer exists.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Ends with a path separator, so `startsWith` cannot match a sibling directory.
const ENGINE_SOURCE_DIR = fileURLToPath(new URL('../../src/', import.meta.url));

export async function resolve(specifier, context, nextResolve) {
  const parentURL = context.parentURL;
  if (typeof parentURL !== 'string' || !parentURL.startsWith('file:')) {
    return nextResolve(specifier, context);
  }
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return nextResolve(specifier, context);
  }
  if (!specifier.endsWith('.js')) {
    return nextResolve(specifier, context);
  }

  const importerPath = fileURLToPath(parentURL);
  if (!importerPath.endsWith('.ts') || !importerPath.startsWith(ENGINE_SOURCE_DIR)) {
    return nextResolve(specifier, context);
  }

  const candidate = path.resolve(path.dirname(importerPath), `${specifier.slice(0, -3)}.ts`);
  if (!candidate.startsWith(ENGINE_SOURCE_DIR) || !existsSync(candidate)) {
    return nextResolve(specifier, context);
  }

  return nextResolve(pathToFileURL(candidate).href, context);
}
