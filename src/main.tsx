import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import "./index.css";

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
void invoke("set_window_background", { dark: darkQuery.matches }).catch(
  () => {},
);
darkQuery.addEventListener("change", (e) => {
  void invoke("set_window_background", { dark: e.matches }).catch(() => {});
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

getCurrentWebviewWindow()
  .show()
  .catch(() => {});
