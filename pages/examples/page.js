/** Страница примеров: относительные ссылки и диагностика отсутствующего ресурса. */

import { EVENT_DEMO, mountAbout } from "../release.js";

const body = document.querySelector("#demo-rows");
const status = document.querySelector("#demo-status");
const detail = document.querySelector("#demo-detail");

mountAbout();

function cell(text) {
  const item = document.createElement("td");
  item.textContent = text;
  return item;
}

function linkCell(href, label) {
  const item = document.createElement("td");
  const link = document.createElement("a");
  link.href = href;
  link.textContent = label;
  item.append(link);
  return item;
}

function addRow(title, kinds, expect, href) {
  const row = document.createElement("tr");
  row.append(cell(title), cell(kinds), cell(expect), linkCell(href, "Открыть"));
  body.append(row);
}

async function loadDemos() {
  try {
    const { SCHEME_IDS, schemeMeta } = await import("../debugger/schemes.js");
    body.replaceChildren();
    for (const id of SCHEME_IDS) {
      const meta = schemeMeta(id);
      addRow(meta.title, meta.kinds, meta.expect, `../debugger/index.html?scheme=${id}`);
    }
    addRow(
      EVENT_DEMO.title,
      EVENT_DEMO.kinds,
      EVENT_DEMO.expect,
      "../event/index.html",
    );
    status.textContent = "Готово";
    status.dataset.state = "ready";
    detail.textContent = "Модули примеров загружены. Ожидаемые границы тиков записаны в таблице.";
  } catch (error) {
    status.textContent = "Ошибка";
    status.dataset.state = "failed";
    detail.textContent = `Не удалось загрузить модули: ${error instanceof Error ? error.message : String(error)}`;
  }
}

loadDemos();

document.querySelector("#probe-missing").addEventListener("click", async () => {
  const diagnostic = document.querySelector("#missing-diagnostic");
  const url = new URL("./absent.js", document.baseURI);
  diagnostic.textContent = "Запрос отправлен.";
  try {
    const response = await fetch(url);
    const payload = (await response.text()).trim();
    diagnostic.textContent = response.ok
      ? `Ресурс ${url.pathname} неожиданно доступен.`
      : `Ресурс не найден: ${response.status} ${url.pathname}. ${payload || "Нет тела ответа"}. Это отсутствие файла, а не совместимость с Factorio.`;
  } catch (error) {
    diagnostic.textContent = `Не удалось запросить ресурс: ${error instanceof Error ? error.message : String(error)}`;
  }
});
