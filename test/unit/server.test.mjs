import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before } from "node:test";
import { startServer } from "../../dev/server.mjs";

let server;
let port;

function request(urlPath, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        location: response.headers.location ?? "",
        type: response.headers["content-type"] ?? "",
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

before(async () => {
  server = await startServer();
  const address = server.address();
  assert.equal(address.address, "127.0.0.1");
  port = address.port;
});

after(() => new Promise((resolve) => server.close(resolve)));

test("по умолчанию слушает localhost и отдаёт smoke-модуль", async () => {
  const script = await request("/dev/smoke/app.js");
  assert.equal(script.status, 200);
  assert.match(script.type, /javascript/);
  assert.match(script.body, /smokeValue/);

  const css = await request("/dev/smoke/app.css");
  assert.equal(css.status, 200);
  assert.match(css.type, /css/);

  const redirect = await request("/dev/smoke");
  assert.equal(redirect.status, 308);
  assert.equal(redirect.location, "/dev/smoke/");

  const page = await request("/dev/smoke/");
  assert.equal(page.status, 200);
  assert.match(page.type, /html/);
  assert.match(page.body, /type="module"/);
});

test("не отдаёт файлы вне корня и неизвестные пути", async () => {
  assert.equal((await request("/%2e%2e/etc/passwd")).status, 403);
  assert.equal((await request("/dev/smoke/missing.js")).status, 404);
  assert.equal((await request("/dev/smoke/", "POST")).status, 405);
});

test("префикс GitHub Pages отдаёт те же файлы и не принимает POST", async () => {
  const script = await request("/factorio-ide/dev/smoke/app.js");
  assert.equal(script.status, 200);
  assert.match(script.body, /smokeValue/);
  const redirect = await request("/factorio-ide/dev/smoke");
  assert.equal(redirect.status, 308);
  assert.equal(redirect.location, "/factorio-ide/dev/smoke/");
  assert.equal((await request("/factorio-ide/%2e%2e/etc/passwd")).status, 403);
  const posted = await request("/factorio-ide/pages/event/", "POST");
  assert.equal(posted.status, 405);
  assert.equal(posted.body, "Method Not Allowed");
});

test("явный host 0.0.0.0 нужен только для проброса порта", async () => {
  const opened = await startServer({ host: "0.0.0.0", port: 0 });
  try {
    assert.equal(opened.address().address, "0.0.0.0");
  } finally {
    await new Promise((resolve) => opened.close(resolve));
  }
});
