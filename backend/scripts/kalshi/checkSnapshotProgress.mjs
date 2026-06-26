import {
  getValidSnapshots,
  getFeatureSnapshotProgress,
  getFeatureSnapshots,
} from "../../src/kalshi/data/featureSnapshotStore.js";
import { CURRENT_FEATURE_PIPELINE_VERSION } from "../../src/kalshi/data/featureSnapshot.js";

console.log("=== Kalshi Feature Snapshot Progress ===");
console.log(JSON.stringify(getFeatureSnapshotProgress(CURRENT_FEATURE_PIPELINE_VERSION), null, 2));

console.log("\n[LATEST FEATURE SNAPSHOTS]");
console.log(JSON.stringify(getFeatureSnapshots({ limit: 5 }), null, 2));

console.log("\n[LATEST VALID FEATURE SNAPSHOTS]");
console.log(JSON.stringify(
  getValidSnapshots(CURRENT_FEATURE_PIPELINE_VERSION, { limit: 5 }),
  null,
  2
));
