/** Поведение библиотечного образца; не обращается к редактору или симулятору. */
export function mountDocumentation(root) {
  if (root.dataset.docsMounted) return;
  root.dataset.docsMounted = "true";
  const home = root.dataset.docHome || "networks";
  const articles = [...root.querySelectorAll("[data-doc-article]")];
  const tree = root.querySelector("[data-doc-tree]");
  const navHome = root.querySelector("[data-doc-nav-home]");
  const dialog = root.querySelector("[data-doc-dialog]");
  const menu = root.querySelector("[data-doc-menu]");
  const outline = root.querySelector("[data-doc-outline]");
  const toc = root.querySelector("[data-doc-toc]");
  const missing = root.querySelector("[data-doc-missing]");
  const mobile = matchMedia("(max-width: 899px)");
  const compact = matchMedia("(max-width: 1199px)");
  const targets = new Map([...root.querySelectorAll("[data-doc-heading]")].map(node => [node.dataset.docHeading, node]));
  let current;
  let observer;
  let lastTarget;
  let restoreMenu = true;
  root.querySelectorAll("[data-doc-target]").forEach(link => { link.href = `#${link.dataset.docTarget}`; });
  const close = (navigating = false) => { if (dialog.open) { restoreMenu = !navigating; dialog.close(); } };
  menu.addEventListener("click", () => {
    dialog.querySelector("[data-doc-dialog-body]").append(tree);
    restoreMenu = true;
    dialog.showModal();
  });
  root.querySelector("[data-doc-close]").addEventListener("click", () => close());
  dialog.addEventListener("click", event => {
    const box = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) close();
  });
  dialog.addEventListener("close", () => { navHome.append(tree); if (restoreMenu) menu.focus({ preventScroll: true }); });
  const syncOutline = () => { outline.open = !compact.matches; };
  syncOutline();
  compact.addEventListener("change", syncOutline);
  mobile.addEventListener("change", () => { if (!mobile.matches) close(); });
  const mark = target => {
    toc.querySelectorAll("a").forEach(link => {
      if (link.dataset.docTarget === target) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  };
  function show(target, navigate = false) {
    const heading = targets.get(target);
    const article = heading?.closest("[data-doc-article]");
    const changed = current !== article;
    articles.forEach(node => { node.hidden = node !== article; });
    missing.hidden = Boolean(article);
    outline.hidden = !article;
    tree.querySelectorAll("[data-doc-target]").forEach(link => {
      if (link.dataset.docTarget === article?.dataset.docArticle) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    if (changed) {
      current = article;
      observer?.disconnect();
      toc.replaceChildren();
      article?.querySelectorAll("h2[data-doc-heading]").forEach(node => {
        const link = document.createElement("a");
        link.textContent = node.textContent;
        link.dataset.docTarget = node.dataset.docHeading;
        link.href = `#${node.dataset.docHeading}`;
        toc.append(link);
      });
      observer = new IntersectionObserver(entries => {
        const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) mark(visible[0].target.dataset.docHeading);
      }, { rootMargin: "-100px 0px -50% 0px" });
      article?.querySelectorAll("h2[data-doc-heading]").forEach(node => observer.observe(node));
    }
    mark(target);
    if (navigate) {
      const node = heading ?? missing.querySelector("h1");
      node.tabIndex = -1;
      node.scrollIntoView({ block: "start" });
      node.focus({ preventScroll: true });
    }
  }
  function route(navigate = false) {
    let target;
    try { target = decodeURIComponent(location.hash.slice(1)) || home; }
    catch { target = "unknown"; }
    if (root.classList.contains("fl-docs--catalog") && !targets.has(target)) {
      if (current) return;
      target = home;
      navigate = false;
    }
    if (target !== lastTarget || navigate) { show(target, navigate); lastTarget = target; }
  }
  root.addEventListener("click", event => {
    const link = event.target.closest("a[data-doc-target]");
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    close(true);
    const target = link.dataset.docTarget;
    if (location.hash !== `#${target}`) history.pushState(null, "", `#${target}`);
    show(target, true);
    lastTarget = target;
  });
  window.addEventListener("hashchange", () => route(true));
  window.addEventListener("popstate", () => route(true));
  root.querySelectorAll("[data-doc-copy]").forEach(button => button.addEventListener("click", async () => {
    const block = button.closest("[data-doc-code]");
    const status = block.querySelector("[data-doc-copy-status]");
    try {
      await navigator.clipboard.writeText(block.querySelector("code").textContent);
      status.textContent = "Код скопирован";
    } catch { status.textContent = "Не удалось скопировать. Выделите код и скопируйте вручную."; }
  }));
  const header = root.querySelector("[data-doc-header]");
  if (header) new ResizeObserver(() => root.style.setProperty("--fl-docs-header-height", `${header.offsetHeight}px`)).observe(header);
  route(Boolean(location.hash));
}
