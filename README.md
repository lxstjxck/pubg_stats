# PUBG Ranked Overlay (OBS)

Простой оверлей для OBS, который показывает ranked-статистику игрока PUBG через API.

## Что делает проект

- Поднимает локальный сервер на `Express`
- Запрашивает данные ranked-режима из PUBG API
- Отдает красивый оверлей для OBS: `http://localhost:3000/overlay.html`

## Структура

- `server.js` - backend (Express + запросы в PUBG API)
- `public/overlay.html` - разметка оверлея
- `public/overlay.css` - стиль оверлея
- `public/overlay.js` - логика обновления данных

## Требования

- Node.js 18+
- PUBG API key (переменная окружения `PUBG_API_KEY`)

## Установка и запуск

1. Установить зависимости:

```bash
npm install
```

2. Задать API ключ.

PowerShell (только текущий терминал):

```powershell
$env:PUBG_API_KEY="YOUR_PUBG_API_KEY"
```

PowerShell (постоянно для пользователя):

```powershell
setx PUBG_API_KEY "YOUR_PUBG_API_KEY"
```

После `setx` открой новый терминал.

3. Запустить сервер:

```bash
npm start
```

4. Открыть оверлей:

```text
http://localhost:3000/overlay.html?platform=steam&player=YOUR_NICK&mode=duo-fpp
```

## Параметры URL оверлея

- `platform` - например: `steam`, `xbox`, `psn`
- `player` - ник игрока (обязательный)
- `mode` - например: `squad-fpp`, `duo-fpp`, `solo-fpp`
- `refresh` - интервал обновления в мс (по умолчанию `60000`)

Пример:

```text
http://localhost:3000/overlay.html?platform=steam&player=<player>&mode=<mode>&refresh=60000
```

## Добавление в OBS

1. `Sources` -> `+` -> `Browser`
2. Вставить URL оверлея
3. Включить прозрачный фон (он уже прозрачный в CSS)
4. Настроить ширину/высоту под сцену

## Важно

- Не коммить API ключ в код и README
- Лучше добавить `.env`/секреты в локальные переменные окружения
- `node_modules` не нужно хранить в Git
