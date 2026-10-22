// Runs before `npm run dev`: the dev server alone is only the screens. Warn loudly when the API is not running,
// otherwise the site waits for a server that nobody started.
const url = (process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:3001") + "/api/auth/options";
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(String(res.status));
  console.log("FightScore: backend отвечает (" + url + ").");
} catch {
  console.warn(
    "\n\x1b[33mFightScore: backend не запущен (" + url + ").\x1b[0m\n" +
      "Без него вход и данные не работают: страницы будут ждать сервер.\n" +
      "Запустите всё одной командой из корня репозитория: bash scripts/demo.sh start\n",
  );
}
