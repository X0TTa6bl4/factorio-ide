import http from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_PREFIX = "/factorio-ide";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function contentType(file) {
  return types[path.extname(file)] ?? "application/octet-stream";
}

export async function locate(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { status: 400, body: "Invalid URL" };
  }
  if (decoded.includes("\0")) return { status: 400, body: "Invalid URL" };
  if (decoded.split("/").some((part) => part === "." || part === "..")) {
    return { status: 403, body: "Forbidden" };
  }

  let lexical = path.resolve(root, `.${decoded}`);
  if (lexical !== root && !lexical.startsWith(`${root}${path.sep}`)) {
    return { status: 403, body: "Forbidden" };
  }

  let info;
  try {
    info = await stat(lexical);
  } catch (error) {
    if (error.code === "ENOENT") return { status: 404, body: "Not found" };
    throw error;
  }

  if (info.isDirectory()) {
    if (!pathname.endsWith("/")) return { status: 308, location: `${pathname}/` };
    lexical = path.join(lexical, "index.html");
    try {
      info = await stat(lexical);
    } catch (error) {
      if (error.code === "ENOENT") return { status: 404, body: "Not found" };
      throw error;
    }
  }

  const realRoot = await realpath(root);
  let realFile;
  try {
    realFile = await realpath(lexical);
  } catch (error) {
    if (error.code === "ENOENT") return { status: 404, body: "Not found" };
    throw error;
  }
  if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${path.sep}`)) {
    return { status: 403, body: "Forbidden" };
  }

  return { status: 200, file: realFile, body: await readFile(realFile) };
}

export function startServer({ host = "127.0.0.1", port = 0, root = defaultRoot } = {}) {
  const rootPath = path.resolve(root);
  const server = http.createServer(async (request, response) => {
    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end("Method Not Allowed");
      return;
    }
    try {
      const pathname = (request.url ?? "/").split(/[?#]/, 1)[0];
      const prefixed = pathname === SITE_PREFIX || pathname.startsWith(`${SITE_PREFIX}/`);
      const local = prefixed ? (pathname.slice(SITE_PREFIX.length) || "/") : pathname;
      const located = await locate(rootPath, local);
      if (located.status === 308) {
        const target = `${prefixed ? SITE_PREFIX : ""}${located.location}`;
        response.writeHead(308, { Location: target }).end();
        return;
      }
      if (located.status !== 200) {
        response.writeHead(located.status).end(located.body);
        return;
      }
      response.writeHead(200, {
        "Content-Type": contentType(located.file),
        "Cache-Control": "no-store",
      });
      if (method === "HEAD") response.end();
      else response.end(located.body);
    } catch {
      if (!response.headersSent) response.writeHead(500).end("Error");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? 4173);
  const server = await startServer({ host, port });
  const address = server.address();
  console.log(`dev-server bind ${address.address}:${address.port}`);
}
