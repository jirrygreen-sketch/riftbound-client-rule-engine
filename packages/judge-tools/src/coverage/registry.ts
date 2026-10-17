import type { LoadedRegistry, RegistryEntryMetadata, RegistryProgramInput } from "./types.js";

interface BuiltinFsPromises {
  readonly readFile: (path: string | URL, encoding: "utf8") => Promise<string>;
}

const registryImportPattern = /import entry(\d+) from ["']\.\/([^/'"]+)\//g;

function fsPromises(): BuiltinFsPromises {
  return process.getBuiltinModule("node:fs/promises") as BuiltinFsPromises;
}

function parseSetByIndex(source: string): ReadonlyMap<number, string> {
  const sets = new Map<number, string>();
  for (const match of source.matchAll(registryImportPattern)) {
    const index = Number(match[1]);
    const set = match[2];
    if (Number.isInteger(index) && typeof set === "string" && set.length > 0) sets.set(index, set);
  }
  return sets;
}

function readMetadata(entry: Record<string, unknown>, fallback?: RegistryEntryMetadata): RegistryEntryMetadata {
  const nested = typeof entry.card === "object" && entry.card !== null ? entry.card as Record<string, unknown> : undefined;
  const set = entry.set ?? entry.cardSet ?? nested?.set ?? fallback?.set;
  const cardType = entry.cardType ?? entry.type ?? nested?.cardType ?? nested?.type ?? fallback?.cardType;
  return {
    ...(typeof set === "string" && set.length > 0 ? { set } : {}),
    ...(typeof cardType === "string" && cardType.length > 0 ? { cardType } : {})
  };
}

export async function loadGeneratedCardRegistry(
  registryUrl = new URL("../../../card-dsl/dist/cards/registry.generated.js", import.meta.url)
): Promise<LoadedRegistry> {
  const module = await import(registryUrl.href) as { readonly registry?: readonly unknown[] };
  if (!Array.isArray(module.registry)) throw new Error(`Generated card registry has no registry array: ${registryUrl.href}`);
  const source = await fsPromises().readFile(registryUrl, "utf8");
  const setByIndex = parseSetByIndex(source);
  const programs: RegistryProgramInput[] = [];
  for (const [index, value] of module.registry.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Generated card registry entry ${index} is not an object.`);
    }
    const entry = value as Record<string, unknown>;
    const metadata = readMetadata(entry, { set: setByIndex.get(index) });
    programs.push({
      ...entry,
      canonicalCardId: entry.canonicalCardId as string,
      status: entry.status as RegistryProgramInput["status"],
      ...(metadata.set === undefined ? {} : { set: metadata.set }),
      ...(metadata.cardType === undefined ? {} : { cardType: metadata.cardType })
    });
  }
  return { programs, source: registryUrl.href };
}
