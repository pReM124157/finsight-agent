import fs from "node:fs";
import path from "node:path";

const backendDir = process.cwd();
const artifactsDir = path.resolve(backendDir, "artifacts");
const pidPath = path.join(artifactsDir, "backend-api-5001.pid");
const logPath = path.join(artifactsDir, "backend-api-5001.log");
const statusPath = path.resolve(backendDir, "..", "artifacts", "today-kalshi-paper-session-status.json");

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

function readJson(pathname) {
  if (!fs.existsSync(pathname)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(pathname, "utf8"));
  } catch (error) {
    return {
      parseError: error.message,
    };
  }
}

const pid = readPid();
const processState = getProcessState(pid);
const status = readJson(statusPath);

console.log(
  JSON.stringify(
    {
      ok: true,
      pid,
      isRunning:
        processState === "running" || processState === "running_permission_denied",
      processState,
      pidPath,
      logPath,
      statusPath,
      status,
    },
    null,
    2
  )
);
