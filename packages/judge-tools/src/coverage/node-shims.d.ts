declare interface CoverageProcess {
  readonly argv: readonly string[];
  cwd(): string;
  getBuiltinModule(name: string): unknown;
}

declare const process: CoverageProcess;
