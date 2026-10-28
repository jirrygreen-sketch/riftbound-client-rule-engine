/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional build-time override of the default game-server address. */
  readonly VITE_RIFTBOUND_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
