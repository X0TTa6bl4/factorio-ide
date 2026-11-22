import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".md": "text/plain" };

export function startServer({ host = "127.0.0.1", port = 0 } = {}) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const prefix = ["/factorio-ide/ui/", "/ui/"].find(value => url.pathname.startsWith(value));
    if (!prefix) { response.writeHead(404).end("Not found"); return; }
    let relative;
    try { relative = decodeURIComponent(url.pathname.slice(prefix.length)); }
    catch { response.writeHead(400).end("Invalid URL"); return; }
    if (!relative || relative.endsWith("/")) relative += "index.html";
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end("Forbidden"); return; }
    try {
      const content = await readFile(file);
      response.writeHead(200, { "Content-Type": `${types[path.extname(file)] ?? "application/octet-stream"}; charset=utf-8`, "Cache-Control": "no-store" });
      response.end(content);
    } catch { response.writeHead(404).end("Not found"); }
  });
  return new Promise(resolve => {
    server.listen(port, host, () => resolve(server));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startServer({ host: "0.0.0.0", port: Number(process.env.PORT ?? 4173) });
  console.log(`UI: http://localhost:${server.address().port}/factorio-ide/ui/`);
}
