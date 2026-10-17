import { loadGeneratedCardRegistry } from "./registry.js";
import { buildCoverageReport, renderCoverageMarkdown } from "./report.js";

interface BuiltinFsPromises {
  readonly mkdir: (path: string | URL, options: { readonly recursive: true }) => Promise<void>;
  readonly writeFile: (path: string | URL, data: string, encoding: "utf8") => Promise<void>;
}

function fsPromises(): BuiltinFsPromises {
  return process.getBuiltinModule("node:fs/promises") as BuiltinFsPromises;
}

const outputDirectory = new URL("../../../../docs/coverage/", import.meta.url);
const report = buildCoverageReport(
  (await loadGeneratedCardRegistry()).programs,
  "packages/card-dsl/dist/cards/registry.generated.js"
);
await fsPromises().mkdir(outputDirectory, { recursive: true });
await fsPromises().writeFile(new URL("report.json", outputDirectory), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fsPromises().writeFile(new URL("report.md", outputDirectory), renderCoverageMarkdown(report), "utf8");
console.log(`coverage: ${report.summary.counts.executable}/${report.summary.totalCanonical} executable (${report.summary.coveragePercent}%)`);
console.log(`coverage: wrote ${new URL("report.md", outputDirectory).pathname}`);
console.log(`coverage: wrote ${new URL("report.json", outputDirectory).pathname}`);
