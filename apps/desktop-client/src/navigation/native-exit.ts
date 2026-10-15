/** Public Tauri global API; the browser preview simply returns to its home page. */
export async function exitDesktopClient(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const desktopWindow = window as Window & {
    __TAURI__?: { core: { invoke: (command: string) => Promise<unknown> } };
  };
  if (!desktopWindow.__TAURI__) return false;
  await desktopWindow.__TAURI__.core.invoke("exit_client");
  return true;
}
