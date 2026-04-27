import fs from "fs";
import path from "path";

const filePath = path.resolve("data/recommendationHistory.json");

/**
 * Save recommendation into history
 */
export const saveRecommendation = async (data) => {
  try {
    let existing = [];

    // Check if file exists
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      existing = raw ? JSON.parse(raw) : [];
    }

    // Add new recommendation
    existing.push({
      ...data,
      entryPrice: data.entryPrice || null,
      isValidated: false,
      performanceScore: null,
      createdAt: new Date().toISOString()
    });

    // Save updated history
    fs.writeFileSync(
      filePath,
      JSON.stringify(existing, null, 2),
      "utf-8"
    );

    console.log("✅ Recommendation saved to history");
  } catch (error) {
    console.error("❌ History Save Error:", error.message);
  }
};

/**
 * Fetch recommendation history
 */
export const getRecommendationHistory = async () => {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error("❌ History Read Error:", error.message);
    return [];
  }
};