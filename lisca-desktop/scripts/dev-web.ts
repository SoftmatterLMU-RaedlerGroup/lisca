#!/usr/bin/env bun
import net from "node:net";

const PORT = Number(process.env.LISCA_DEV_PORT ?? "5173");

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", (error) => {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "EADDRINUSE") {
        resolve(false);
        return;
      }

      console.error(`Could not check port ${port}: ${error.message}`);
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port, "127.0.0.1");
  });
}

if (!(await isPortFree(PORT))) {
  console.error(`Port ${PORT} is already in use. Free this port or set LISCA_DEV_PORT and rerun.`);
  process.exit(1);
}

const proc = Bun.spawn({
  cmd: ["bun", "x", "vite", "--port", `${PORT}`, "--strictPort"],
  stdout: "inherit",
  stderr: "inherit",
});

const exitCode = await proc.exited;
if (typeof exitCode === "number") {
  process.exit(exitCode);
}

process.exit(1);