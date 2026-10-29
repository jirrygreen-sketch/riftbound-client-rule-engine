import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installClientLogCapture } from "./diagnostics/client-log";
import "./styles.css";

if (typeof window !== "undefined") {
  try {
    installClientLogCapture(window, window.localStorage);
  } catch {
    // Local diagnostics must never prevent the client from starting.
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
