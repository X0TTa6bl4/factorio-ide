/** Публичное руководство: дерево и статьи из реестра, поведение — из библиотеки. */

import { mountDocumentation } from "../../ui/scripts/docs.js";
import { DOC_GROUPS, DOC_HOME, DOC_SAMPLES, docArticles } from "./content.js";

const articles = docArticles();
const bySlug = new Map(articles.map((article) => [article.slug, article]));

function sectionIds(article) {
  return article.sections.map((section) => section.id);
}

function knownTarget(target) {
  if (bySlug.has(target)) return true;
  return articles.some((article) => sectionIds(article).includes(target) || `${article.slug}-also` === target);
}

function link(item) {
  const node = document.createElement("a");
  if (item.href) {
    node.href = item.href;
    node.textContent = item.label;
    return node;
  }
  node.href = `#${item.target}`;
  node.dataset.docTarget = item.target;
  node.textContent = item.label;
  return node;
}

function addHtml(parent, html) {
  const holder = document.createElement("template");
  holder.innerHTML = html.trim();
  parent.append(holder.content);
}

function figure(block) {
  const sample = DOC_SAMPLES[block.sample];
  const box = document.createElement("figure");
  box.className = "fl-docs__code";
  box.dataset.docCode = "";
  const caption = document.createElement("figcaption");
  const name = document.createElement("span");
  name.textContent = block.caption;
  const button = document.createElement("button");
  button.className = "fl-button";
  button.type = "button";
  button.dataset.docCopy = "";
  button.textContent = "Копировать";
  caption.append(name, button);
  const pre = document.createElement("pre");
  pre.tabIndex = 0;
  pre.setAttribute("aria-label", block.label);
  const code = document.createElement("code");
  code.textContent = sample.text;
  pre.append(code);
  const status = document.createElement("p");
  status.className = "fl-docs__copy-status";
  status.role = "status";
  status.ariaLive = "polite";
  status.dataset.docCopyStatus = "";
  box.append(caption, pre, status);
  return box;
}

function renderBlock(parent, block) {
  if (block.html) {
    addHtml(parent, block.html);
    return;
  }
  if (block.steps) {
    const list = document.createElement("ol");
    list.className = "fl-docs__steps";
    for (const item of block.steps) {
      const line = document.createElement("li");
      line.textContent = item;
      list.append(line);
    }
    parent.append(list);
    return;
  }
  if (block.sample) {
    parent.append(figure(block));
    return;
  }
  if (block.result) {
    const box = document.createElement("div");
    box.className = "fl-docs__result";
    const label = document.createElement("span");
    label.textContent = "Ожидаемый результат";
    const text = document.createElement("p");
    text.textContent = block.result;
    box.append(label, text);
    parent.append(box);
    return;
  }
  if (block.note || block.error) {
    const data = block.error ?? block.note;
    const box = document.createElement("aside");
    box.className = block.error ? "fl-docs__callout fl-docs__callout--error" : "fl-docs__callout";
    const title = document.createElement("strong");
    title.textContent = data.title;
    box.append(title);
    addHtml(box, `<p>${data.html}</p>`);
    parent.append(box);
  }
}

function renderArticle(article, index, list) {
  const node = document.createElement("article");
  node.className = "fl-docs__article";
  node.dataset.docArticle = article.slug;
  node.setAttribute("aria-labelledby", article.slug);
  if (index > 0) node.hidden = true;
  const eyebrow = document.createElement("p");
  eyebrow.className = "fl-docs__eyebrow";
  eyebrow.textContent = `${article.group} / ${String(index + 1).padStart(2, "0")}`;
  const title = document.createElement("h1");
  title.id = article.slug;
  title.tabIndex = -1;
  title.dataset.docHeading = article.slug;
  title.textContent = article.title;
  const lead = document.createElement("p");
  lead.className = "fl-docs__lead";
  lead.textContent = article.lead;
  node.append(eyebrow, title, lead);
  if (article.related?.length) {
    const related = document.createElement("div");
    related.className = "fl-docs__related";
    const label = document.createElement("span");
    label.textContent = "Перед началом";
    related.append(label, ...article.related.map(link));
    node.append(related);
  }
  for (const section of article.sections) {
    const block = document.createElement("section");
    const heading = document.createElement("h2");
    heading.id = section.id;
    heading.dataset.docHeading = section.id;
    heading.textContent = section.title;
    block.append(heading);
    for (const item of section.blocks) renderBlock(block, item);
    node.append(block);
  }
  if (article.seeAlso?.length) {
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    const id = `${article.slug}-also`;
    heading.id = id;
    heading.dataset.docHeading = id;
    heading.textContent = "См. также";
    const row = document.createElement("p");
    row.className = "fl-docs__related";
    row.append(...article.seeAlso.map(link));
    section.append(heading, row);
    node.append(section);
  }
  const footer = document.createElement("footer");
  footer.className = "fl-docs__pager";
  const previous = list[index - 1];
  const next = list[index + 1];
  if (previous) footer.append(link({ target: previous.slug, label: `← ${previous.title}` }));
  else footer.append(Object.assign(document.createElement("span"), { className: "fl-muted", textContent: article.group }));
  if (next) footer.append(link({ target: next.slug, label: `Следующая: ${next.title} →` }));
  else {
    const tail = document.createElement("span");
    tail.className = "fl-muted";
    tail.textContent = article.group;
    footer.append(tail);
  }
  node.append(footer);
  return node;
}

function renderTree() {
  const tree = document.createElement("nav");
  tree.className = "fl-docs__tree";
  tree.setAttribute("aria-label", "Разделы руководства");
  tree.dataset.docTree = "";
  const label = document.createElement("p");
  label.className = "fl-docs__label";
  label.textContent = "Руководство пользователя";
  tree.append(label);
  for (const group of DOC_GROUPS) {
    const details = document.createElement("details");
    details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = group.title;
    summary.setAttribute("aria-expanded", "true");
    details.addEventListener("toggle", () => {
      summary.setAttribute("aria-expanded", String(details.open));
    });
    details.append(summary);
    for (const article of group.articles) {
      details.append(link({ target: article.slug, label: article.title }));
    }
    tree.append(details);
  }
  const note = document.createElement("p");
  note.className = "fl-docs__nav-note";
  note.append("Общее правило — в одной статье.", document.createElement("br"), "В примерах — ссылка на него.");
  tree.append(note);
  return tree;
}

function renderMissing() {
  const box = document.createElement("div");
  box.className = "fl-docs__article";
  box.dataset.docMissing = "";
  box.hidden = true;
  const title = document.createElement("h1");
  title.tabIndex = -1;
  title.textContent = "Раздел не найден";
  const text = document.createElement("p");
  text.append("Проверьте адрес или откройте ");
  text.append(link({ target: DOC_HOME, label: "начало руководства" }));
  text.append(".");
  box.append(title, text);
  return box;
}

const root = document.querySelector("[data-docs]");
root.dataset.docHome = DOC_HOME;
const home = root.querySelector("[data-doc-nav-home]");
home.append(renderTree());
const host = root.querySelector("[data-doc-articles]");
articles.forEach((article, index) => host.append(renderArticle(article, index, articles)));
host.append(renderMissing());

for (const item of root.querySelectorAll("[data-doc-target]")) {
  if (!knownTarget(item.dataset.docTarget)) {
    throw new Error(`Неизвестный якорь руководства: ${item.dataset.docTarget}`);
  }
}

mountDocumentation(root);
