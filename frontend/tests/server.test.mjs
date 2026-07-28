import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { test } from "node:test";

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  server.close();
  await once(server, "close");
  return port;
}

test("production server exposes health, runtime config, security headers, and SPA routes", async (context) => {
  const port = await availablePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      ATLAS_PUBLIC_ROOT: "dist",
      PORT: String(port),
      VITE_API_URL: "https://atlas.example/api/v1",
      VITE_KEYCLOAK_URL: "https://login.example",
      VITE_KEYCLOAK_REALM: "atlas",
      VITE_KEYCLOAK_CLIENT_ID: "atlas-web",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => child.kill("SIGTERM"));

  await Promise.race([
    once(child.stdout, "data"),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Server start timed out")), 5000),
    ),
  ]);

  const health = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(health.status, 200);
  assert.equal(await health.text(), "ok\n");

  const runtime = await fetch(`http://127.0.0.1:${port}/runtime-config.js`);
  assert.equal(runtime.status, 200);
  assert.match(await runtime.text(), /https:\/\/atlas\.example\/api\/v1/);
  assert.equal(runtime.headers.get("cache-control"), "no-store");

  const deepLink = await fetch(
    `http://127.0.0.1:${port}/datasets/ds_demo/versions/3`,
  );
  assert.equal(deepLink.status, 200);
  assert.match(await deepLink.text(), /<title>SoftBeat Atlas<\/title>/);
  assert.match(
    deepLink.headers.get("content-security-policy") ?? "",
    /object-src 'none'/,
  );
});
