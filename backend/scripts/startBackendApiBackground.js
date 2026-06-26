import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const backendDir = process.cwd();
const artifactsDir = path.resolve(backendDir, "artifacts");
const pidPath = path.join(artifactsDir, "backend-api-5001.pid");
const logPath = path.join(artifactsDir, "backend-api-5001.log");

function ensureArtifactsDir() {
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }
}

function readPid() {
  if (!fs.existsSync(pidPath)) {
    return null;
  }

  const raw = fs.readFileSync(pidPath, "utf8").trim();
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function getProcessState(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return "missing";
  }

  try {
    process.kill(pid, 0);
    return "running";
  } catch (error) {
    if (error?.code === "EPERM") {
      return "running_permission_denied";
    }

    return "not_running";
  }
}

function removeStalePidFile() {
  if (fs.existsSync(pidPath)) {
    fs.unlinkSync(pidPath);
  }
}

function main() {
  ensureArtifactsDir();

  const existingPid = readPid();
  const existingState = getProcessState(existingPid);

  if (existingState === "running" || existingState === "running_permission_denied") {
    console.log(
      JSON.stringify(
        {
          ok: true,
          started: false,
          reason: "ALREADY_RUNNING",
          pid: existingPid,
          processState: existingState,
          pidPath,
          logPath,
        },
        null,
        2
      )
    );
    return;
  }

  if (existingPid) {
    removeStalePidFile();
  }

  const out = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: process.env.PORT || "5001",
    },
    detached: true,
    stdio: ["ignore", out, out],
  });

  child.unref();
  fs.writeFileSync(pidPath, `${child.pid}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        started: true,
        pid: child.pid,
        pidPath,
        logPath,
        port: process.env.PORT || "5001",
      },
      null,
      2
    )
  );
}

main();
