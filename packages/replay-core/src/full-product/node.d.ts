declare module "node:crypto" {
  export function createHash(algorithm: string): {
    update(data: string | Buffer): { digest(encoding: "hex"): string };
  };
  export function randomUUID(): string;
}

declare module "node:fs/promises" {
  export interface FileHandle {
    read(
      buffer: Buffer,
      offset: number,
      length: number,
      position: number
    ): Promise<{ bytesRead: number }>;
    write(buffer: Buffer, offset?: number): Promise<{ bytesWritten: number }>;
    sync(): Promise<void>;
    datasync(): Promise<void>;
    truncate(length: number): Promise<void>;
    close(): Promise<void>;
  }

  export function open(path: string | URL, flags: string): Promise<FileHandle>;
  export function mkdir(
    path: string,
    options?: { recursive?: boolean }
  ): Promise<string | undefined>;
  export function rename(from: string, to: string): Promise<void>;
  export function rm(path: string, options?: { force?: boolean }): Promise<void>;
  export function stat(path: string | URL): Promise<{ isFile(): boolean; size: number }>;
  export function truncate(path: string | URL, length: number): Promise<void>;
  export function appendFile(path: string | URL, data: string): Promise<void>;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
  export function resolve(path: string): string;
}

interface Buffer {
  readonly length: number;
  subarray(start?: number, end?: number): Buffer;
  toString(encoding: "utf8"): string;
  indexOf(byte: number): number;
}

interface BufferConstructor {
  new (size: number): Buffer;
  alloc(size: number): Buffer;
  from(value: string, encoding: "utf8"): Buffer;
  concat(parts: readonly Buffer[]): Buffer;
}

declare const Buffer: BufferConstructor;

declare namespace NodeJS {
  interface ErrnoException extends Error {
    code?: string;
  }
}
