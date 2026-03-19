import assert from "node:assert/strict";
import {
  parseRenderConcurrencyOverride,
  resolveRenderConcurrency,
} from "../src/renderer/render-concurrency.js";

function testExplicitOverrideWins() {
  assert.equal(resolveRenderConcurrency("source_direct", 6, 16), 6);
  assert.equal(resolveRenderConcurrency("cut_video", 4, 16), 4);
}

function testSourceDirectDefaultsToHigherCpuUsage() {
  assert.equal(resolveRenderConcurrency("source_direct", undefined, 4), 3);
  assert.equal(resolveRenderConcurrency("source_direct", undefined, 32), 30);
  assert.equal(resolveRenderConcurrency("cut_video", undefined, 16), 14);
}

function testParseOverride() {
  assert.equal(parseRenderConcurrencyOverride(undefined), undefined);
  assert.equal(parseRenderConcurrencyOverride("8"), 8);
  assert.throws(() => parseRenderConcurrencyOverride("0"));
  assert.throws(() => parseRenderConcurrencyOverride("abc"));
}

function main() {
  testExplicitOverrideWins();
  testSourceDirectDefaultsToHigherCpuUsage();
  testParseOverride();
  console.log("render concurrency: ok");
}

main();
