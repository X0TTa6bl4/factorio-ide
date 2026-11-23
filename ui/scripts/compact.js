// Демонстрация состояний UI. Не запускает пользовательский код и движок.
import { createWorkViews } from "./workbench-views.js";

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
    const area = work.querySelector('#compact-source, .fl-compact-editor textarea');
    const eventArea = work.querySelector('[data-event-source]');
    const gutter = work.querySelector('.fl-compact-editor .fl-editor__gutter');
    const status = work.querySelector('[data-compact-status]');
    const jump = work.querySelector('[data-demo-jump]');
    const undo = work.querySelector('[data-demo-undo]');
    const redo = work.querySelector('[data-demo-redo]');
    const histories = new Map([
      ['code', { area, values: [area.value], index: 0 }],
      ['events', { area: eventArea, values: [eventArea.value], index: 0 }],
    ]);
    let views;
    const activeHistory = () => histories.get(views?.primary === 'events' ? 'events' : 'code');
    const refresh = () => {
      const history = activeHistory();
      gutter.textContent = area.value.split('\n').map((_, i) => String(i + 1).padStart(2, '0')).join('\n');
      gutter.scrollTop = area.scrollTop;
      gutter.scrollLeft = 0;
      undo.disabled = history.index === 0;
      redo.disabled = history.index === history.values.length - 1;
    };
    views = createWorkViews(work, {
      stateTarget: work.querySelector('.fl-compact-stage'),
      onChange: refresh,
    });
    for (const [name, history] of histories) {
      history.area.addEventListener('input', () => {
        if (history.writing) return;
        history.values.splice(history.index + 1);
        history.values.push(history.area.value);
        history.index += 1;
        if (name === 'code') {
          status.textContent = 'Изменено · требуется проверка';
          jump.hidden = true;
        }
        refresh();
      });
    }
    [[undo, -1], [redo, 1]].forEach(([button, delta]) => button.addEventListener('click', () => {
      const history = activeHistory();
      const next = history.index + delta;
      if (next < 0 || next >= history.values.length) return;
      history.index = next;
      history.writing = true;
      history.area.value = history.values[next];
      history.writing = false;
      if (history.area === area) {
        status.textContent = 'Изменено · требуется проверка';
        jump.hidden = true;
      }
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
