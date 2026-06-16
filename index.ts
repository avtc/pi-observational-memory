// Package entry point for pi (keeps the startup display name clean).
// Re-exports the real factory + named exports from src/.
export { default } from "./src/index.js";
export * from "./src/index.js";
