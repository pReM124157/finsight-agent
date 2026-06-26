import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const backendDir = process.cwd();
const artifactsDir = path.resolve(backendDir, "artifacts");
const pidPath = path.join(artifactsDir, "today-kalshi-paper-session.pid");
const logPath = path.join(artifactsDir, "today-kalshi-paper-session.log");
const statusPath = path.resolve(backendDir, "..", "artifacts", "today-kalshi-paper-session-status.json");

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

function printJson(pathname) {
  if (!fs.existsSync(pathname)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(pathname, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  ensureArtifactsDir();

  const existingPid = readPid();
  const existingState = getProcessState(existingPid);

  if (existingState === "running" || existingState === "running_permission_denied") {
    const currentStatus = printJson(statusPath);
    console.log(
      JSON.stringify(
        {
          ok: true,
          started: false,
          reason: "ALREADY_RUNNING",
          pid: existingPid,
          processState: existingState,
          logPath,
          statusPath,
          stage: currentStatus?.stage || null,
          updatedAt: currentStatus?.updatedAt || null,
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
  const child = spawn(process.execPath, ["scripts/startTodayKalshiPaperSession.js"], {
    cwd: backendDir,
    env: process.env,
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
        statusPath,
      },
      null,
      2
    )
  );
}

main();
