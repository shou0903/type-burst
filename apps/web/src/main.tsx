import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SmallScreenGuard } from "./components/SmallScreenGuard";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root が見つかりません");

createRoot(container).render(
  <React.StrictMode>
    <SmallScreenGuard>
      <App />
    </SmallScreenGuard>
  </React.StrictMode>,
);
