// Демонстрация состояний UI. Не запускает пользовательский код и движок.
export function mountCompact(root = document) {
  root.querySelectorAll('[data-compact-toolbar]').forEach(toolbar => {
    if (toolbar.dataset.compactReady) return;
    toolbar.dataset.compactReady = 'true';
    const play = toolbar.querySelector('[data-demo-play]');
    const back = toolbar.querySelector('[data-demo-back]');
    const tick = toolbar.querySelector('[data-demo-tick]');
    let current = 0;
    const paint = () => { tick.textContent = current; back.disabled = current === 0; };
    const running = value => {
      play.setAttribute('aria-pressed', String(value));
      play.setAttribute('aria-label', value ? 'Приостановить' : 'Запустить');
      play.title = play.getAttribute('aria-label');
      play.querySelector('path').setAttribute('d', value ? 'M8 5v14M16 5v14' : 'm8 5 11 7-11 7Z');
      toolbar.querySelector('[data-demo-run-status]').textContent = value ? 'Запущено · демонстрация' : 'Приостановлено';
    };
    play.addEventListener('click', () => running(play.getAttribute('aria-pressed') !== 'true'));
    toolbar.querySelector('[data-demo-step]').addEventListener('click', () => { current++; paint(); });
    back.addEventListener('click', () => { current = Math.max(0, current - 1); paint(); });
    toolbar.querySelector('[data-demo-reset]').addEventListener('click', () => { current = 0; running(false); paint(); });
  });
  root.querySelectorAll('[data-compact-workbench]').forEach(work => {
    if (work.dataset.compactReady) return;
    work.dataset.compactReady = 'true';
    const views = [...work.querySelectorAll('[data-work-view]')];
    const panels = Object.fromEntries(views.map(button => [button.dataset.workView, document.getElementById(button.getAttribute('aria-controls'))]));
    const media = matchMedia('(max-width:900px)');
    let primary = 'code';
    let mobileView = 'code';
    let networks = true;
    const paint = () => {
      const visible = name => media.matches ? mobileView === name : name === 'networks' ? networks : primary === name;
      views.forEach(button => {
        const name = button.dataset.workView;
        button.setAttribute('aria-expanded', String(visible(name)));
        panels[name].hidden = !visible(name);
      });
      work.querySelector('.fl-compact-stage').dataset.networks = String(visible('networks'));
      work.querySelector('.fl-compact-edit').hidden = !visible('code');
    };
    views.forEach(button => button.addEventListener('click', () => {
      const name = button.dataset.workView;
      if (media.matches) mobileView = name;
      else if (name === 'networks') networks = !networks;
      else primary = name;
      paint();
    }));
    media.addEventListener('change', () => {
      // Не прятать активный фокус при переходе через breakpoint.
      const activePanel = Object.entries(panels).find(([, panel]) => panel.contains(document.activeElement));
      if (activePanel) {
        mobileView = activePanel[0];
        if (mobileView !== 'networks') primary = mobileView;
      }
      paint();
    });
    paint();
    const area = work.querySelector('#compact-source, textarea');
    const gutter = work.querySelector('.fl-editor__gutter');
    const status = work.querySelector('[data-compact-status]');
    const jump = work.querySelector('[data-demo-jump]');
    const undo = work.querySelector('[data-demo-undo]');
    const redo = work.querySelector('[data-demo-redo]');
    const history = [area.value];
    let index = 0;
    const refresh = () => {
      gutter.textContent = area.value.split('\n').map((_, i) => String(i + 1).padStart(2, '0')).join('\n');
      gutter.scrollTop = area.scrollTop;
      gutter.scrollLeft = 0;
      undo.disabled = index === 0;
      redo.disabled = index === history.length - 1;
    };
    area.addEventListener('input', () => {
      history.splice(index + 1);
      history.push(area.value);
      index++;
      status.textContent = 'Изменено · требуется проверка';
      jump.hidden = true;
      refresh();
    });
    [[undo, -1], [redo, 1]].forEach(([button, delta]) => button.addEventListener('click', () => {
      index += delta;
      area.value = history[index];
      status.textContent = 'Изменено · требуется проверка';
      jump.hidden = true;
      refresh();
    }));
    work.querySelector('[data-demo-error]').addEventListener('click', () => {
      status.textContent = 'Строка 2: сеть red_1 не объявлена. Добавьте её в networks.';
      jump.hidden = false;
    });
    jump.addEventListener('click', () => { area.focus(); const start = area.value.indexOf('red_1'); area.setSelectionRange(Math.max(0, start), Math.max(0, start) + 5); });
    const eventStatus = work.querySelector('[data-event-status]');
    const stop = work.querySelector('[data-demo-stop]');
    work.querySelector('[data-demo-check]').addEventListener('click', () => { eventStatus.textContent = 'Проверка · демонстрация без Worker'; stop.disabled = false; });
    stop.addEventListener('click', () => { eventStatus.textContent = 'Проверка остановлена · демонстрация'; stop.disabled = true; });
    refresh();
  });
}
