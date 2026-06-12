---
name: adaptive-card-new-vs-continue
description: "Реализация выбора \"новый vs существующий пресейл\" через Adaptive Cards + улучшенный prompt"
metadata:
  type: project
  date: 2026-06-11
---

## Phase 1: Улучшенный prompt (выполнено)

**Файлы:**
- `orchestrator/n8n/prompts/presale-agent-workflow-Presale Agent.md` — новый `.md` файл с улучшенным prompt
- `orchestrator/n8n/workflows/presale-agent-workflow.json` — инжектирован через `inject-prompt.js`

**Что сделано:**
- Добавлен раздел `## FIRST STEP — Presale Selection` сразу в начале prompt (до Conversation Lifecycle)
- AI Agent теперь обязан спросить "new presale or continue existing?" перед intake
- Добавлены русские варианты вопросов
- Чёткие инструкции: использовать **SharePoint Agent Tool** для создания/списка пресейлов

## Phase 2: Adaptive Cards (выполнено)

**Изменённые файлы:**

1. **`microsoft-teams-bot/index.js`** — `/proactive` endpoint:
   - Принимает поле `attachments: [{ contentType, content }]`
   - Отправляет карточки через `MessageActivityType` вместо `MessageFactory.text()`
   - Обратно совместим — если attachments нет, отправляет текст

2. **`microsoft-teams-bot/src/bot.js`** — обработка `activity.value`:
   - Adaptive Card `Action.Submit` шлёт данные в `activity.value`, а не `activity.text`
   - Если `activity.text` пуст, падает на `activity.value` (JSON-строка)
   - Это позволяет n8n получать `{ intent: "new_presale" }` / `{ intent: "continue_presale" }`

3. **`orchestrator/n8n/workflows/presale-agent-workflow.json`** — новый Code node "Adaptive Card Builder":
   - Вставлен между Presale Agent → Format Reply
   - Детектирует по regex: если AI спрашивает про выбор пресейла → добавляет Adaptive Card с двумя кнопками
   - Teams Callback теперь также передаёт `attachments` в теле POST

**Как работает флоу:**
1. Пользователь пишет сообщение → n8n получает через webhook
2. Presale Agent (с новым prompt) спрашивает "new or continue?"
3. Adaptive Card Builder видит, что это вопрос выбора → оборачивает ответ в Adaptive Card с кнопками
4. Бот получает `{ reply, attachments }` → отправляет карточку в Teams
5. Пользователь кликает кнопку → Teams шлёт `{ value: { intent: "new_presale" } }` → bot передаёт как `message`
6. n8n получает `{ message: '{"intent":"new_presale"}' }` → AI Agent понимает, что это выбор

**Deploy:** перед деплоем запустить `node scripts/inject-prompt.js inject` в `orchestrator/n8n/`