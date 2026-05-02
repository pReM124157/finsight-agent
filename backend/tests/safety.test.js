import {
  safeString,
  safeSubstring,
  extractSymbol,
  shouldAnalyze,
  safeObject
} from "../src/core/safety.js";

function assert(name, condition) {
  if (!condition) {
    console.error("❌ FAIL:", name);
    process.exit(1);
  } else {
    console.log("✅", name);
  }
}

// safeString
assert("safeString null", safeString(null) === "");
assert("safeString valid", safeString("abc") === "abc");

// safeSubstring
assert("safeSubstring null", safeSubstring(null) === "");
assert("safeSubstring cut", safeSubstring("abcdef", 3) === "abc");

// extractSymbol
assert("extractSymbol analyze", extractSymbol("ANALYZE TCS") === "TCS");
assert("extractSymbol slash", extractSymbol("/analyze reliance") === "RELIANCE");
assert("extractSymbol uppercase", extractSymbol("tcs") === "TCS");
assert("extractSymbol spaces", extractSymbol("   tcs   ") === "TCS");
assert("extractSymbol mixed", extractSymbol("Analyze   reliance") === "RELIANCE");
assert("extractSymbol invalid", extractSymbol("hi") === null);

// shouldAnalyze
assert("shouldAnalyze valid", shouldAnalyze("TCS") === true);
assert("shouldAnalyze ignore", shouldAnalyze("HI") === false);

// safeObject
assert("safeObject null", typeof safeObject(null) === "object");

console.log("🔥 All safety tests passed");
