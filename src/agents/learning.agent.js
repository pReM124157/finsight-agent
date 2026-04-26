import supabase from "../services/supabase.service.js";

export async function runLearningAgent({
  stock,
  action,
  confidence,
  riskLevel,
  sector = "Unknown"
}) {
  try {
    const { error } = await supabase
      .from("learning_memory")
      .insert([
        {
          stock,
          action,
          confidence,
          risk_level: riskLevel,
          sector,
          created_at: new Date().toISOString()
        }
      ]);

    if (error) {
      console.error("Learning Agent Error:", error.message);
      return 0;
    }

    console.log("🧠 Learning memory stored");

    const { data, error: fetchError } = await supabase
      .from("learning_memory")
      .select("*")
      .eq("action", action);

    if (fetchError || !data) return 0;

    const total = data.length;

    const successful = data.filter(
      item => item.outcome === "success"
    ).length;

    if (total === 0) return 0;

    const performanceBoost = Math.round(
      (successful / total) * 2
    );

    return performanceBoost;

  } catch (err) {
    console.error(err.message);
    return 0;
  }
}