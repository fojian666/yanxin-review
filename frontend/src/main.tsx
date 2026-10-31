import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./theme";
import "./styles.css";
import "./themes.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
