/** Частота просмотра. Таймер вызывает один и тот же шаг и не меняет его смысл. */

export function createPlayback({ perform, schedule, interval, onChange }) {
  let mode = "paused";
  let generation = 0;
  let timer = null;
  let flight = null;
  let attempts = 0;
  let completed = 0;

  function notify() {
    onChange?.();
  }

  function setMode(next) {
    if (mode === next) return;
    mode = next;
    notify();
  }

  function clearTimer() {
    if (!timer) return;
    timer.cancel();
    timer = null;
  }

  function stopFuture() {
    generation += 1;
    clearTimer();
  }

  function queueNext(gen) {
    clearTimer();
    if (mode !== "running" || gen !== generation) return;
    timer = schedule(interval(), () => {
      timer = null;
      return cycle(gen);
    });
  }

  async function runStep() {
    if (mode === "failed") {
      const error = new Error("Выполнение остановлено");
      error.code = "playback-stopped";
      throw error;
    }
    if (flight) {
      const error = new Error("Шаг уже выполняется");
      error.code = "step-busy";
      throw error;
    }
    attempts += 1;
    const run = Promise.resolve().then(() => perform());
    flight = run;
    try {
      await run;
      completed += 1;
    } catch (error) {
      if (error && error.code === "step-busy") throw error;
      setMode("failed");
      stopFuture();
      throw error;
    } finally {
      if (flight === run) flight = null;
      notify();
    }
  }

  async function cycle(gen) {
    if (mode !== "running" || gen !== generation) return;
    try {
      await runStep();
    } catch {
      return;
    }
    queueNext(gen);
  }

  return {
    get mode() {
      return mode;
    },
    get pending() {
      return flight;
    },
    get attempts() {
      return attempts;
    },
    get completed() {
      return completed;
    },
    start() {
      if (mode === "failed" || mode === "running") return Promise.resolve(false);
      const gen = generation;
      setMode("running");
      return cycle(gen).then(() => mode !== "failed");
    },
    pause() {
      if (mode === "running") setMode("paused");
      stopFuture();
    },
    fail() {
      setMode("failed");
      stopFuture();
    },
    clearFailure() {
      if (mode === "failed") setMode("paused");
    },
    step() {
      if (mode === "running") {
        const error = new Error("Сначала поставьте просмотр на паузу");
        error.code = "playback-running";
        return Promise.reject(error);
      }
      return runStep();
    },
  };
}
