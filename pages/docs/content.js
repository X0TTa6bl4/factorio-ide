/** Реестр пользовательского руководства. Меню и оглавление строятся из этих данных. */

import { CATALOG_VERSION, EVENT_DEMO, RELEASE_NOTE, VERSION_CHECKED_ON } from "../release.js";

export const DOC_HOME = "start";

export const DOC_SAMPLES = {
  quickStart: {
    text: `wire red_1 {}
wire red_2 {}

Constant({
  enabled: true,
  red_output: red_1,
  signals: [{ signal: Signal.Signals.signal_A, constant: 12 }]
})

Decider({
  red_input: red_1,
  red_output: red_2,
  conditions: [{
    left_operand: { red: true, green: false, signal: Signal.Signals.signal_A },
    right_operand: { constant: 0 },
    operation: Decider.Operation.GT
  }],
  when_true: [{ signal: Signal.Signals.signal_A, constant: 1 }]
})`,
    steps: 1,
    expect: [
      { tick: 0, network: "red_1", signal: "signal-A", value: 12 },
      { tick: 0, network: "red_2", signal: "signal-A", absent: true },
      { tick: 1, network: "red_1", signal: "signal-A", value: 12 },
      { tick: 1, network: "red_2", signal: "signal-A", value: 1 },
    ],
  },
  deciderCopy: {
    text: `wire red_1 {}
wire red_2 {}

Constant({
  enabled: true,
  red_output: red_1,
  signals: [{ signal: Signal.Signals.signal_A, constant: 12 }]
})

Decider({
  red_input: red_1,
  red_output: red_2,
  conditions: [{
    left_operand: { red: true, green: false, signal: Signal.Signals.signal_A },
    right_operand: { constant: 0 },
    operation: Decider.Operation.GT
  }],
  when_true: [{ signal: Signal.Signals.signal_A, red: true, green: false }]
})`,
    steps: 1,
    expect: [
      { tick: 1, network: "red_2", signal: "signal-A", value: 12 },
    ],
  },
  deciderElse: {
    text: `wire red_1 {}
wire red_2 {}

Constant({
  enabled: true,
  red_output: red_1,
  signals: [{ signal: Signal.Signals.signal_A, constant: 3 }]
})

Decider({
  red_input: red_1,
  red_output: red_2,
  conditions: [{
    left_operand: { red: true, green: false, signal: Signal.Signals.signal_A },
    right_operand: { constant: 10 },
    operation: Decider.Operation.GT
  }],
  when_true: [{ signal: Signal.Signals.signal_B, constant: 1 }],
  when_false: [{ signal: Signal.Signals.signal_B, constant: 2 }]
})`,
    steps: 1,
    expect: [
      { tick: 0, network: "red_1", signal: "signal-A", value: 3 },
      { tick: 0, network: "red_2", signal: "signal-B", absent: true },
      { tick: 1, network: "red_2", signal: "signal-B", value: 2 },
    ],
  },
  deciderAnd: {
    text: `wire red_1 {}
wire red_2 {}

Constant({
  enabled: true,
  red_output: red_1,
  signals: [
    { signal: Signal.Signals.signal_A, constant: 1 },
    { signal: Signal.Signals.signal_C, constant: 1 }
  ]
})

Decider({
  red_input: red_1,
  red_output: red_2,
  conditions: [{
    left_operand: { red: true, green: false, signal: Signal.Signals.signal_A },
    right_operand: { constant: 0 },
    operation: Decider.Operation.GT
  }, {
    logic: Decider.Logic.OR,
    left_operand: { red: true, green: false, signal: Signal.Signals.signal_B },
    right_operand: { constant: 0 },
    operation: Decider.Operation.GT
  }, {
    logic: Decider.Logic.AND,
    left_operand: { red: true, green: false, signal: Signal.Signals.signal_C },
    right_operand: { constant: 0 },
    operation: Decider.Operation.GT
  }],
  when_true: [{ signal: Signal.Signals.signal_D, constant: 1 }]
})`,
    steps: 1,
    expect: [
      { tick: 1, network: "red_2", signal: "signal-D", value: 1 },
    ],
  },
  deciderSilent: {
    text: `wire red_1 {}
wire red_2 {}

Constant({
  enabled: true,
  red_output: red_1,
  signals: [{ signal: Signal.Signals.signal_A, constant: 12 }]
})

Decider({
  red_input: red_1,
  red_output: red_2,
  conditions: [{
    left_operand: { red: true, green: false, signal: Signal.Signals.signal_A },
    right_operand: { constant: 100 },
    operation: Decider.Operation.GT
  }],
  when_true: [{ signal: Signal.Signals.signal_B, constant: 1 }]
})`,
    steps: 1,
    expect: [
      { tick: 1, network: "red_1", signal: "signal-A", value: 12 },
      { tick: 1, network: "red_2", signal: "signal-B", absent: true },
    ],
  },
  deciderCopyMissing: {
    text: `wire red_1 {}
wire red_2 {}

Constant({
  enabled: true,
  red_output: red_1,
  signals: [{ signal: Signal.Signals.signal_A, constant: 12 }]
})

Decider({
  red_input: red_1,
  red_output: red_2,
  conditions: [{
    left_operand: { red: true, green: false, signal: Signal.Signals.signal_A },
    right_operand: { constant: 0 },
    operation: Decider.Operation.GT
  }],
  when_true: [{ signal: Signal.Signals.signal_B, red: true, green: false }]
})`,
    steps: 1,
    expect: [
      { tick: 1, network: "red_2", signal: "signal-B", absent: true },
      { tick: 1, network: "red_2", signal: "signal-A", absent: true },
    ],
  },
  arithmeticSum: {
    text: `wire red_1 {}
wire green_1 {}

Constant({
  enabled: true,
  red_output: red_1,
  signals: [{ signal: Signal.Signals.signal_A, constant: 10 }]
})

Arithmetic({
  red_input: red_1,
  green_output: green_1,
  left_operand: { red: true, green: false, signal: Signal.Signals.signal_A },
  right_operand: { constant: 2 },
  operation: Arithmetic.Operation.SUM,
  return: Signal.Signals.signal_A
})`,
    steps: 1,
    expect: [
      { tick: 0, network: "red_1", signal: "signal-A", value: 10 },
      { tick: 0, network: "green_1", signal: "signal-A", absent: true },
      { tick: 1, network: "green_1", signal: "signal-A", value: 12 },
    ],
  },
  constantHold: {
    text: `wire red_1 {}

Constant({
  enabled: true,
  red_output: red_1,
  signals: [{ signal: Signal.Signals.signal_A, constant: 12 }]
})`,
    steps: 1,
    expect: [
      { tick: 0, network: "red_1", signal: "signal-A", value: 12 },
      { tick: 1, network: "red_1", signal: "signal-A", value: 12 },
    ],
  },
  constantOff: {
    text: `wire red_1 {}

Constant({
  enabled: false,
  red_output: red_1,
  signals: [{ signal: Signal.Signals.signal_A, constant: 9 }]
})`,
    steps: 0,
    expect: [
      { tick: 0, network: "red_1", signal: "signal-A", absent: true },
    ],
  },
  selectorCount: {
    text: `wire red_items {}
wire red_count {}

Constant({
  enabled: true,
  red_output: red_items,
  signals: [
    { signal: Signal.Signals.signal_A, constant: 100 },
    { signal: Signal.Signals.signal_B, constant: -2 }
  ]
})

Selector({
  operation: Selector.Operation.COUNT,
  signal: Signal.Signals.signal_C,
  red_input: red_items,
  red_output: red_count
})`,
    steps: 1,
    expect: [
      { tick: 0, network: "red_items", signal: "signal-A", value: 100 },
      { tick: 0, network: "red_items", signal: "signal-B", value: -2 },
      { tick: 0, network: "red_count", signal: "signal-C", absent: true },
      { tick: 1, network: "red_count", signal: "signal-C", value: 2 },
    ],
  },
  selectorPick: {
    text: `wire red_1 {}
wire red_2 {}

Constant({
  enabled: true,
  red_output: red_1,
  signals: [{ signal: Signal.Signals.signal_A, constant: 5 }]
})

Selector({
  red_input: red_1,
  red_output: red_2,
  operation: Selector.Operation.SELECT,
  sort: Selector.Sort.DESC,
  index: { constant: 0 },
  compare: Selector.Compare.EQ
})`,
    steps: 1,
    expect: [
      { tick: 0, network: "red_2", signal: "signal-A", absent: true },
      { tick: 1, network: "red_2", signal: "signal-A", value: 5 },
    ],
  },
  feedback: {
    text: `wire green_count {}

Arithmetic({
  green_input: green_count,
  green_output: green_count,
  left_operand: { red: false, green: true, signal: Signal.Signals.signal_A },
  right_operand: { constant: 1 },
  operation: Arithmetic.Operation.SUM,
  return: Signal.Signals.signal_A
})`,
    steps: 3,
    expect: [
      { tick: 0, network: "green_count", signal: "signal-A", absent: true },
      { tick: 1, network: "green_count", signal: "signal-A", value: 1 },
      { tick: 3, network: "green_count", signal: "signal-A", value: 3 },
    ],
  },
  networkSum: {
    text: `wire red_bus {}

Constant({
  enabled: true,
  red_output: red_bus,
  signals: [{ signal: Signal.Signals.signal_A, constant: 3 }]
})

Constant({
  enabled: true,
  red_output: red_bus,
  signals: [{ signal: Signal.Signals.signal_A, constant: 7 }]
})`,
    steps: 0,
    expect: [
      { tick: 0, network: "red_bus", signal: "signal-A", value: 10 },
    ],
  },
  networkCancel: {
    text: `wire red_bus {}

Constant({
  enabled: true,
  red_output: red_bus,
  signals: [{ signal: Signal.Signals.signal_A, constant: 3 }]
})

Constant({
  enabled: true,
  red_output: red_bus,
  signals: [{ signal: Signal.Signals.signal_A, constant: -3 }]
})`,
    steps: 0,
    expect: [
      { tick: 0, network: "red_bus", signal: "signal-A", absent: true },
    ],
  },
  colorSum: {
    text: `wire red_1 {}
wire green_1 {}
wire red_out {}

Constant({
  enabled: true,
  red_output: red_1,
  signals: [{ signal: Signal.Signals.signal_A, constant: 2 }]
})

Constant({
  enabled: true,
  green_output: green_1,
  signals: [{ signal: Signal.Signals.signal_A, constant: 5 }]
})

Arithmetic({
  red_input: red_1,
  green_input: green_1,
  red_output: red_out,
  left_operand: { red: true, green: true, signal: Signal.Signals.signal_A },
  right_operand: { constant: 0 },
  operation: Arithmetic.Operation.SUM,
  return: Signal.Signals.signal_A
})`,
    steps: 1,
    expect: [
      { tick: 0, network: "red_1", signal: "signal-A", value: 2 },
      { tick: 0, network: "green_1", signal: "signal-A", value: 5 },
      { tick: 0, network: "red_out", signal: "signal-A", absent: true },
      { tick: 1, network: "red_out", signal: "signal-A", value: 7 },
    ],
  },
  storageLamp: {
    text: `wire red_bus {}

storage chest = new Storage({
  enabled: true,
  mode: "read",
  red_output: red_bus,
  contents: [{ signal: Signal.Signals.signal_A, constant: 4 }]
})

lamp bulb = new Lamp({
  red_input: red_bus,
  use_colors: false,
  condition: {
    left_operand: { red: true, green: false, signal: Signal.Signals.signal_A },
    operation: Lamp.Operation.GT,
    right_operand: { constant: 0 }
  }
})`,
    steps: 1,
    expect: [
      { tick: 0, network: "red_bus", signal: "signal-A", value: 4 },
      { tick: 1, network: "red_bus", signal: "signal-A", value: 4 },
    ],
  },
  stationPresence: {
    text: `wire red_stop {}

train loco = new Train({
  route: [stop],
  transit: 1,
  at: 0
})

station stop = new Station({
  depart: Signal.Signals.signal_D,
  red_output: red_stop
})`,
    steps: 0,
    expect: [
      { tick: 0, network: "red_stop", signal: "signal-T", value: 1 },
    ],
  },
  brokenOutput: {
    text: `wire red_1 {}

Decider({
  red_input: red_1,
  conditions: [{
    left_operand: { red: true, green: false, signal: Signal.Signals.signal_A },
    right_operand: { constant: 0 },
    operation: Decider.Operation.GT
  }],
  when_true: [{ signal: Signal.Signals.signal_A }]
})`,
    diagnostic: "invalid-output",
  },
  unknownPath: {
    text: `Constant({
  enabled: true,
  signals: [{ signal: SSignal.Signals.signal_A, constant: 1 }]
})`,
    diagnostic: "unknown-path",
  },
};

function sample(id, caption, label) {
  return { sample: id, caption, label };
}

export const DOC_GROUPS = [
  {
    title: "Начало работы",
    articles: [
      {
        slug: "start",
        title: "Что делает f logic",
        lead: "Редактор и пошаговая симуляция логических сетей: вы описываете устройства текстом, запускаете тики и смотрите количества сигналов.",
        related: [{ target: "compatibility", label: "Границы совместимости" }],
        seeAlso: [
          { target: "quick-start", label: "Первая схема" },
          { target: "editor", label: "Редактор" },
        ],
        sections: [
          {
            id: "start-bounds",
            title: "Что умеет приложение",
            blocks: [
              { html: "<p>Рабочий экран — редактор обычных комбинаторов. В тексте задаются сети, постоянный, арифметический, сравнивающий и выбирающий комбинаторы, а также лампа, хранилище, станция и поезд в поддержанном виде. Отдельная страница ведёт событийный сценарий: это инструмент проверки, его нет в Factorio.</p>" },
              { html: "<p>Симуляция считает проектную модель. Каталог сигналов сверен со снимком Factorio, но игровой прогон этих схем не выполнялся. Подробности и отказ заявлять совместимость вычислений — в статье <a href=\"#compatibility\" data-doc-target=\"compatibility\">«Совместимость»</a>.</p>" },
            ],
          },
          {
            id: "start-open",
            title: "Куда переходить",
            blocks: [
              { html: "<p>Редактор открывается с корня сайта и по адресу конфигурации. Оба адреса — один и тот же черновик вкладки. Кнопка «Меню» на рабочих страницах открывает «Документация» и «Очистить проект». «В редактор» в шапке руководства возвращает к черновику и не подставляет другой текст.</p>" },
              { html: "<p>Примеры, просмотр сетей, контур, отладчик и файл схемы — отдельные экраны. У них нет общего прогона с открытым редактором. Ссылки на них стоят в статьях <a href=\"#examples\" data-doc-target=\"examples\">«Примеры»</a>, <a href=\"#debugger\" data-doc-target=\"debugger\">«Отладчик»</a>, <a href=\"#network-screen\" data-doc-target=\"network-screen\">«Экран сетей»</a>, <a href=\"#circuit\" data-doc-target=\"circuit\">«Контур»</a> и <a href=\"#project\" data-doc-target=\"project\">«Файл схемы»</a>.</p>" },
            ],
          },
        ],
      },
      {
        slug: "quick-start",
        title: "Первая схема",
        lead: "Постоянный источник пишет signal-A в одну красную сеть, сравнивающий при A > 0 выдаёт фиксированную единицу в другую.",
        related: [
          { target: "networks-ports", label: "Подключение к сетям" },
          { target: "simulation-controls", label: "Запуск и шаг" },
        ],
        seeAlso: [
          { target: "decider-fixed", label: "Фиксированный выход" },
          { target: "constant", label: "Постоянный комбинатор" },
          { href: "../../index.html", label: "Открыть редактор" },
        ],
        sections: [
          {
            id: "quick-start-paste",
            title: "Вставить код",
            blocks: [
              { html: "<p>Откройте <a href=\"../../index.html\">редактор</a>. В поле кода замените текст примером ниже. «Очистить проект» в меню шапки возвращает исходный пример и спрашивает подтверждение, если черновик уже изменён. Для этого прохода вставьте листинг сами.</p>" },
              { steps: [
                "Объявите обе сети, которые использует схема.",
                "Постоянный комбинатор пишет в red_1.",
                "Сравнивающий читает red_1 и пишет в red_2.",
              ] },
              sample("quickStart", "Конфигурация · первая схема", "Первая схема: постоянный и сравнивающий"),
            ],
          },
          {
            id: "quick-start-run",
            title: "Запустить и сделать шаг",
            blocks: [
              { html: "<p>Нажмите «Запустить». Появится граница 0: в таблице «Сети» у <code>red_1</code> видно <strong>signal-A = 12</strong>. В <code>red_2</code> сигнала A нет: сравнивающий публикует выход на следующей границе. Нажмите «Шаг». Тик станет 1, в <code>red_2</code> появится <strong>signal-A = 1</strong>. В <code>red_1</code> по-прежнему 12.</p>" },
              { result: "Граница 0: red_1 signal-A = 12, в red_2 сигнала A нет. После одного шага red_2 signal-A = 1." },
            ],
          },
          {
            id: "quick-start-reset",
            title: "Сбросить",
            blocks: [
              { html: "<p>«Сброс» возвращает открытый прогон на границу 0. Текст в поле не меняется. Снова видно signal-A = 12 только во входной сети. «Шаг назад» откатывает снимок прогона и тоже не трогает код.</p>" },
              { html: "<p>Если условие не выполняется или выход записан неполно, смотрите <a href=\"#problems\" data-doc-target=\"problems\">решение проблем</a>.</p>" },
            ],
          },
        ],
      },
      {
        slug: "compatibility",
        title: "Совместимость",
        lead: "Снимок каталога и граница того, что приложение готово утверждать про Factorio.",
        related: [{ target: "start-bounds", label: "Границы приложения" }],
        seeAlso: [{ target: "problems", label: "Решение проблем" }],
        sections: [
          {
            id: "compatibility-version",
            title: "Версия каталога",
            blocks: [
              { html: `<p>${RELEASE_NOTE}</p>` },
              { html: `<p>Номер снимка — ${CATALOG_VERSION}. Дата проверки stable — ${VERSION_CHECKED_ON}. Профиль редактора — base, пока текст не открыт как файл другого профиля. Дата проверки входит в текст выше.</p>` },
            ],
          },
          {
            id: "compatibility-limits",
            title: "Что это не обещает",
            blocks: [
              { html: "<p>Демонстрации считают по проектной модели. Игровой прогон схем не выполнялся, совместимость вычислений с игрой не заявлена. Неподдержанный режим остаётся ошибкой конфигурации или шага, а не тихим игровым значением по умолчанию.</p>" },
              { html: "<p>Отсутствующий файл — это ответ сервера об отсутствии ресурса, а не режим Factorio. Черновик редактора живёт во вкладке браузера и не подменяется чтением этой статьи.</p>" },
            ],
          },
        ],
      },
    ],
  },
  {
    title: "Редактор",
    articles: [
      {
        slug: "editor",
        title: "Редактор",
        lead: "Поле кода на корневом адресе и на странице конфигурации. Подсказки, сети, клавиши, отмена и переход к ошибке.",
        related: [
          { target: "networks-create", label: "Имена сетей" },
          { target: "signals-catalog", label: "Каталог сигналов" },
        ],
        seeAlso: [
          { target: "quick-start", label: "Первая схема" },
          { target: "problems-unknown", label: "Неизвестный путь" },
          { href: "../../index.html", label: "Редактор" },
          { href: "../configure/index.html", label: "Тот же редактор" },
        ],
        sections: [
          {
            id: "editor-input",
            title: "Ввод кода",
            blocks: [
              { html: "<p>Текст — конфигурация устройств, а не произвольный исполняемый сценарий. Свободный JavaScript остаётся на <a href=\"../event/index.html\">странице события</a>. Черновик пишется в память вкладки и восстанавливается при следующем открытии редактора. Уход со страницы сохраняет текущий текст.</p>" },
              { html: "<p>«Очистить проект» стоит в меню шапки, отдельно от пульта «Запустить / Шаг / Сброс». Если схема или сценарий отличаются от исходных, пункт описывает потерю правок и спрашивает подтверждение. Отмена оставляет текст, настройки, историю и текущий прогон. Согласие подставляет пример схемы, возвращает сценарий и его настройки, останавливает прогон и забывает прежний черновик вкладки. Сохранённые схемы не удаляются. На других страницах тот же пункт меняет только этот черновик и не уходит с экрана.</p>" },
            ],
          },
          {
            id: "editor-hints",
            title: "Подсказки",
            blocks: [
              { html: "<p>Меню у каретки открывается при наборе префикса, после точки и по Ctrl+Space. Стрелки, Home и End двигают выбор. Enter и клик подставляют пункт. Tab пункт не принимает.</p>" },
              { html: "<p>В поле кода Tab вставляет один символ табуляции, в том числе при открытом меню. Shift+Tab уходит к предыдущему элементу и символ не вставляет. Escape закрывает меню и оставляет обычные клавиши. Комментарий и строка подсказок не дают.</p>" },
            ],
          },
          {
            id: "editor-networks",
            title: "Имена сетей",
            blocks: [
              { html: "<p>Имя сети начинается с <code>red_</code> или <code>green_</code>. Новое имя своего цвета становится сетью, когда вы завершаете токен: Escape, клик вне поля или Tab. Отдельного пункта «Создать имя» нет. <code>red_new</code> и <code>green_new</code> — служебные действия подсказки: после выбора они сразу заменяются настоящим именем и сетью не остаются.</p>" },
              { html: "<p>Повтор того же имени — та же сеть. Имя вне порта сеть не создаёт. В готовом тексте ссылка подходящего цвета в порте восстанавливает сеть и без строки <code>wire</code>. В примерах этого руководства сети всё равно объявлены явно.</p>" },
            ],
          },
          {
            id: "editor-keys",
            title: "Tab, Enter и Escape",
            blocks: [
              { html: "<p>Tab — отступ. Enter — выбрать подсказку. Escape в меню подсказок только закрывает список. Escape над всплывающей подсказкой кнопки скрывает эту подсказку и не меняет документ.</p>" },
            ],
          },
          {
            id: "editor-format",
            title: "Форматирование",
            blocks: [
              { html: "<p>Форматирование: ⌥⌘L на macOS, Ctrl+Alt+L на Windows и Linux. Сочетание действует только пока фокус в поле кода. Отдельной кнопки нет. Форматтер расставляет отступы и переносы, не исполняет текст и не исправляет неизвестные имена. Повторный вызов не меняет уже отформатированный текст. Синтаксическая ошибка оставляет текст как есть.</p>" },
            ],
          },
          {
            id: "editor-history",
            title: "Отмена и повтор",
            blocks: [
              { html: "<p>«Отменить правку» и «Повторить правку» — кнопки в заголовке рабочей области. На macOS основные сочетания ⌘Z и ⇧⌘Z, на Windows и Linux — Ctrl+Z и Ctrl+Y. На Windows и Linux повтор также вызывается Ctrl+Shift+Z. Подсказка кнопки показывает сочетание этой системы.</p>" },
              { html: "<p>В поле кода это история редактора, а не отдельная отмена самого поля. В других полях страницы сочетание остаётся отменой браузера. Правка, вставка и форматирование — по одному шагу истории. Новая правка очищает хвост повтора. Отмена не двигает тик симуляции.</p>" },
            ],
          },
          {
            id: "editor-errors",
            title: "Ошибки и «К месту»",
            blocks: [
              { html: "<p>Ошибка, из-за которой схема не запускается, подчёркивается красной волнистой линией под диапазоном в коде. Короткая причина и что исправить написаны в строке под кодом. Кнопка «К месту» ставит фокус в поле и выделяет этот диапазон. Несколько ошибок показаны счётчиком: «Список» открывает все сообщения, у каждого со своим диапазоном есть «К месту». На узкой ширине переход оставляет код на экране.</p>" },
              { html: "<p>После исправления маркер этой ошибки исчезает. Неизвестный путь вроде <code>SSignal</code> не переписывается сам: замените его на существующий путь, как в <a href=\"#problems-unknown\" data-doc-target=\"problems-unknown\">решении проблем</a>.</p>" },
            ],
          },
        ],
      },
    ],
  },
  {
    title: "Общие понятия",
    articles: [
      {
        slug: "networks",
        title: "Сети",
        lead: "Красный и зелёный провод — разные сети. Одинаковый сигнал от нескольких источников в одной сети складывается.",
        related: [{ target: "signals", label: "Сигналы" }],
        seeAlso: [
          { target: "operands-mask", label: "Маски цветов" },
          { target: "simulation-feedback", label: "Обратная связь" },
          { target: "network-screen", label: "Экран сетей" },
        ],
        sections: [
          {
            id: "networks-create",
            title: "Имена и объявление",
            blocks: [
              { html: "<p>Сеть создаётся строкой <code>wire red_имя {}</code> или <code>wire green_имя {}</code>. Суффикс — буквы, цифры и подчёркивания. Повтор имени в порте означает ту же сеть. Цвет порта должен совпадать с цветом имени: красный выход не принимает <code>green_1</code>.</p>" },
              { html: "<p>Как завершить новое имя с клавиатуры, описано в <a href=\"#editor-networks\" data-doc-target=\"editor-networks\">редакторе</a>.</p>" },
            ],
          },
          {
            id: "networks-ports",
            title: "Подключение",
            blocks: [
              { html: "<p>У вычисляемого устройства четыре порта: <code>red_input</code>, <code>green_input</code>, <code>red_output</code>, <code>green_output</code>. Пропущенный порт и явный <code>null</code> означают «провода нет». Неподключённый выход в сеть ничего не пишет.</p>" },
              { html: "<p>Постоянный источник и хранилище входов не имеют: им доступны только выходы. Для простой передачи оставьте вход и выход на разных сетях. Общая сеть входа и выхода — уже обратная связь, она описана в <a href=\"#simulation-feedback\" data-doc-target=\"simulation-feedback\">симуляции</a>.</p>" },
              sample("quickStart", "Конфигурация · две сети", "Вход red_1 и выход red_2"),
              { html: "<p class=\"fl-docs__caption\">Полный запуск этого листинга — в <a href=\"#quick-start\" data-doc-target=\"quick-start\">первой схеме</a>.</p>" },
            ],
          },
          {
            id: "networks-colors",
            title: "Цвета",
            blocks: [
              { html: "<p>Красная и зелёная сети не сливаются от того, что устройство читает обе. Операнд сам выбирает, какой цвет читать. В примере ниже на красном входе signal-A = 2, на зелёном signal-A = 5. Операнд с обоими флагами получает 7 и на следующем шаге пишет их в <code>red_out</code>.</p>" },
              sample("colorSum", "Конфигурация · сумма цветов", "Чтение красного и зелёного signal-A"),
              { result: "Граница 0: red_1 signal-A = 2, green_1 signal-A = 5, red_out пуст. После одного шага red_out signal-A = 7." },
            ],
          },
          {
            id: "networks-reading",
            title: "Суммирование и чтение",
            blocks: [
              { html: "<p>В одной сети вклады с одним и тем же сигналом складываются. Два постоянных источника signal-A = 3 и signal-A = 7 дают <strong>signal-A = 10</strong> уже на границе 0. Нулевая сумма канал не хранит: 3 и −3 оставляют сеть без сигнала A, чтение этого канала даёт 0.</p>" },
              sample("networkSum", "Конфигурация · сумма в одной сети", "Два источника signal-A"),
              { result: "Граница 0: red_bus signal-A = 10." },
              sample("networkCancel", "Конфигурация · взаимное гашение", "signal-A = 3 и signal-A = −3"),
              { result: "Граница 0: канала signal-A нет." },
              { html: "<p>Отсутствующий обычный канал при сравнении и арифметике читается как 0. Это не то же самое, что незаданный операнд. Числа — знаковые 32-битные: переполнение оборачивается, дробная запись в конфигурации отклоняется.</p>" },
            ],
          },
        ],
      },
      {
        slug: "signals",
        title: "Сигналы",
        lead: "Канал сети — это сигнал и целое количество. Путь в тексте выбирает сигнал из каталога, а не свободную строку.",
        related: [{ target: "networks-reading", label: "Как читается канал" }],
        seeAlso: [{ target: "operands", label: "Операнды" }, { target: "problems-unknown", label: "Неизвестный путь" }],
        sections: [
          {
            id: "signals-catalog",
            title: "Каталог",
            blocks: [
              { html: "<p>Обычный сигнал записывается путём <code>Signal.Раздел.имя</code>. Виртуальные буквы лежат в <code>Signal.Signals</code>: <code>Signal.Signals.signal_A</code> — это игровой <code>signal-A</code>. Предметы логистики — в <code>Signal.Logistic</code>, например <code>Signal.Logistic.wooden_chest</code>. Подсказка редактора показывает оставшийся сегмент после точки.</p>" },
              { html: `<p>Состав путей взят из снимка ${CATALOG_VERSION}. Сигнал другого профиля в схеме base не предлагается. Опечатка вроде <code>SSignal</code> остаётся ошибкой, форматирование её не исправляет.</p>` },
            ],
          },
          {
            id: "signals-counts",
            title: "Количества",
            blocks: [
              { html: "<p>Пара «сигнал и количество» в постоянном источнике и в фиксированном выходе сравнивающего — объект <code>{ signal, constant }</code>. <code>constant</code> — целое в диапазоне 32-битного знакового числа. Ноль в итоге сети канал не создаёт. Отрицательное количество хранится.</p>" },
              { html: "<p>Один и тот же сигнал в одной сети складывается, разные сигналы остаются разными строками таблицы. Качество, отличное от обычного, — другой канал; в этих примерах качество не задаётся.</p>" },
            ],
          },
          {
            id: "signals-meta",
            title: "Метасигналы",
            blocks: [
              { html: "<p><code>Signal.Meta.signal_each</code>, <code>signal_everything</code> и <code>signal_anything</code> — режимы «каждый», «все» и «любой». Они не становятся каналом сети. В обычном первом примере они не нужны.</p>" },
              { html: "<p>У сравнивающего фиксированный выход с метасигналом — отдельная форма: вместе с <code>constant</code> обязательны флаги <code>red</code> и <code>green</code>. Для <code>Each</code> количество без маски относится к каналам, которые отобрало условие. Смешанные метасигналы в одном условии и часть сочетаний отклоняются до запуска. Если диагностика говорит, что случай не поддержан, схема не считается «как в игре по умолчанию».</p>" },
            ],
          },
        ],
      },
      {
        slug: "operands",
        title: "Операнды и условия",
        lead: "Операнд — либо число, либо сигнал с выбором цветов входа. Условие сравнивающего собирается из таких операндов.",
        related: [
          { target: "networks-colors", label: "Цвета сетей" },
          { target: "signals-counts", label: "Количества" },
        ],
        seeAlso: [{ target: "decider", label: "Сравнивающий" }, { target: "arithmetic", label: "Арифметический" }],
        sections: [
          {
            id: "operands-constant",
            title: "Константа",
            blocks: [
              { html: "<p>Числовой операнд — объект <code>{ constant: 5 }</code>. Поля <code>signal</code>, <code>red</code> и <code>green</code> в нём запрещены. Голое число <code>right_operand: 5</code> отклоняется. Строка, дробь и значение вне int32 тоже.</p>" },
              { html: "<p><code>null</code> означает «операнд не задан», а не ноль. В арифметическом незаданный обязательный операнд не создаёт выход. В сравнивающем условие с <code>null</code> ложно, но остаётся в выражении AND/OR.</p>" },
            ],
          },
          {
            id: "operands-signal",
            title: "Сигнал",
            blocks: [
              { html: "<p>Сигнальный операнд содержит ровно три поля: <code>red</code>, <code>green</code> и <code>signal</code>. Оба флага — логические <code>true</code> или <code>false</code>, не числа. Поле <code>constant</code> в этом объекте запрещено.</p>" },
            ],
          },
          {
            id: "operands-mask",
            title: "Маски",
            blocks: [
              { html: "<p>Флаги выбирают уже подключённые входы, а не создают провод. <code>red: true, green: false</code> читает только красный вход. Оба <code>true</code> складывают одноимённый канал двух цветов, как в <a href=\"#networks-colors\" data-doc-target=\"networks-colors\">примере цветов</a>. Оба <code>false</code> — пустой набор: обычный канал читается как 0. Левый и правый операнды выбирают маски независимо.</p>" },
            ],
          },
          {
            id: "operands-logic",
            title: "Связки",
            blocks: [
              { html: "<p>У сравнивающего каждое сравнение — элемент <code>conditions</code> с <code>left_operand</code>, <code>right_operand</code> и <code>operation</code>. Со второго элемента обязательна связка <code>logic</code>: <code>Decider.Logic.AND</code> или <code>Decider.Logic.OR</code>. У первого связки нет. AND связывает теснее OR: <code>A &gt; 0 OR B &gt; 0 AND C &gt; 0</code> считается как <code>(A &gt; 0) OR ((B &gt; 0) AND (C &gt; 0))</code>.</p>" },
              { html: "<p>Сравнения: <code>GT</code> &gt;, <code>LT</code> &lt;, <code>EQ</code> =, <code>GTE</code> &gt;=, <code>LTE</code> &lt;=, <code>NEQ</code> !=. Строка <code>\"GT\"</code> и операция другого устройства не подходят. Рабочий пример связок — в <a href=\"#decider-logic\" data-doc-target=\"decider-logic\">сравнивающем</a>.</p>" },
            ],
          },
        ],
      },
      {
        slug: "simulation",
        title: "Симуляция",
        lead: "Тик — граница опубликованных сетей. Постоянные источники видны сразу, вычисляемые устройства — со следующей границы.",
        related: [{ target: "networks-reading", label: "Чтение сети" }],
        seeAlso: [{ target: "quick-start-run", label: "Шаг первой схемы" }, { target: "debugger", label: "Отладчик" }],
        sections: [
          {
            id: "simulation-ticks",
            title: "Тики",
            blocks: [
              { html: "<p>Граница 0 собирает вклады, которые не ждут вычисления: постоянный источник и чтение хранилища. Арифметический, сравнивающий и выбирающий читают уже опубликованные входы и пишут выход на следующую границу. Лампа смотрит на ту же границу, которую читает, и сама в сеть не пишет.</p>" },
              { html: "<p>Правка текста снимает текущий прогон. Следующие «Запустить» и «Шаг» проверяют текст заново. Ошибочный текст не продолжает старый граф как актуальный.</p>" },
            ],
          },
          {
            id: "simulation-controls",
            title: "Запуск, пауза, шаг, назад и сброс",
            blocks: [
              { html: "<p>На пульте редактора: «Запустить», «Приостановить», «Шаг», «Шаг назад», «Сброс». «Запустить» публикует границу 0 и повторяет шаг, пока вы не нажмёте «Приостановить». Скорость — 1, 2, 4 или 10 тиков в секунду; она задаёт только паузу между шагами. Число в кнопке — выбранная скорость, подпись «тик/с» видна в списке.</p>" },
              { html: "<p>«Шаг» без прогона открывает границу 0, при открытом прогоне делает один шаг. «Сброс» возвращает прогон на границу 0. «Шаг назад» восстанавливает предыдущий снимок и не меняет текст. Недоступная кнопка остаётся на месте и не выполняет действие.</p>" },
            ],
          },
          {
            id: "simulation-initial",
            title: "Начальное состояние",
            blocks: [
              { html: "<p>Пока прогона нет, в таблице тик «—». Пустая сеть показывает «пусто», это не число 0. После запуска постоянный signal-A виден на границе 0 и на следующем шаге не прибавляется сам к себе. Пример удержания — у <a href=\"#constant-example\" data-doc-target=\"constant-example\">постоянного комбинатора</a>.</p>" },
            ],
          },
          {
            id: "simulation-feedback",
            title: "Обратная связь",
            blocks: [
              { html: "<p>Если выход подключён к входу той же сети, устройство на каждом шаге читает прошлый вклад и пишет новый. Задержки «внутри провода» нет: сеть обновляется границей тика. Счётчик ниже прибавляет 1 к signal-A в <code>green_count</code>. На границе 0 канала нет. После одного шага signal-A = 1, после трёх шагов <strong>signal-A = 3</strong>.</p>" },
              sample("feedback", "Конфигурация · обратная связь", "signal-A увеличивается на 1 каждый шаг"),
              { result: "Граница 0: канала signal-A нет. Шаг 1: signal-A = 1. Шаг 3: signal-A = 3." },
              { note: { title: "Количество растёт", html: "Так и задумано, пока выход возвращается во вход. Для одноразовой передачи используйте отдельную выходную сеть, как в <a href=\"#networks-ports\" data-doc-target=\"networks-ports\">подключении</a>." } },
            ],
          },
        ],
      },
    ],
  },
  {
    title: "Комбинаторы",
    articles: [
      {
        slug: "constant",
        title: "Постоянный комбинатор",
        lead: "Источник заданных количеств. Вклад есть уже на границе 0 и не накапливается на следующих шагах.",
        related: [
          { target: "networks-ports", label: "Подключение к сетям" },
          { target: "signals-counts", label: "Количества" },
          { target: "simulation-initial", label: "Граница 0" },
        ],
        seeAlso: [{ target: "quick-start", label: "Первая схема" }, { target: "storage", label: "Хранилище" }],
        sections: [
          {
            id: "constant-role",
            title: "Параметры",
            blocks: [
              { html: "<p><code>enabled</code> обязателен и должен быть логическим значением. Список сигналов — <code>signals</code>: массив пар <code>{ signal, constant }</code>. Входы указывать нельзя. Выходы можно опустить, тогда источник никуда не пишет.</p>" },
              { html: "<p><code>enabled: false</code> оставляет выход пустым, даже если список сигналов заполнен. Вместо <code>signals</code> можно задать <code>sections</code> с группой фильтров. Множитель секции поддержан только как число 1; другое число отклоняется до запуска.</p>" },
            ],
          },
          {
            id: "constant-example",
            title: "Пример",
            blocks: [
              sample("constantHold", "Конфигурация · постоянный", "signal-A = 12 на границе 0 и после шага"),
              { result: "Граница 0 и граница 1: red_1 signal-A = 12." },
              sample("constantOff", "Конфигурация · выключенный источник", "enabled: false не пишет signal-A"),
              { result: "Граница 0: сигнала signal-A нет." },
            ],
          },
          {
            id: "constant-limits",
            title: "Ошибки",
            blocks: [
              { error: { title: "Неполная пара сигнала", html: "В <code>signals</code> нужны и <code>signal</code>, и <code>constant</code>. Метасигнал в этом списке нельзя. Неизвестный путь подчёркивается и блокирует запуск." } },
            ],
          },
        ],
      },
      {
        slug: "arithmetic",
        title: "Арифметический комбинатор",
        lead: "Одна операция над двумя операндами и один выходной сигнал. Результат появляется на следующей границе.",
        related: [
          { target: "operands", label: "Операнды" },
          { target: "networks-colors", label: "Маска цветов" },
          { target: "simulation-ticks", label: "Задержка тика" },
        ],
        seeAlso: [{ target: "simulation-feedback", label: "Обратная связь" }, { target: "decider", label: "Сравнивающий" }],
        sections: [
          {
            id: "arithmetic-operation",
            title: "Операция и выход",
            blocks: [
              { html: "<p><code>operation</code> — константа <code>Arithmetic.Operation</code>: <code>SUM</code> +, <code>SUB</code> −, <code>MUL</code> *, <code>DIV</code> /, <code>MOD</code> %, <code>POW</code> ^, <code>SHL</code> &lt;&lt;, <code>SHR</code> &gt;&gt;, <code>AND</code>, <code>OR</code>, <code>XOR</code>. Строка <code>\"SUM\"</code> не подходит. Значение по умолчанию не подставляется.</p>" },
              { html: "<p><code>return</code> выбирает сигнал, в который записывается число. Если выходной сигнал не задан или оба выходных порта пусты, в сети ничего не появляется. Деление на ноль не публикует следующую границу.</p>" },
            ],
          },
          {
            id: "arithmetic-example",
            title: "Пример",
            blocks: [
              { html: "<p>Постоянный пишет signal-A = 10 в <code>red_1</code>. Арифметический прибавляет 2 и пишет signal-A в <code>green_1</code>. На границе 0 зелёная сеть пуста.</p>" },
              sample("arithmeticSum", "Конфигурация · сложение", "signal-A + 2"),
              { result: "Граница 0: red_1 signal-A = 10, в green_1 сигнала A нет. После одного шага green_1 signal-A = 12." },
            ],
          },
          {
            id: "arithmetic-limits",
            title: "Ошибки",
            blocks: [
              { error: { title: "Операнд не объект", html: "Пишите <code>{ constant: 2 }</code>, а не число 2. У сигнального операнда укажите оба флага. Общие правила — в <a href=\"#operands\" data-doc-target=\"operands\">операндах</a>." } },
            ],
          },
        ],
      },
      {
        slug: "decider",
        title: "Сравнивающий комбинатор",
        lead: "Проверяет условие и публикует одну из веток: when_true или when_false. Количество в ветке либо фиксированное, либо скопированное со входа.",
        related: [
          { target: "networks-ports", label: "Подключение к сетям" },
          { target: "operands-logic", label: "Связки AND и OR" },
          { target: "simulation-feedback", label: "Обратная связь" },
        ],
        seeAlso: [{ target: "quick-start", label: "Первая схема" }, { target: "problems-decider", label: "Неполный выход" }],
        sections: [
          {
            id: "decider-fixed",
            title: "Фиксированное количество",
            blocks: [
              { html: "<p>Фиксированный выход обычного сигнала — <code>{ signal, constant }</code>. Число не обязано быть единицей и не читается со входа. Цветовые флаги в эту пару не добавляют.</p>" },
              { html: "<p>В первой схеме вход <code>red_1</code> несёт signal-A = 12, выход <code>red_2</code> при A &gt; 0 получает signal-A = 1. Это не копия двенадцати.</p>" },
              sample("quickStart", "Конфигурация · фиксированный выход", "when_true с constant: 1"),
              { result: "После одного шага red_2 signal-A = 1 при signal-A = 12 на входе." },
            ],
          },
          {
            id: "decider-copy",
            title: "Копирование количества",
            blocks: [
              { html: "<p>Копия — <code>{ signal, red, green }</code>. <code>red: true</code> берёт красный вход, <code>green: false</code> зелёный не берёт. Копируется количество названного сигнала, а не того, который сделал условие истинным. Оба цвета складывают одноимённые вклады. Поля <code>constant</code> в этой форме нет.</p>" },
              sample("deciderCopy", "Конфигурация · копирование", "signal-A с красного входа в red_2"),
              { result: "После одного шага red_2 signal-A = 12." },
              { html: "<p class=\"fl-docs__caption\">Фрагмент <code>{ signal, red, green }</code> стоит внутри <code>Decider</code>. Сам по себе он схемой не является.</p>" },
            ],
          },
          {
            id: "decider-logic",
            title: "AND и OR",
            blocks: [
              { html: "<p>В примере на входе signal-A = 1 и signal-C = 1, сигнала B нет. Условие <code>A &gt; 0 OR B &gt; 0 AND C &gt; 0</code> истинно за счёт A. На следующем шаге <code>red_2</code> получает signal-D = 1.</p>" },
              sample("deciderAnd", "Конфигурация · AND и OR", "A &gt; 0 OR B &gt; 0 AND C &gt; 0"),
              { result: "После одного шага red_2 signal-D = 1." },
            ],
          },
          {
            id: "decider-branches",
            title: "Ветки when_true и when_false",
            blocks: [
              { html: "<p>Для обычного условия истинна одна ветка. <code>when_true</code> публикуется, когда всё выражение истинно, <code>when_false</code> — когда ложно. Пустая ветка и пропущенная ветка ничего не пишут. В примере A = 3 не больше 10, поэтому выходит signal-B = 2.</p>" },
              sample("deciderElse", "Конфигурация · ложная ветка", "A &gt; 10 ложно, when_false пишет 2"),
              { result: "Граница 0: red_1 signal-A = 3, в red_2 сигнала B нет. После одного шага red_2 signal-B = 2." },
              { html: "<p>Вход и выход здесь разные сети. Если соединить их в одну, количество может начать расти: см. <a href=\"#simulation-feedback\" data-doc-target=\"simulation-feedback\">обратную связь</a>.</p>" },
            ],
          },
          {
            id: "decider-errors",
            title: "Частые ошибки",
            blocks: [
              { error: { title: "Одного поля signal недостаточно", html: "Выберите один режим: <code>{ signal, constant }</code> либо <code>{ signal, red, green }</code>. Запись <code>{ signal }</code> блокирует запуск. Исправленные формы — выше." } },
              sample("brokenOutput", "Ошибка · неполный выход", "Неполная настройка when_true"),
              { html: "<p class=\"fl-docs__caption\">Этот фрагмент намеренно неверный. Диагностика — <code>invalid-output</code>, прогон не создаётся.</p>" },
              { html: "<p>Если условие ложно и заполнена только <code>when_true</code>, выходной сети сигнал не появляется. Если копируется сигнал, которого на выбранном входе нет, канала тоже нет. Оба случая разобраны в <a href=\"#problems-empty\" data-doc-target=\"problems-empty\">решении проблем</a>.</p>" },
            ],
          },
        ],
      },
      {
        slug: "selector",
        title: "Выбирающий комбинатор",
        lead: "Читает сумму красного и зелёного входов и на следующей границе публикует результат выбранного режима.",
        related: [
          { target: "networks-reading", label: "Сумма входов" },
          { target: "simulation-ticks", label: "Следующая граница" },
        ],
        seeAlso: [{ target: "examples", label: "Готовые примеры" }],
        sections: [
          {
            id: "selector-count",
            title: "Число каналов",
            blocks: [
              { html: "<p><code>Selector.Operation.COUNT</code> требует обычный <code>signal</code> и пишет в него число присутствующих каналов, а не сумму количеств. Ноль канал не создаёт. На входе signal-A = 100 и signal-B = −2 — это два канала.</p>" },
              sample("selectorCount", "Конфигурация · count", "Два канала во входе, signal-C на выходе"),
              { result: "Граница 0: red_items signal-A = 100 и signal-B = −2, red_count пуст. После одного шага red_count signal-C = 2." },
            ],
          },
          {
            id: "selector-select",
            title: "Выбор по индексу",
            blocks: [
              { html: "<p><code>SELECT</code> требует <code>sort</code> (<code>DESC</code> или <code>ASC</code>), <code>index</code> (константа или сигнал) и <code>compare</code>. Ранг 0 — первый в выбранном порядке. Один сигнал при индексе 0 проходит на выход со своим количеством.</p>" },
              sample("selectorPick", "Конфигурация · select", "Единственный signal-A, индекс 0"),
              { result: "Граница 0: red_2 пуст. После одного шага red_2 signal-A = 5." },
            ],
          },
          {
            id: "selector-limits",
            title: "Ограничения",
            blocks: [
              { html: "<p>Два канала с одинаковым количеством в <code>SELECT</code> дают неподдержанный случай, прогон такого шага не утверждается. Индекс вне диапазона при нескольких сигналах оставляет выход пустым. <code>RANDOM</code> с интервалом 0 отклоняется до прогона. Режимы качества доступны в профиле space-age, не в обычном base. <code>stack-size</code> и <code>rocket-capacity</code> не делают предмет из жидкости или виртуального сигнала. Режим <code>TIME</code> читает контекст мира схемы, а не часы компьютера.</p>" },
              { html: "<p>Это правила модели. Совпадение с игрой не заявлено: см. <a href=\"#compatibility\" data-doc-target=\"compatibility\">совместимость</a>.</p>" },
            ],
          },
        ],
      },
    ],
  },
  {
    title: "Другие устройства",
    articles: [
      {
        slug: "lamp",
        title: "Лампа",
        lead: "Смотрит на входы и не пишет сигналы. Рядом с хранилищем она не меняет количество в сети.",
        related: [{ target: "operands-signal", label: "Сигнальный операнд" }, { target: "storage", label: "Хранилище" }],
        seeAlso: [{ target: "networks-reading", label: "Чтение сети" }],
        sections: [
          {
            id: "lamp-condition",
            title: "Условие",
            blocks: [
              { html: "<p>Запись — <code>lamp имя = new Lamp({ ... })</code>. Обязательны одно <code>condition</code> и логическое <code>use_colors</code>. Условие содержит левый операнд, операцию <code>Lamp.Operation</code> и правый операнд. Выходных портов нет. При <code>use_colors: false</code> поле <code>color_mode</code> указывать нельзя. При <code>use_colors: true</code> нужен режим <code>mapping</code>, <code>components</code> или <code>packed</code>; сам режим по умолчанию не подставляется.</p>" },
              sample("storageLamp", "Конфигурация · лампа и хранилище", "Лампа читает red_bus и не добавляет сигнал"),
              { result: "Граница 0 и следующий шаг: red_bus signal-A = 4. Это вклад хранилища. Лампа отдельного сигнала не публикует." },
            ],
          },
          {
            id: "lamp-limits",
            title: "Ограничения",
            blocks: [
              { html: "<p>Несколько условий, метасигналы и логистическое условие в эту форму не входят. Неизвестные поля игрового поведения лампы отклоняются. Цвет наблюдается только при истинном условии и включённых цветах. Игровой прогон лампы не выполнялся.</p>" },
            ],
          },
        ],
      },
      {
        slug: "storage",
        title: "Хранилище",
        lead: "Источник заранее заданного содержимого. Вклад есть на границе 0 и повторяется, пока описание прогона не пересобрано.",
        related: [{ target: "constant", label: "Постоянный источник" }, { target: "signals-counts", label: "Пары количеств" }],
        seeAlso: [{ target: "lamp", label: "Лампа" }],
        sections: [
          {
            id: "storage-example",
            title: "Чтение списка",
            blocks: [
              { html: "<p>Запись — <code>storage имя = new Storage({ ... })</code>. Обязательны <code>enabled</code>, <code>mode: \"read\"</code> и <code>contents</code>. Входы запрещены. <code>enabled: false</code> публикует пустой вклад, список при этом остаётся в описании.</p>" },
              { html: "<p>В общем примере с лампой хранилище пишет signal-A = 4 в <code>red_bus</code> уже на границе 0. Шаг это число не увеличивает.</p>" },
              sample("storageLamp", "Конфигурация · хранилище", "mode read, signal-A = 4"),
              { result: "Граница 0: red_bus signal-A = 4. После шага количество то же." },
            ],
          },
          {
            id: "storage-limits",
            title: "Ограничения",
            blocks: [
              { error: { title: "Другие режимы", html: "<code>empty-slots</code>, <code>requests</code>, <code>enable</code>, <code>pipeline</code> и <code>temperature</code> отклоняются до прогона. Число в <code>contents</code> — количество сигнала, а не число занятых ячеек." } },
            ],
          },
        ],
      },
      {
        slug: "trains",
        title: "Станции и поезда",
        lead: "Упрощённое присутствие поезда на станции. Это не маршрут Factorio и не физика состава.",
        related: [{ target: "simulation-initial", label: "Граница 0" }, { target: "compatibility", label: "Граница модели" }],
        seeAlso: [{ target: "networks-ports", label: "Выход в сеть" }],
        sections: [
          {
            id: "trains-example",
            title: "Присутствие",
            blocks: [
              { html: "<p>Станция публикует виртуальный signal-T = 1, когда поезд стоит на ней. Сигнал отправления <code>depart</code> обязателен: поезд готовится уехать, когда сумма этого сигнала на входах больше 0. У поезда нет портов. Маршрут — имена станций, <code>transit</code> — целое число границ не меньше 1, <code>at</code> — индекс начальной станции.</p>" },
              sample("stationPresence", "Конфигурация · станция и поезд", "Поезд стоит на stop, в сети signal-T"),
              { result: "Граница 0: red_stop signal-T = 1. Поезд уже на станции, отдельного события прибытия на этой границе нет." },
            ],
          },
          {
            id: "trains-limits",
            title: "Ограничения",
            blocks: [
              { html: "<p>Чтение содержимого состава, лимит поездов, приоритет и включение остановки по условию не считаются. Два поезда с одной начальной станцией не создают прогон. Если два поезда оказались бы на одной станции в одном шаге, новая граница не публикуется и победитель не выбирается. <code>transit: 0</code> запрещён.</p>" },
            ],
          },
        ],
      },
      {
        slug: "event",
        title: "Событийный комбинатор",
        lead: "Сценарий в редакторе и на прямой странице. Блок не входит в игру и не делит прогон с обычными комбинаторами.",
        related: [{ target: "simulation-controls", label: "Шаг в редакторе" }, { target: "compatibility", label: "Не игровое устройство" }],
        seeAlso: [
          { href: "../event/index.html", label: "Страница сценария" },
          { target: "examples", label: "Список примеров" },
        ],
        sections: [
          {
            id: "event-editor",
            title: "Редактор события",
            blocks: [
              { html: "<p>В редакторе кнопка «События» в шапке панели кода открывает сценарий на той же странице, рядом с «Код» и «Сети». Адрес не меняется. Прямая страница <a href=\"../event/index.html\">сценария</a> тоже работает; «Обычные комбинаторы» возвращает к редактору. Прогон схемы и прогон сценария разные: сигналы в общей таблице принадлежат выбранному режиму. Текст сценария — JavaScript класса, который расширяет EventCombinator. Проверка отправляет модуль в Worker и не исполняет его в поле страницы. Черновик схемы в этой вкладке хранит только текст обычной конфигурации.</p>" },
              { html: "<p>Код занимает основную область. «Настройки и подключения» и «Состояние, сообщения и снимок» раскрываются под ним. Там остаются «Выполнять каждый тик», «Выполнять при изменении входов», начальное состояние JSON и лимит исполнителя в миллисекундах. Лимит — сколько хост ждёт ответ Worker. Это не длительность виртуального тика. Вход и выход одного цвета на стенде смотрят в одну сеть: следующий шаг читает уже опубликованный выход.</p>" },
              { html: "<p>На широком окне сети стоят справа от кода. На узком виден код, а кнопка «Сети» в заголовке открывает ту же таблицу. Скрытые настройки сохраняют введённые значения.</p>" },
            ],
          },
          {
            id: "event-example",
            title: "Запуск Arrival",
            blocks: [
              { html: `<p>Встроенный сценарий Arrival описан на странице так: ${EVENT_DEMO.expect} Нажмите «Проверить», дождитесь готовности, затем «Шаг». На границе 0 красная сеть пуста. На границе 1 в ней виден signal-A, а в состоянии блока <code>arrived</code> становится true.</p>` },
              { result: "Граница 0: красная сеть без сигналов. После одного шага signal-A = 1 и arrived = true." },
              { html: "<p>Короткая причина появляется у кода. Полный текст — по кнопке «Подробнее». «Снимок границы» в разделе состояния запоминает опубликованную границу и восстанавливает её без нового init. «Сброс» возвращает начальную границу. «Остановить» прерывает Worker и не является паузой редактора.</p>" },
            ],
          },
          {
            id: "event-limits",
            title: "Ограничения",
            blocks: [
              { html: "<p>Событийный блок не заменяет четыре игровых комбинатора. Его прогон не является прогоном схемы, открытой в редакторе. Общего состояния между этими экранами нет.</p>" },
            ],
          },
        ],
      },
    ],
  },
  {
    title: "Работа со схемой",
    articles: [
      {
        slug: "project",
        title: "Файл схемы",
        lead: "Страница схемы сохраняет определение в браузере, импортирует файл и экспортирует его. Импорт не запускает симуляцию.",
        related: [{ target: "editor-input", label: "Черновик редактора" }],
        seeAlso: [{ href: "../project/index.html", label: "Страница схемы" }],
        sections: [
          {
            id: "project-save",
            title: "Сохранение",
            blocks: [
              { html: "<p>Откройте <a href=\"../project/index.html\">схему</a>. Сохранение пишет определение в локальное хранилище этого браузера. Файл хранит идентификаторы сетей и устройств, сигналы, качество, профиль и текст сценария. Черновик поля кода в редакторе в этот файл сам не входит.</p>" },
            ],
          },
          {
            id: "project-import",
            title: "Импорт и экспорт",
            blocks: [
              { html: "<p>Импорт — обычный выбор файла. Версия проверяется до замены открытой схемы. Импорт не запускает сценарий и не подменяет уже идущий прогон редактора: это другой экран. Экспорт отдаёт файл определения. Ошибка версии или разбора остаётся текстом на странице.</p>" },
            ],
          },
          {
            id: "project-limits",
            title: "Что не общее",
            blocks: [
              { html: "<p>Редактор, отладчик, контур, сети и сценарий не показывают одну живую симуляцию. Открытое руководство тоже не меняет черновик и не делает шаг.</p>" },
            ],
          },
        ],
      },
      {
        slug: "examples",
        title: "Примеры",
        lead: "Готовые схемы четырёх устройств и сценарий Arrival. Строка примера открывает отладчик или страницу события.",
        related: [{ target: "debugger", label: "Отладчик" }, { target: "event", label: "Событие" }],
        seeAlso: [{ href: "../examples/index.html", label: "Страница примеров" }],
        sections: [
          {
            id: "examples-open",
            title: "Открыть пример",
            blocks: [
              { html: "<p>На <a href=\"../examples/index.html\">странице примеров</a> таблица называет устройства и ожидаемые границы. Переход ведёт в отладчик с выбранной схемой либо к сценарию Arrival. Ожидание в таблице — проектная модель, не отчёт о запуске игры.</p>" },
            ],
          },
          {
            id: "examples-separate",
            title: "Отдельный экран",
            blocks: [
              { html: "<p>Пример в отладчике не заменяет текст вашего редактора. Возврат в редактор показывает прежний черновик вкладки. Макет библиотеки интерфейса примеры не запускает и в это руководство не входит.</p>" },
            ],
          },
        ],
      },
      {
        slug: "network-screen",
        title: "Экран сетей",
        lead: "Отдельная страница создаёт, переименовывает и удаляет сети. Она не прогоняет текст комбинаторов редактора.",
        related: [{ target: "networks-create", label: "Имена сетей" }],
        seeAlso: [{ href: "../networks/index.html", label: "Страница сетей" }, { target: "editor", label: "Редактор" }],
        sections: [
          {
            id: "network-screen-use",
            title: "Что на странице",
            blocks: [
              { html: "<p><a href=\"../networks/index.html\">Сети</a> работают с объявлениями <code>wire</code> и постоянным источником. Запуск на этой странице не исполняет арифметический или сравнивающий текст редактора. Чтобы увидеть шаги комбинаторов, оставайтесь в <a href=\"../../index.html\">редакторе</a> или откройте <a href=\"../debugger/index.html\">отладчик</a>.</p>" },
            ],
          },
        ],
      },
      {
        slug: "debugger",
        title: "Отладчик",
        lead: "Прогон готовой схемы: выбор схемы и сети, шаг, шаг назад, сброс и таблица сигналов.",
        related: [{ target: "simulation-controls", label: "Те же действия шага" }, { target: "examples", label: "Откуда берутся схемы" }],
        seeAlso: [{ href: "../debugger/index.html", label: "Отладчик" }],
        sections: [
          {
            id: "debugger-controls",
            title: "Управление",
            blocks: [
              { html: "<p>На <a href=\"../debugger/index.html\">отладчике</a> выберите схему и сеть. Запуск, пауза, скорость, шаг и сброс вызывают один и тот же step(). Таймер задаёт только паузу между вызовами. Шаг назад восстанавливает сохранённую границу. Номер тика и сигналы — опубликованная граница проектной модели, не запуск Factorio. История хранит ограниченное число границ.</p>" },
            ],
          },
          {
            id: "debugger-view",
            title: "Что видно",
            blocks: [
              { html: "<p>Таблица — сигналы выбранной сети. У схемы «Порог» на границе 0 во входной сети signal-A = 5, выход пуст; после шага на выходе signal-B = 1. Схема «Ошибка расчёта» на делении на ноль не публикует новую границу. Неподдержанный режим не создаёт прогон и не называется совместимостью с игрой.</p>" },
            ],
          },
        ],
      },
      {
        slug: "circuit",
        title: "Контур",
        lead: "Короткий стенд постоянного и арифметического комбинаторов: шаг и сброс без редактора текста.",
        related: [{ target: "arithmetic", label: "Арифметический" }, { target: "constant", label: "Постоянный" }],
        seeAlso: [{ href: "../circuit/index.html", label: "Страница контура" }, { target: "editor", label: "Полный редактор" }],
        sections: [
          {
            id: "circuit-use",
            title: "Когда открывать",
            blocks: [
              { html: "<p><a href=\"../circuit/index.html\">Контур</a> — минимальный срез: постоянный источник и арифметика на общих сетях. Тики на странице проверяют проектную модель, а не запуск Factorio. Свой текст схемы сюда не подставляется. Для своего листинга используйте редактор. Прогон контура не продолжается на других страницах.</p>" },
            ],
          },
        ],
      },
    ],
  },
  {
    title: "Решение проблем",
    articles: [
      {
        slug: "problems",
        title: "Решение проблем",
        lead: "От симптома к правке. Общие правила остаются в своих статьях, здесь только развилка.",
        related: [{ target: "editor-errors", label: "«К месту»" }],
        seeAlso: [{ target: "compatibility", label: "Совместимость" }],
        sections: [
          {
            id: "problems-launch",
            title: "Симуляция не запускается",
            blocks: [
              { html: "<p>Кнопка «Запустить» не публикует границу, если в строке под кодом есть ошибка. Нажмите «К месту» или откройте «Список» и прочитайте код. Частые причины: синтаксис, неизвестный путь и неполный выход сравнивающего. Исправьте текст. Старый снимок, если он был, остаётся помеченным и не считается текущим прогоном.</p>" },
            ],
          },
          {
            id: "problems-unknown",
            title: "Неизвестное имя или сигнал",
            blocks: [
              { html: "<p><code>SSignal.Signals.signal_A</code> — опечатка. Нужен путь из каталога, например <code>Signal.Signals.signal_A</code>. Сеть вне вида <code>red_*</code> / <code>green_*</code> и сигнал не того профиля тоже отклоняются. Подсказка после точки показывает допустимый хвост пути.</p>" },
              sample("unknownPath", "Ошибка · неизвестный путь", "SSignal не является сигналом"),
              { html: "<p class=\"fl-docs__caption\">Фрагмент неверный. Диагностика — <code>unknown-path</code>. Замените <code>SSignal</code> на <code>Signal</code>.</p>" },
            ],
          },
          {
            id: "problems-decider",
            title: "Неполный выход сравнивающего",
            blocks: [
              { html: "<p>Объект только с <code>signal</code> не является ни фиксированным количеством, ни копией. Добавьте <code>constant</code> или оба флага <code>red</code> и <code>green</code>. Не смешивайте <code>constant</code> и флаги у обычного сигнала. Рабочие формы — в <a href=\"#decider-fixed\" data-doc-target=\"decider-fixed\">фиксированном выходе</a> и <a href=\"#decider-copy\" data-doc-target=\"decider-copy\">копировании</a>.</p>" },
              sample("brokenOutput", "Ошибка · { signal }", "Неполный when_true"),
            ],
          },
          {
            id: "problems-empty",
            title: "Нет выходного сигнала",
            blocks: [
              { html: "<p>Выход вычислителя виден только после шага. На границе 0 пустая выходная сеть — норма для сравнивающего и арифметического. Дальше проверьте ветку: если условие ложно и заполнена лишь <code>when_true</code>, сигнала не будет. В примере A = 12 не больше 100, signal-B не появляется.</p>" },
              sample("deciderSilent", "Конфигурация · ложное условие", "when_true не срабатывает"),
              { result: "После шага в red_2 сигнала B нет, во входе signal-A = 12." },
              { html: "<p>Копирование отсутствующего сигнала тоже оставляет выход пустым. Условие по A истинно, но копируется B, которого на красном входе нет.</p>" },
              sample("deciderCopyMissing", "Конфигурация · копия отсутствующего сигнала", "when_true копирует signal-B"),
              { result: "После шага в red_2 нет ни signal-B, ни signal-A." },
            ],
          },
          {
            id: "problems-feedback",
            title: "Количество растёт",
            blocks: [
              { html: "<p>Рост на каждом шаге значит, что выход вернулся во вход. Разведите сети, если нужна разовая передача, или оставьте петлю, если нужен счётчик. Разбор и числа — в <a href=\"#simulation-feedback\" data-doc-target=\"simulation-feedback\">обратной связи</a>: после трёх шагов signal-A = 3.</p>" },
            ],
          },
        ],
      },
    ],
  },
];

export function docArticles() {
  return DOC_GROUPS.flatMap((group) => group.articles.map((article) => ({ ...article, group: group.title })));
}
