import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { Kit } from "@/kit/Kit";
import "@/styles/globals.css";

/**
 * Two entry points, one bundle. `/kit` renders the UI kit (V17) — every chrome
 * component in every state, which is how the redesign gets reviewed against the
 * artboards without driving the real preview into each state by hand.
 *
 * A pathname check rather than a router: there are exactly two pages, and the
 * server that will host this in V18 already has to fall back to `index.html`.
 */
const root = document.getElementById("root");
if (!root) throw new Error("preview: #root is missing from index.html");

createRoot(root).render(
  <StrictMode>{window.location.pathname === "/kit" ? <Kit /> : <App />}</StrictMode>,
);
