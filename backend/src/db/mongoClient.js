import mongoose from "mongoose";

let connectionPromise = null;

export function isMongoEnabled() {
  return process.env.MONGODB_ENABLED === "true";
}

export function getMongoConnectionState() {
  const states = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };

  return {
    enabled: isMongoEnabled(),
    state: mongoose.connection.readyState,
    stateLabel: states[mongoose.connection.readyState] || "unknown",
    dbName: mongoose.connection?.name || process.env.MONGODB_DB_NAME || null,
    host: mongoose.connection?.host || null,
  };
}

export async function connectMongo() {
  if (!isMongoEnabled()) {
    console.log("[mongo] disabled");
    return {
      ok: false,
      skipped: true,
      reason: "MONGODB_DISABLED",
      state: getMongoConnectionState(),
    };
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn("[mongo] MONGODB_URI missing; continuing without MongoDB");
    return {
      ok: false,
      skipped: true,
      reason: "MONGODB_URI_MISSING",
      state: getMongoConnectionState(),
    };
  }

  if (mongoose.connection.readyState === 1) {
    return {
      ok: true,
      alreadyConnected: true,
      state: getMongoConnectionState(),
    };
  }

  if (connectionPromise) {
    await connectionPromise;
    return {
      ok: mongoose.connection.readyState === 1,
      reusedPromise: true,
      state: getMongoConnectionState(),
    };
  }

  try {
    connectionPromise = mongoose.connect(uri, {
      dbName: process.env.MONGODB_DB_NAME || "probability_os",
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
    });

    await connectionPromise;
    console.log("[mongo] connected:", getMongoConnectionState());

    return {
      ok: true,
      state: getMongoConnectionState(),
    };
  } catch (error) {
    connectionPromise = null;
    console.warn("[mongo] connection failed:", error.message);
    if (
      String(error?.message || "").includes("querySrv") ||
      String(error?.message || "").includes("ECONNREFUSED")
    ) {
      console.warn("[mongo] Atlas cluster may be paused. Visit https://cloud.mongodb.com and resume it.");
    }
    return {
      ok: false,
      error: error.message,
      state: getMongoConnectionState(),
    };
  }
}

export async function disconnectMongo() {
  if (mongoose.connection.readyState === 0) {
    return {
      ok: true,
      alreadyDisconnected: true,
      state: getMongoConnectionState(),
    };
  }

  await mongoose.disconnect();
  connectionPromise = null;
  console.log("[mongo] disconnected");

  return {
    ok: true,
    state: getMongoConnectionState(),
  };
}
