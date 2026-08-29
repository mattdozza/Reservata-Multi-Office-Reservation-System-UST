const { spawn } = require("child_process");
const path = require("path");

const vitePath = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");
const children = [
  spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: "5179" },
    stdio: "inherit"
  }),
  spawn(process.execPath, [vitePath, "--host", "127.0.0.1", "--port", "5178"], {
    stdio: "inherit"
  })
];

let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill());
  setTimeout(() => process.exit(exitCode), 100);
}

children.forEach((child) => {
  child.on("exit", (code) => {
    if (!stopping && code) stop(code);
  });
});

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
