import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["server", "extension", "scripts", "test"];
const files = roots.flatMap((root) => findJavaScript(root));

for (const file of files) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}

const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
if (manifest.manifest_version !== 3) {
  throw new Error("extension/manifest.json must use Manifest V3");
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
if (manifest.version !== packageJson.version) {
  throw new Error("The extension and package versions must match");
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
