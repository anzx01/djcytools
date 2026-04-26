import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest, loadDotEnv } from "./server/apiCore.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = __dirname;
const distDir = path.join(rootDir, "dist");
const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function applySecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const safePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
  const requestedPath = path.normalize(path.join(distDir, safePath || "index.html"));
  const targetPath = requestedPath.startsWith(distDir) ? requestedPath : path.join(distDir, "index.html");

  try {
    const fileStat = await stat(targetPath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    res.statusCode = 200;
    res.setHeader("Content-Type", mimeTypes[path.extname(targetPath)] || "application/octet-stream");
    if (path.basename(path.dirname(targetPath)) === "assets") {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      res.setHeader("Cache-Control", "no-cache");
    }
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(targetPath).pipe(res);
  } catch {
    const fallback = path.join(distDir, "index.html");
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(fallback).pipe(res);
  }
}

const env = await loadDotEnv(rootDir);

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);

  if (req.url?.startsWith("/api/")) {
    try {
      const handled = await handleApiRequest({ req, res, env, rootDir });
      if (!handled) sendJson(res, 404, { error: "API route not found" });
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        error: error instanceof Error ? error.message : "API request failed",
        code: error.code || "API_REQUEST_FAILED",
      });
    }
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  await serveStatic(req, res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`DJCYTools server running at http://127.0.0.1:${port}/`);
});
