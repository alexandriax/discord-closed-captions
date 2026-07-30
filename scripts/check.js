import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["server", "extension", "scripts", "test"];
const files = roots.flatMap((root) => findJavaScript(root));

for (const file of files) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}

console.log(`Syntax checked ${files.length} JavaScript files.`);

function findJavaScript(path) {
  try {
    return readdirSync(path).flatMap((entry) => {
      const child = join(path, entry);
      return statSync(child).isDirectory()
        ? findJavaScript(child)
        : child.endsWith(".js")
          ? [child]
          : [];
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

