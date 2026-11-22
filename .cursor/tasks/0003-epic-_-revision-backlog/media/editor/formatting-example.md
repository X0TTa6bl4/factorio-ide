# Пример форматирования от 22.11.2026

Нормализованы только артефакты вставки (`\`, `&#x20;`, `&#x9;`) и отступы. Опечатка `SSignal` сохранена: это пример для подчёркивания ошибок, не предложение автоматически исправлять имена.

```js
Constant({
	enabled: true,
	red_output: red_1,
	signals: [{ signal: Signal.Signals.signal_A, constant: 1 }]
})

Decider({
	red_input: red_1,
	red_output: red_1,
	conditions: [{
		left_operand: { red: true, green: false, signal: Signal.Signals.signal_A },
		right_operand: { constant: 59 },
		operation: Decider.Operation.LTE
	}],
	when_true: [{ signal: SSignal.Signals.signal_A, constant: 1 }]
})
```

Дополнение пользователя: если в массиве больше одного элемента, каждый элемент пишется с новой строки. Пример ожидаемой структуры:

```js
signals: [
	{ signal: Signal.Signals.signal_A, constant: 1 },
	{ signal: Signal.Signals.signal_B, constant: 2 }
]
```

Для теста сохранения модели подготовить валидный контекст с объявлением `red_1` и исправить только в тестовой копии `SSignal` на `Signal`.
