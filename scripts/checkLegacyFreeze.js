#!/usr/bin/env node

/**
 * Lightweight migration guard:
 * fail when new files are added under frozen legacy folders.
 *
 * This compares the current filesystem against a committed baseline file.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const BASELINE_PATH = path.join(ROOT, "scripts", "legacy-freeze-baseline.json");
const LEGACY_PREFIXES = [
  "src/contexts/",
  "src/hooks/",
  "src/utils/",
  "src/components/",
];

function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full));
      continue;
    }
    out.push(path.relative(ROOT, full).replaceAll(path.sep, "/"));
  }
  return out;
}

if (!fs.existsSync(BASELINE_PATH)) {
  console.error(`Missing baseline file: ${BASELINE_PATH}`);
  console.error("Create it before running the legacy freeze check.");
  process.exit(1);
}

const baselineRaw = fs.readFileSync(BASELINE_PATH, "utf8");
const baseline = JSON.parse(baselineRaw);
const allowed = new Set(Array.isArray(baseline.legacyFiles) ? baseline.legacyFiles : []);

const currentLegacyFiles = new Set(
  LEGACY_PREFIXES.flatMap((prefix) => listFilesRecursive(path.join(ROOT, prefix)))
);

const violations = [...currentLegacyFiles]
  .filter((file) => !allowed.has(file))
  .sort();

if (violations.length > 0) {
  console.error("Legacy freeze violation: new files detected in frozen folders:");
  for (const file of violations) {
    console.error(`- ${file}`);
  }
  console.error("Move these files to src/features/* or src/shared/*.");
  console.error("If intentional, update scripts/legacy-freeze-baseline.json in the same PR.");
  process.exit(1);
}

console.log("Legacy freeze check passed.");
