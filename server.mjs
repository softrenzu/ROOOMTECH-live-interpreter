import http from "node:http";
import { readFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 3000);

const allowedLanguages = new Set([
  "ja", "en", "ko", "zh", "es", "fr", "de", "it", "pt", "th", "vi", "id"
]);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

function commonHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "microphone=(self)",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    ...extra
  };
}

function json(res, status, body, extra = {}) {
  res.writeHead(status, commonHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extra
  }));
  res.end(JSON.stringify(body));
}

async function readJson(req, maxBytes = 16_384) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) throw new Error("request_too_large");
  }
  if (!body) return {};
  return JSON.parse(body);
}

function safetyIdentifier(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "anonymous")
    .split(",")[0]
    .trim();
  return crypto.createHash("sha256").update(`fast-interpreter:${ip}`).digest("hex");
}

async function createTranslationSecret(req, res) {
  if (!process.env.OPENAI_API_KEY) {
    return json(res, 500, {
      error: "OPENAI_API_KEY がサーバーに設定されていません。"
    });
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return json(res, 400, { error: "リクエスト形式が不正です。" });
  }

  const targetLanguage = String(body.targetLanguage || "en").toLowerCase();
  if (!allowedLanguages.has(targetLanguage)) {
    return json(res, 400, { error: "未対応の翻訳先言語です。" });
  }

  const upstream = await fetch(
    "https://api.openai.com/v1/realtime/translations/client_secrets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": safetyIdentifier(req)
      },
      body: JSON.stringify({
        session: {
          model: "gpt-realtime-translate",
          audio: {
            output: {
              language: targetLanguage
            }
          }
        }
      })
    }
  );

  const text = await upstream.text();
  res.writeHead(upstream.status, commonHeaders({
    "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  }));
  res.end(text);
}

function safePublicPath(urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  if (pathname === "/") pathname = "/index.html";
  const resolved = path.resolve(PUBLIC_DIR, `.${pathname}`);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep)) return null;
  return resolved;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && req.url === "/session") {
      return await createTranslationSecret(req, res);
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return json(res, 405, { error: "Method Not Allowed" }, { Allow: "GET, HEAD, POST" });
    }

    const filePath = safePublicPath(req.url || "/");
    if (!filePath || !existsSync(filePath)) {
      return json(res, 404, { error: "Not Found" });
    }

    const ext = path.extname(filePath).toLowerCase();
    const cache = ext === ".html" || ext === ".js" || ext === ".css"
      ? "no-cache"
      : "public, max-age=86400";

    res.writeHead(200, commonHeaders({
      "Content-Type": mime[ext] || "application/octet-stream",
      "Cache-Control": cache
    }));

    if (req.method === "HEAD") return res.end();
    createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: "Internal Server Error" });
  }
});

server.listen(PORT, () => {
  console.log(`Fast Interpreter: http://localhost:${PORT}`);
  console.log(process.env.OPENAI_API_KEY ? "OPENAI_API_KEY: configured" : "OPENAI_API_KEY: missing");
});
