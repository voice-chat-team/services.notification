# Notification Service

NestJS-сервис уведомлений: PostgreSQL, Centrifugo и транспорт мобильных push через Firebase Cloud Messaging.

## Firebase Cloud Messaging

`FcmModule` экспортирует `FcmService` и подключён в `NotificationsModule`.
Firebase инициализируется при первой отправке; без Firebase-конфигурации существующие уведомления продолжают работать.

Настройте один из вариантов авторизации в `.env.development.local` (для `npm run start:dev`) или в окружении контейнера:

- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` из service account Firebase Admin SDK. Ключ поддерживает реальные переводы строк и последовательности `\n`.
- Application Default Credentials: `GOOGLE_APPLICATION_CREDENTIALS` — путь к JSON service account, доступному внутри процесса/контейнера. Оставьте `FIREBASE_CLIENT_EMAIL` и `FIREBASE_PRIVATE_KEY` пустыми. В Google Cloud можно использовать service identity без JSON-ключа.

Service account создаётся в Firebase Console → Project settings → Service accounts. В проекте должен быть включён Firebase Cloud Messaging API (HTTP v1). JSON-ключ храните вне репозитория и передавайте контейнеру через secret mount.
См. [настройку Admin SDK](https://firebase.google.com/docs/admin/setup).

Пример вызова из NestJS-провайдера с внедрённым `FcmService`:

```typescript
const messageId = await this.fcmService.sendToDevice(fcmToken, {
  title: 'Приглашение в гильдию',
  body: 'Вас пригласили присоединиться',
  data: { notificationId: 'notification-uuid', type: 'NEW_INVITE_TO_GUILD' },
});

const result = await this.fcmService.sendToDevices(deviceTokens, {
  title: 'Приглашение в гильдию',
  body: 'Вас пригласили присоединиться',
});
// result: successCount, failureCount, results, invalidTokens
```

Методы принимают FCM registration token, полученный Firebase SDK мобильного приложения, а не APNs device token. Третий аргумент `true` включает `dryRun`: Firebase валидирует сообщение без доставки. `data` содержит только строковые значения; объекты предварительно сериализуйте в JSON.

Одинаковые токены удаляются, рассылка выполняется последовательно пакетами до 500 токенов. `results` соответствует порядку уникальных токенов. Только ошибки `messaging/invalid-registration-token` и `messaging/registration-token-not-registered` попадают в `invalidTokens`; временные сбои и ошибки payload не являются основанием удалять токен. Ошибки SDK на уровне запроса пробрасываются вызывающему коду. Если поздний пакет упал, предыдущие уже могли быть отправлены: повтор всей рассылки может дать дубли. Автоматических повторов и очереди здесь нет. ID сообщения означает принятие Firebase, а не подтверждение доставки устройству.

Транспорт отправляет видимые уведомления (`title` + `body`) с Android high priority, APNs alert и стандартным звуком. Поля `android`/`apns` позволяют задать channel ID, badge, TTL и другие платформенные параметры. Для тихих background push нужен отдельный payload.

Для Android добавьте приложение в Firebase и настройте клиентский SDK, разрешения на уведомления и notification channel. Для iOS дополнительно включите Push Notifications capability и загрузите APNs authentication key в Firebase Console → Project settings → Cloud Messaging. См. [настройку iOS](https://firebase.google.com/docs/cloud-messaging/ios/get-started).

## Регистрация мобильных устройств

Токены хранятся в таблице `push_devices` notification service. Пользователь может иметь несколько устройств. `deviceId` — случайный UUID, который мобильное приложение создаёт один раз для установки и сохраняет локально. При обновлении FCM-токена `deviceId` остаётся прежним.

API Gateway предоставляет защищённые методы:

| Метод    | URL                    | Назначение                                     |
| -------- | ---------------------- | ---------------------------------------------- |
| `PUT`    | `/notification/device` | Зарегистрировать устройство или обновить токен |
| `DELETE` | `/notification/device` | Удалить привязку устройства при выходе         |

Тело `PUT`:

```json
{
  "deviceId": "30d190be-4498-42bc-8da3-e5eb816c5797",
  "token": "FCM_REGISTRATION_TOKEN",
  "platform": "android"
}
```

Для iOS укажите `"platform": "ios"`. Тело `DELETE` содержит `deviceId` и текущий `token`. Оба метода возвращают `{ "status": true }`. `userId` gateway получает из авторизации, передавать его в теле не нужно. Между gateway и notification service используются `RegisterPushDevice` и `UnregisterPushDevice` из `@voice-chat/contracts@1.6.1`.

После входа отправляйте `PUT`, повторяйте его при обновлении токена Firebase и при смене аккаунта. Регистрация заменяет текущего владельца и токен установки атомарно; один токен не может быть привязан к нескольким устройствам. `DELETE` вызывайте до завершения logout, пока авторизация действительна. Повторное удаление успешно; запрос старого аккаунта или со старым токеном не удалит новую привязку.

`PushDevicesModule` экспортирует `PushDevicesService`. Для отправки пользователю можно получить токены через `getTokensByUserId(userId)`, вызвать `FcmService.sendToDevices()`, затем передать `result.invalidTokens` в `removeInvalidTokens(userId, tokens)`. Этот шаг регистрации ещё не включает автоматическую отправку push из `sendNotification`.

Перед запуском обновлённого сервиса примените миграции: `npx prisma migrate deploy`. В Docker эта команда уже выполняется при запуске контейнера. Prisma Client обновляется командой `npx prisma generate`.

Проверка сборки: `npm run build`.

## Push новых сообщений

После сохранения сообщения `services.messages` вызывает `EnqueueMessagePush` по gRPC и ждёт только сохранения задания (таймаут 2 секунды). Ошибка передачи записывается в лог и не мешает отправке сообщения. Outbox для push в messages нет: при недоступности notification service или падении между сохранением сообщения и вызовом gRPC push может потеряться. Realtime-outbox Centrifugo работает независимо.

Notification service сохраняет задание в `message_push_jobs`; повторный запрос с тем же `messageId` не создаёт новое задание и не сбрасывает прогресс. Обработчик запускается после приёма задания и опрашивает очередь раз в секунду, включая задания после перезапуска процесса. Для нескольких экземпляров используется аренда строки через `FOR UPDATE SKIP LOCKED`.

Перед отправкой каждого пакета обработчик получает актуальный список пользователей с доступом к каналу через guild service, исключает автора и заново загружает токены устройств. Успешные и окончательно ошибочные устройства сохраняются в задании и при повторе пропускаются. Только невалидные/незарегистрированные токены удаляются, причём с проверкой текущего пользователя и значения токена. Временные ошибки повторяются с backoff и jitter. Коды ошибок сохраняются в `last_error`; текст сообщений и токены в лог не попадают.

Задание актуально 5 минут с момента создания сообщения (этот же срок передаётся Android/APNs), число попыток ограничено 10. Обработанные и истёкшие задания хранятся 7 дней, затем удаляются. Подтверждение FCM означает принятие сообщения, а не показ на устройстве. Если процесс упал после отправки в FCM, но до сохранения прогресса, повторный push возможен.

Push содержит короткое превью и строковые `type: MESSAGE_CREATED`, `messageId`, `guildId`, `channelId`, `senderId`. Сообщения с вложениями без текста получают превью «Вложение». Правки, удаления и реакции не создают push-заданий; уже принятое задание хранит превью исходного сообщения. Mute, presence, группировка и отмена push при последующем удалении сообщения в эту версию не входят.

Для запуска:

- Используется `@voice-chat/contracts@1.6.2`, установленный в notification и messages.
- В окружении messages указать `NOTIFICATION_GRPC_URL` (адрес notification service, порт 5056).
- В окружении notification указать `GUILD_GRPC_URL` (адрес guild service, порт 5054), credentials Firebase и PostgreSQL.
- В notification service выполнить `npx prisma migrate deploy` перед запуском обработчика. Миграция создаёт только таблицу заданий; схема messages не меняется.

Новые RPC предназначены для внутренних вызовов сервисов; HTTP-маршрут отправки push в gateway не добавляется.
