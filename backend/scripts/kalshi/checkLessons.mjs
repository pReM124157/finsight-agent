import {
  regenerateLessonsMarkdown,
  lessonExtractorPaths,
} from "../../src/kalshi/learning/lessonExtractor.js";

const summary = regenerateLessonsMarkdown();

console.log("=== Kalshi Lessons Summary ===");
console.log(JSON.stringify({
  ...summary,
  lessonsJsonlPath: lessonExtractorPaths.LESSONS_JSONL,
  lessonsMarkdownPath: lessonExtractorPaths.LESSONS_MD,
}, null, 2));
