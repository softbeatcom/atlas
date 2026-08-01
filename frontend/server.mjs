import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const root = resolve(process.env.ATLAS_PUBLIC_ROOT ?? "/app/public");
const port = Number(process.env.PORT ?? 8080);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' http: https:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function send(response, status, body, headers = {}) {
  response.writeHead(status, { ...securityHeaders, ...headers });
  response.end(body);
}

function runtimeConfig() {
  const config = {
    VITE_API_URL: process.env.VITE_API_URL,
    VITE_KEYCLOAK_URL: process.env.VITE_KEYCLOAK_URL,
    VITE_KEYCLOAK_REALM: process.env.VITE_KEYCLOAK_REALM,
    VITE_KEYCLOAK_CLIENT_ID: process.env.VITE_KEYCLOAK_CLIENT_ID,
    VITE_THEME_PRIMARY_COLOR: process.env.VITE_THEME_PRIMARY_COLOR,
    VITE_THEME_PRIMARY_HOVER_COLOR: process.env.VITE_THEME_PRIMARY_HOVER_COLOR,
    VITE_THEME_SIDEBAR_COLOR: process.env.VITE_THEME_SIDEBAR_COLOR,
    VITE_THEME_SURFACE_COLOR: process.env.VITE_THEME_SURFACE_COLOR,
    VITE_THEME_ACCENT_COLOR: process.env.VITE_THEME_ACCENT_COLOR,
  };
  return `window.__ATLAS_CONFIG__ = Object.freeze(${JSON.stringify(config)});\n`;
}

async function fileFor(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.some((segment) => segment.startsWith("."))) return null;
  const requested = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (requested !== root && !requested.startsWith(`${root}${sep}`)) return null;
  try {
    const details = await stat(requested);
    if (details.isFile()) return { path: requested, details };
  } catch {
    // Client-side routes fall through to the SPA entry point.
  }
  if (extname(pathname)) return null;
  const index = resolve(root, "index.html");
  return { path: index, details: await stat(index) };
}

const server = createServer(async (request, response) => {
  try {
    const method = request.method ?? "GET";
    if (!["GET", "HEAD"].includes(method)) {
      send(response, 405, "Method Not Allowed\n", { Allow: "GET, HEAD" });
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://atlas").pathname;
    if (pathname === "/healthz") {
      send(response, 200, method === "HEAD" ? "" : "ok\n", {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      });
      return;
    }
    if (pathname === "/runtime-config.js") {
      const body = runtimeConfig();
      send(response, 200, method === "HEAD" ? "" : body, {
        "Cache-Control": "no-store",
        "Content-Length": Buffer.byteLength(body),
        "Content-Type": "text/javascript; charset=utf-8",
      });
      return;
    }

    const file = await fileFor(pathname);
    if (!file) {
      send(response, 404, "Not Found\n", {
        "Content-Type": "text/plain; charset=utf-8",
      });
      return;
    }
    const extension = extname(file.path);
    const immutable = pathname.startsWith("/assets/");
    response.writeHead(200, {
      ...securityHeaders,
      "Cache-Control": immutable
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "Content-Length": file.details.size,
      "Content-Type": contentTypes[extension] ?? "application/octet-stream",
    });
    if (method === "HEAD") {
      response.end();
    } else {
      createReadStream(file.path).pipe(response);
    }
  } catch (error) {
    console.error(error);
    send(response, 500, "Internal Server Error\n", {
      "Content-Type": "text/plain; charset=utf-8",
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`SoftBeat Atlas frontend listening on ${port}`);
});

server.on("error", (error) => {
  console.error("SoftBeat Atlas frontend failed to start", error);
  process.exit(1);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
