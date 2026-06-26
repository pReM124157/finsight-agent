import fs from "node:fs";
import path from "node:path";

const backendDir = process.cwd();
const pidPath = path.resolve(backendDir, "artifacts", "today-kalshi-paper-session.pid");

function readPid() {
  if (!fs.existsSync(pidPath)) {
    return null;
  }

  const raw = fs.readFileSync(pidPath, "utf8").trim();
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function removePidFile() {
  if (fs.existsSync(pidPath)) {
    fs.unlinkSync(pidPath);
  }
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

function main() {
  const pid = readPid();

  if (!pid) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          stopped: false,
          reason: "PID_FILE_NOT_FOUND",
        },
        null,
        2
      )
    );
    return;
  }

  const processState = getProcessState(pid);

  if (processState === "not_running" || processState === "missing") {
    removePidFile();
    console.log(
      JSON.stringify(
        {
          ok: true,
          stopped: false,
          reason: "PROCESS_NOT_RUNNING",
          pid,
          processState,
        },
        null,
        2
      )
    );
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          stopped: false,
          reason: "STOP_REQUIRES_ELEVATED_PERMISSIONS",
          pid,
          processState,
          error: error.message,
        },
        null,
        2
      )
    );
    return;
  }

  removePidFile();

  console.log(
    JSON.stringify(
      {
        ok: true,
        stopped: true,
        pid,
        processState,
        signal: "SIGTERM",
      },
      null,
      2
    )
  );
}

main();
