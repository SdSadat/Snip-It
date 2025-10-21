import path from "path";
import { pathToFileURL } from "url";

const MODULE_NOT_FOUND = "ERR_MODULE_NOT_FOUND";
const UNSUPPORTED_DIR_IMPORT = "ERR_UNSUPPORTED_DIR_IMPORT";

const EXTENSIONS = ["", ".js", ".mjs", ".cjs", ".jsx", ".json"];
const INDEX_EXTENSIONS = [
  path.join("index.js"),
  path.join("index.mjs"),
  path.join("index.cjs"),
  path.join("index.jsx"),
  path.join("index.json"),
];

const isBareSpecifier = specifier =>
  !specifier.startsWith("./") &&
  !specifier.startsWith("../") &&
  !specifier.startsWith("/") &&
  !specifier.includes(":");

export async function resolve(specifier, context, defaultResolve) {
  try {
    return await defaultResolve(specifier, context, defaultResolve);
  } catch (error) {
    if (!shouldAttemptCustomResolution(error, specifier)) {
      throw error;
    }

    const root = process.env.CODE_BUTLER_WORKING_DIRECTORY;
    if (!root || !isBareSpecifier(specifier)) {
      throw error;
    }

    const resolved = await attemptResolveFromRoot(root, specifier, context, defaultResolve);
    if (resolved) {
      return resolved;
    }

    throw error;
  }
}

function shouldAttemptCustomResolution(error, specifier) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = /** @type {{ code?: string }} */ (error).code;
  if (code !== MODULE_NOT_FOUND && code !== UNSUPPORTED_DIR_IMPORT) {
    return false;
  }

  return typeof specifier === "string" && specifier.length > 0;
}

async function attemptResolveFromRoot(root, specifier, context, defaultResolve) {
  const absoluteBase = path.resolve(root, specifier);
  const candidates = buildCandidates(absoluteBase);

  for (const candidate of candidates) {
    try {
      return await defaultResolve(pathToFileURL(candidate).href, context, defaultResolve);
    } catch (error) {
      if (!shouldAttemptCustomResolution(error, specifier)) {
        throw error;
      }
    }
  }

  return undefined;
}

function buildCandidates(basePath) {
  const candidates = new Set();
  candidates.add(basePath);

  for (const extension of EXTENSIONS) {
    candidates.add(`${basePath}${extension}`);
  }

  for (const extension of INDEX_EXTENSIONS) {
    candidates.add(path.join(basePath, extension));
  }

  return candidates;
}
