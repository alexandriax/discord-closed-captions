import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import packageJson from "../package.json" with { type: "json" };

const outputDirectory = resolve("dist");
const outputPath = resolve(
  outputDirectory,
  `discord-closed-captions-extension-v${packageJson.version}.zip`,
);

mkdirSync(outputDirectory, { recursive: true });
rmSync(outputPath, { force: true });

execFileSync("zip", ["-q", "-r", outputPath, "."], {
  cwd: resolve("extension"),
  stdio: "inherit",
});

console.log(outputPath);
