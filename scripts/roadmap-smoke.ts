import assert from "node:assert/strict";
import path from "path";
import {
  isDirectoryPrefix,
  isSafeProjectDirectoryId,
  resolvePathInsideDirectory,
} from "../src/lib/storage/path-utils";
import { normalizeMemorySubdir } from "../src/lib/memory/memory-subdir";

const base = path.resolve("/workspace/data/projects/proj-a");

assert.equal(isSafeProjectDirectoryId("My-Project-1"), true);
assert.equal(isSafeProjectDirectoryId("my-project-1"), true);
assert.equal(isSafeProjectDirectoryId("../evil"), false);
assert.equal(isSafeProjectDirectoryId("none"), false);

assert.equal(resolvePathInsideDirectory(base, ".."), null);
assert.equal(resolvePathInsideDirectory(base, "../proj-b"), null);
assert.equal(
  resolvePathInsideDirectory(base, "src"),
  path.join(base, "src")
);
const absAttempt = resolvePathInsideDirectory(base, "/etc/passwd");
assert.equal(absAttempt, null);

assert.equal(isDirectoryPrefix(path.join(base, "x"), base), true);
assert.equal(isDirectoryPrefix(path.join(base, "../proj-b"), base), false);

assert.equal(normalizeMemorySubdir("main"), "main");
assert.equal(normalizeMemorySubdir("../other"), null);
assert.equal(normalizeMemorySubdir("a".repeat(200)), null);

console.log("roadmap-smoke: ok");
