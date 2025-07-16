# deploy-hook

Простой сервер для автоматического деплоя через вебхук (например, из GitHub).

## Возможности
- Проверка подписи вебхука (HMAC SHA256)
- Запуск shell-скрипта деплоя при получении валидного запроса

## Установка
1. Клонируйте репозиторий:
   ```sh
   git clone <repo-url>
   cd deploy-hook
   ```
2. Установите зависимости:
   ```sh
   npm install
   ```

## Настройка
1. Создайте файл `.env` в корне проекта:
   ```env
   SECRET=your_webhook_secret
   PORT=3000
   ```
2. Убедитесь, что у вас есть скрипт `deploy.sh` в корне проекта (или измените команду в `index.js`).

## Запуск
```sh
npm start
```

## Использование
- Настройте ваш сервис (например, GitHub) на отправку POST-запросов на:
  ```
  http://<your-server>:<PORT>/webhook
  ```
- Вебхук должен содержать заголовок `X-Hub-Signature-256` с HMAC SHA256 подписью тела запроса.

## Пример deploy.sh
```sh
#!/bin/bash

echo "Deploy started"
git pull origin main
npm install
pm run build
pm restart
```

---

**Внимание:** Не забудьте добавить `.env` в `.gitignore` и не публикуйте секреты в публичный доступ! 