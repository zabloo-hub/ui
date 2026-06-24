import { resolve } from "node:path";
import { buildToFile } from "./build.js";

async function main() {
  const [cmd, file] = process.argv.slice(2);
  if (cmd !== "build" || !file) {
    console.error("uso: zabloo build <archivo.tsx>");
    process.exit(1);
  }
  const outPath = await buildToFile(resolve(process.cwd(), file));
  console.log(`IR escrita en ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
