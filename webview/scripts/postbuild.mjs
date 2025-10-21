import { copyFile, mkdir } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";

const projectRoot = path.dirname(fileURLToPath(new URL("../", import.meta.url)));
const outputDir = path.resolve(projectRoot, "media/action-editor");
const sourceManifest = path.join(outputDir, ".vite", "manifest.json");
const targetManifest = path.join(outputDir, "manifest.json");

try {
  await mkdir(path.dirname(targetManifest), { recursive: true });
  await copyFile(sourceManifest, targetManifest);
  console.log("Copied manifest to", targetManifest);
} catch (error) {
  console.warn("Failed to copy manifest.json", error);
}
