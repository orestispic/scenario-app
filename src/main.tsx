import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./blocksApplication.css";
import { initializeRuntimeDeviceIdentity } from "./commercial/runtime";

async function start() {
  await initializeRuntimeDeviceIdentity();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void start();
