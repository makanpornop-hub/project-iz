# Результаты проверки

Дата: 10 сентября 2026 года.

## Выполнено

- Production-сборка Next.js и проверка TypeScript.
- Автоматические проверки: 18 успешных результатов (17 сценариев и родительская группа).
- Проверки SQL выполнены на изолированном движке PostgreSQL/PGlite через PostgreSQL-протокол. Тесты не используют реальные данные клиентов.
- S3 в автоматических проверках заменён локальным тестовым HTTP-хранилищем. Проверены сохранение версий и очистка файла при отказе операции.
- В браузере: вход тестового администратора, создание дела, открытие карточки, создание задачи с локальным сроком и завершение задачи.
- В браузере: отображение карточки при ширине 390 px, раскрытие мобильного меню.
- Проверены оба необязательных инструмента WebMCP: поиск дел и чтение дела, включая отказ на неверном вводе.
- Проверено отображение экрана первого запуска без настроенного подключения. В интерфейсе нет встроенных демонстрационных клиентов.

## Автоматические сценарии

1. Просрочка не заменяет рабочий статус; завершённые и отменённые записи не просрочены.
2. Дата без времени преобразуется в 18:00 часового пояса компании.
3. Уведомление «сегодня» назначается на 09:00 местного времени.
4. Два визовых дела используют одну запись человека.
5. Чужое дело недоступно через список, карточку и прямую проверку доступа.
6. Назначение задачи даёт доступ к делу, завершение убирает доступ, полученный только через задачу.
7. Повторное открытие и перенос срока отменяют старые напоминания.
8. Нельзя закрыть дело с незавершёнными задачами.
9. Неверный формат файла и превышение размера отклоняются.
10. Новая версия сохраняет старый файл и не наследует одобрение.
11. Уникальность номера версии обеспечивается базой.
12. Журнал действий запрещает UPDATE и DELETE.
13. Повтор одного Telegram update не создаёт вторую запись.
14. Устаревшее напоминание отменяется перед попыткой доставки.
15. Недоступный Telegram сохраняет внутреннее уведомление и повторную попытку.
16. Блокировка сотрудника удаляет сессии и запрещает его авторизацию в бизнес-операциях.
17. Активный сотрудник входит по паролю; публичная регистрация отклоняется.

## Требуют реальных сервисов и отдельной проверки

- Сборка и запуск полного Docker Compose: Docker в этой среде отсутствует.
- Настоящие PostgreSQL, MinIO/S3 и проверка файлов ClamAV совместно.
- Отправка приглашений и восстановление пароля через выбранный SMTP.
- Привязка настоящего Telegram-аккаунта, webhook, получение файлов и доставка в Backup Chat.
- Согласованное восстановление реальной базы и файлов из резервных копий.
- Нагрузочная проверка, конкурентные загрузки на многопользовательском PostgreSQL, отказоустойчивость выбранного сервера.
- Развёртывание с HTTPS и доменом компании.

Проверка интерфейса на временной базе не подтверждает перечисленные внешние интеграции. Бот, сервисы и сервер не подключались без реквизитов владельца. Реальные письма и сообщения никому не отправлялись.

## Границы первой реализации

- У сотрудника одна роль с настраиваемым набором permissions.
- Старые версии сохраняются, документы архивируются обратимо; окончательное удаление отсутствует.
- Просмотр истории действий и уведомлений ограничен последними записями (100 в деле, 200 уведомлений, 300 в общем журнале); сами записи в БД не удаляются.
- Первичный выбор существующих клиентов показывает до 200 доступных записей; отдельное визовое дело всегда можно найти в списке с поиском и пагинацией.
- При редком сбое после внешней отправки Telegram до записи результата возможен дубль сообщения. Строго однократная внешняя доставка не обещается.
- Остановка процесса во время записи файла может оставить объект без метаданных; для рабочего хранилища нужен регламент сверки объектов и записей перед удалением любых «сирот».
- Копии и хранилище в Compose находятся на одном компьютере. Для production нужны отдельные защищённые резервные копии по согласованному регламенту.

Тестовый пароль из `scripts/qa-database.ts` предназначен исключительно для временной базы в памяти. Этот скрипт не участвует в обычном запуске и не создаёт рабочий аккаунт.

## Реальная установка Windows — 11 сентября 2026

- Production-сборка успешно собрана; Windows-ссылки standalone преобразованы в junction внутри проекта.
- PostgreSQL 17.11: миграции применены, отдельная роль приложения без superuser, администратор создан.
- Реальный HTTP-вход и интерфейс администратора проверены; запрос без сессии отклоняется; cases/clients/tasks/dashboard возвращают 200 после входа.
- MinIO: официальная SHA-256 совпала, приватный bucket с versioning; запись и чтение проверочного объекта совпали побайтно, проверочная версия удалена.
- ClamAV 1.4.6: daily/main/bytecode получены через freshclam; реальное сканирование файла успешно. Фоновый freshclam запущен.
- Локальный SMTP Mailpit принимает подключения. Внешняя доставка не подключена.
- Telegram getMe успешен: @Withyou1313_bot. Webhook отсутствует; запущен отдельный receiver с долговременным сохранением updates и одиночной блокировкой PostgreSQL. Обмен с личным аккаунтом требует нажатия Start по ссылке из профиля.
- START/STOP проверены реальным перезапуском. BACKUP создал копию, pg_restore восстановил её в отдельную базу; наличие администратора и отсутствие тестовых клиентов подтверждены. Проверочная база удалена.
- TypeScript проверка после добавления локальных сценариев пройдена.
- Telegram-группы, доставка внешней почты, доступ извне, резервирование на другой диск не подключены.

## Управление паролями сотрудников

Добавлен интеграционный сценарий: создание сотрудника с паролем, вход, проверка хеширования, отсутствие почтового приглашения при заданном пароле, запрет операции обычному сотруднику, проверка длины пароля, запрет смены собственного пароля через административный метод, завершение сеансов, аннулирование прежних ссылок восстановления, отказ со старым паролем и успешный вход с новым. Все 19 тестов пройдены. Тесты выполнялись на изолированной базе без изменения рабочих сотрудников.

## Раздел партнёров — 14 сентября 2026

Миграция 003 создаёт partner_groups и partners и право can_manage_partners. Перед применением сохранена копия рабочей базы в .data/before-partners-*.dump. Добавлен интеграционный сценарий создания двух групп, сохранения контактных полей и многострочных заметок, изменения названия группы, переноса контакта, проверки пустых названий/некорректного email/несуществующей группы, запрета редактирования обычному сотруднику и записи аудита. Все 20 тестов пройдены; TypeScript и production-сборка пройдены. Тестовые партнёры создавались только в изолированной базе.

## ВНЖ Испания — 14 сентября 2026

Добавлена миграция 004, шаблон 15 групп, задачи, поля, сохранение порядка полей и source_version_ids для результатов объединения. Автоматические сценарии проверяют обязательный дедлайн, транзакционное создание двух задач и всех групп, дублирование справки, отметку печати, все обязательные загрузки, порядок страниц в реально собранном PDF (оригинал исключён), сохранение результата как проверяемой версии, устаревание результата при замене источника, запрет ручной загрузки в поле результата, запрет изменений после отправки, уведомление администратора, запрет согласования сотрудником и завершения через обычный статус, одобрение и возврат, редактирование групп/заметок, защиту полей чужой группы и исключение задач без срока из календаря. Пройдены 22 теста на изолированной базе с тестовым S3. До миграции сохранён before-spain-workflow-*.dump в .data. Реальные клиентские дела тестами не изменяются.

## Просмотр и статусы документов — 15 сентября 2026

Добавлено окно просмотра PDF/JPG/PNG через локальный blob URL, отзываемый при закрытии. Только файлы со статусом ClamAV clean доступны к просмотру. Новый POST document.open сохраняет переход Uploaded → Under review только для администратора; повторное открытие не снижает Approved. Подтверждение документов перечня ограничено администратором, требует просмотра и проверки актуальной версии. Итоговое одобрение пакета требует подтверждения документов и результатов. Тест сценария ВНЖ расширен: проверены отсутствие изменения статуса при просмотре сотрудником, отказ подтверждения сотрудником и без предварительного просмотра, переходы по каждой версии и отсутствие сброса при повторном просмотре. Все 22 теста и production-сборка пройдены. Добавлены двухколоночный компактный перечень и progress обязательных загрузок.

## Клиенты, Telegram и ZIP — 15 сентября 2026

Добавлено автозаполнение имени, телефона и email при выборе клиента; страна, виза и ответственные не меняются. В Telegram выбор дела ведёт к актуальным группам и полям перечня; выбор поля сразу ставит загрузку в очередь. Проверены сохранение новой версии, защита от повторных/устаревших нажатий, запрет загрузки в выходной PDF и закрытый перечень. Реальные сообщения Telegram в тестах не отправлялись.

Перечень использует независимые CSS-колонки. Кнопка «Готово» использует общий с сервером список ошибок, подсвечивает поля и переводит фокус к первому незаполненному обязательному полю. Миграция 005 добавляет workflow_archives. ZIP сохраняется в объектном хранилище вместе со списком исходных версий; при неуспешной транзакции объект удаляется или ставится в очередь удаления. Проверены содержимое ZIP, число файлов, группировка, совпадение байтов с исходными версиями, запрет скачивания без доступа и при блокировке исходного документа, новый архив при повторной отправке.

Все 23 теста и проверка TypeScript прошли. Production-сборка завершена, Windows standalone подготовлен, сайт и все службы перезапущены. Проверены готовность /api/health, вход администратора, поля контактов клиентов, получение трёх рабочих перечней и отказ без авторизации для ZIP. Рабочие документы не изменялись. Перед миграцией сохранена .data/before-workflow-zip-2026-09-15T13-15-54-690Z.dump. Визуальная проверка в браузере инструментами недоступна.

## 2026-09-19: валюты и баланс клиента
- 40 автоматических проверок прошли, включая точный пересчёт, границу 50 USD, фиксацию курса при редактировании, корректировки/повтор запроса и фильтр расходов клиента.
- ESLint и производственная сборка Next.js с проверкой TypeScript завершены успешно.
- Миграция 007 применена после резервной копии .data/before-accounting-2026-09-19T11-56-54-073Z.dump.
- Реальные курсы ЦБ загружены, почасовая задача синхронизации выполнена.
- Проверены готовность сайта, HTTP 200 страницы бухгалтерии, HTTP 401 API без входа, данные баланса и фильтрация по клиенту.
- Проверка интерфейса после входа в браузере не выполнялась: доступной авторизованной вкладки нет. Пароли не читались и не менялись.

## Уточнение обзора бухгалтерии дела
- Кнопки валют UZS/USD/EUR пересчитывают отображение по последнему курсу ЦБ, не меняя записи операций.
- Порядок формы: валюта договора, договорённая сумма, первичный взнос, дедлайн при неполной оплате. Выбор ответственного из формы удалён.
- Новый первичный взнос сохраняется атомарно вместе с договором; существующий редактируется через платежи. При полной оплате сервер не сохраняет дедлайн, карточка дедлайна скрывается.
- 42 автоматические проверки пройдены. ESLint, TypeScript и производственная сборка успешны. Сайт перезапущен и проверен.

## 2026-09-20 — языки интерфейса
Добавлены Ўзбекча, O‘zbekcha, Русский, English, Español. Переключатель находится справа вверху, доступен на странице входа и внутри CRM. Выбор сохраняется в браузере. Словарь содержит 544 строки; данные не отправляются внешним переводчикам.
Названия групп документов, полей и файлов исключены из перевода; для отображаемых названий добавлен translate=no. Значения полей, идентификаторы, статусы в базе и API не меняются.
Проверки: 45 тестов прошли; после исправления атрибутов формы повторно прошли три языковые проверки, производственная сборка и TypeScript. Готовность сайта подтверждена. В браузере проверены все пять языков на форме входа и сохранение английского после перезагрузки; затем возвращён русский. Проверка авторизованных страниц браузером не проводилась — доступной сессии нет.
Основные файлы: src/components/language.tsx, src/lib/i18n.ts, src/lib/translations.json. Неизвестные тексты и пользовательские данные сохраняются в исходном виде.

## 2026-09-20 — ZIP delivery and editing after submission
- Migration 008 adds archive destination/delivery timestamps and per-part delivery receipts.
- Ready queues an immutable ZIP snapshot for Telegram channel -1004356519137. Repeated submission reuses the archive; failed delivery can be retried with Ready. Existing submitted archives can also be queued.
- Document uploads, group changes, and notes remain editable after submission or approval; edits reopen the checklist task. Telegram uploads follow the same rule. Closed visa cases remain protected.
- Archives larger than 48 MB split into independently extractable ZIP parts. Successful parts are recorded for retries.
- All 48 tests, TypeScript and ESLint passed. Tests cover delivery using a mocked Telegram endpoint, repeat delivery, editing/re-submission, Telegram upload after submission and split archive preservation.
- Live read-only Telegram check confirmed the bot is an administrator with can_post_messages=true. No customer documents were sent as a test.
- Database backup: .data/before-accounting-2026-09-20T18-17-16-829Z.dump.

## 2026-09-21 — Case chat and document correction discussions
- Migration 009 adds version-bound correction threads, case messages, replies, mentions, read receipts, and notification links.
- Case access is checked for reads and mutations. Only active case participants can be mentioned or assigned. Attachments are scoped to the case, exclude accounting receipts, and require document download permission.
- Uploading a new version moves unresolved remarks to review, records the exact replacement, and notifies participants. Only an administrator with review permission can accept the latest clean version; the original attachment remains unchanged.
- UI includes Chat tab, file forwarding, Report issue in checklist and preview, unresolved counts, filtering, replies, attachments, mention selection, paginated history, and direct notification links. Labels translated to all five interface languages.
- Validation: all 49 tests passed; TypeScript, ESLint and production build passed.
- An isolated PGlite database and fake object storage were used for HTTP end-to-end testing with invented users and client. Sign-in, issue creation, reply, upload, original version preservation, admin acceptance, notifications, page HTTP 200, and unauthorized HTTP 401 passed.
- No real client messages or documents were changed by testing. Temporary test server stopped after verification.
- Browser visual verification was blocked by the automatic permission reviewer; later browser tool unavailable. No visual completion claim.
- Production ready=true after deployment. Backup: .data/before-accounting-2026-09-20T19-04-48-886Z.dump.

## 2026-09-21 — Unified chat hub
- Added /chats to the left navigation, combining direct conversations, user-created groups and accessible visa case chats.
- List supports search, type filters, unread counts and pagination. New direct conversations reuse the existing conversation for the same pair.
- Group creator can rename the group and change participants. Access is membership-based, including for administrators. Removed members lose chat API and notification access.
- Messages support replies, read receipts and notification links; case conversations reuse the existing versioned-document discussion component.
- Migration 010 applied after backup .data/before-accounting-2026-09-21T13-57-52-037Z.dump.
- All 50 tests passed; TypeScript, ESLint and production build passed.
- Authenticated HTTP verification against an isolated temporary database passed: direct chat reuse, messages/replies, unread counts, group creation/removal, case chat listing, notification links, unauthenticated 401 and /chats 200.
- Temporary test processes stopped; no production chats or customer messages created by tests. UI browser appearance was not visually verified.

## 2026-09-24 — Chat scrolling and clipboard screenshots

- /chats fits the dynamic viewport. Conversation list and messages scroll independently; the workspace footer is hidden on this route. Removed the nested main element and page navigation controls.
- Conversation batches use an opaque timestamp/UUID/kind cursor with microsecond precision. A scroll sentinel loads subsequent batches, deduplicates results, and handles search/filter changes and retries. Background refresh does not replace the list while reading further down.
- Ctrl+V pastes a PNG/JPG screenshot into a removable local preview. Enter sends, Shift+Enter inserts a line break, held Enter and IME composition do not resubmit. Supported in direct, group and case conversations, including photo-only messages.
- Chat photos use separate private storage records and do not change client document checklists. Uploads verify actual file type/size, run the existing antivirus scanner and recheck chat access. Image-only messages, upload/message retries, image ownership, target chat and current participant access are validated.
- Migration 011_chat_images.sql applied after backup .data/before-accounting-2026-09-24T17-40-05-374Z.dump.
- Validation: 53 automated tests pass; ESLint, TypeScript and production build pass. Cursor test reaches all 123 records with timestamp ties while a newer conversation arrives.
- Isolated browser/HTTP verification: actual Ctrl+V and Enter send a 360x200 synthetic PNG in direct, group and case chats; removal of a draft, photo-only sending, Shift+Enter, loaded image and opening preview pass. Browser infinite scroll expands 50 → 100 → 126 unique conversations. At 1280x720 page scrollHeight equals 720; at 390x844 page width/height equal viewport and composer remains inside it. Existing room HTTP access tests pass. No test messages were sent to real employees or Telegram.
- Follow-up: removed the workspace top bar (breadcrumbs, language/date/profile controls) only on the Chat route, as requested. The chat panels expand into the freed space.

## 2026-09-28 — Case follow-up and consistent stages
- Dashboard pipeline uses all caseStatuses, matching the case list including Additional request and Cancelled.
- Documents Done validates the checklist, then asks for a company-calendar check date. Saving creates/reuses the ZIP, immediately moves the case to Additional request and schedules a 09:00 reminder to the responsible employee. The new tab shows date, employee, ZIP and allows rescheduling.
- Durable jobs recheck revision, stage, assignment and employee permissions. Date changes cancel stale jobs. Telegram reminder is generic; details stay in CRM notifications.
- 60 automated tests, ESLint, TypeScript and production build passed. Migration 012 applied after .data/before-accounting-2026-09-28T12-29-16-412Z.dump.
- Isolated browser/HTTP verification: Done/date dialog, immediate transition, date update 02→03 October, 39-file ZIP download, one archive, old reminder cancellation and one pending reminder. Unauthenticated download denied. No test messages sent to real Telegram recipients.
- Chat page heading removed; desktop 1280x720 and mobile 390x844 have no page overflow, mobile navigation remains accessible.

## 2026-10-05 — User-requested clean reset
- Added Better Auth username sign-in alongside email sign-in (migration 013). Login form accepts Admin as requested. Username authentication uses the same password hashing, sessions, rate limits and active-staff check.
- Username sign-in, wrong password, blocked account and existing email login tested in the isolated integration suite; all 36 relevant integration/language tests passed. ESLint and production build with TypeScript passed.
- Reset the local iz database transactionally, reapplied all migrations/default roles and created one administrator. Removed all previous business records, users, sessions, chat content, notifications, files and payment data from the active CRM. Case numbering starts again at 1.
- Pre-reset database and object/mail storage retained at .data/reset-backup-2026-10-05T18-41-55-688Z. Active storage is a newly initialized private bucket. Password is stored only as a hash in the active database.
- Final live verification: Admin username/password accepted in browser; dashboard totals/history are empty. All 26 checked business-data tables have zero rows, exactly one active administrator remains, case identity is reset to 1, private storage has no objects/versions and health returns ready=true.

## 2026-10-06 — Case creation finance, DOCX contracts and task pages
- New-case deadline date and time are separate; default time is 08:05 in company timezone. Case API date-only input uses the same default while existing generic deadlines retain 18:00.
- Task titles and editing links open /tasks/:id. Employees see assignment as text and can save ticket date/status; only Administrator/Manager with assignment permission can change responsible/escalation, enforced on the server. Revision checking protects concurrent edits.
- New-case finance accepts UZS/USD/EUR total, initial deposit, payment method and balance deadline. Full deposit clears the deadline. Finance, initial payment, generated contract and case creation share one transaction; failed creation cleans generated object storage.
- Migration 014 adds immutable private contract templates and generated contracts. Admin imports own DOCX, checked for archive bounds, required tokens and antivirus. Renderer substitutes client name, company-calendar date, total, initial amount and currency across fragmented Word runs and repeated headers/footers while preserving existing XML/assets. Contract access requires case, financial and download permissions.
- All 63 automated tests, ESLint, TypeScript and production build passed. Actual Windows preparation script verified after fixing file-vs-directory symbolic-link removal.
- Backup before migration: .data/before-accounting-2026-10-06T18-39-44-641Z.dump.
- Isolated PGlite/fake S3/scanner/browser verification: DOCX upload and download, full-deposit deadline hiding, partial-payment due date, created case deadline 25 October 08:05, total 10m UZS and initial 4m UZS, final attached DOCX with correct name/date/amounts, task page and employee date save. HTTP checks reject unauthenticated/staff contract downloads, employee reassignment, invalid templates and staff template import. No synthetic records/files were inserted into the production CRM and no real Telegram test messages sent.
- Final production health ready=true and real Admin sign-in verified. Own production template remains unconfigured until administrator imports it. Visual proof saved in docs/task-page.png and docs/contract-settings.png.

## 2026-10-07 — Separate settings pages and Telegram destinations

- Added administrator-only /settings/contracts and /settings/telegram, linked from Settings with return navigation. Contract import instructions and current template live on their own page.
- Telegram page manages ZIP, document backup, team and finance destinations; backup/team switches moved there. IDs use group/channel validation, optimistic revisions and transactional settings updates. General settings preserve Telegram switches.
- Added group/channel registry (migration 015), discovery from bot updates and configured/archive IDs, explicit getChat metadata check and manual ID entry. Personal staff chats and the bot token are excluded. Workers read current destinations without restart; existing ZIP archives keep their original destination.
- All 64 automated tests, ESLint, TypeScript, production build and Windows build preparation passed. Tests cover role enforcement, invalid IDs, conflicts, switch preservation, group/channel discovery, metadata-only check and actual mocked sends to updated destinations.
- Backup before migration: .data/before-accounting-2026-10-06T19-06-28-757Z.dump.
- Isolated browser verification: separate contract page, Telegram destination save and persistence after general-settings save. No test records entered into production and no real Telegram test messages sent.
- Production administrator sign-in, separate settings routes and ready=true verified. Read-only getChat checks successfully identified the configured ZIP channel and finance group; notification destinations were not changed. Screenshot: docs/settings-pages.png.

## 2026-10-07 — Dashboard filters and automatic contracts

- Dashboard stage buttons filter cases on the same page with scoped, deterministic pagination. Summary buttons filter tasks using the same overdue/today/mine/completed predicates as their counts; company-calendar dates are retained. Clear filter restores the normal view.
- Administrator can save optional-field requirements from the new-case form. Policy uses optimistic revisions, role checks, audit history and server validation; selected-client contact checks use stored client data. Fully paid cases do not require a balance deadline.
- Each new case requires valid finance and an imported contract template, automatically attaches the rendered DOCX and starts in Contract signing. Ignored legacy create_contract flags cannot disable generation. Failed validation/rendering rolls back client, case, finance and payment data. First checklist upload starts Document collection from New or Contract signing.
- Migration 016 applied after .data/before-accounting-2026-10-06T19-25-52-815Z.dump. Existing production cases retain their status. No sample template or case was inserted in production.
- All 66 tests, ESLint, TypeScript and production build passed. Browser verification on isolated synthetic data: New stage lists exactly its one case; all four summary buttons show matching tasks; mandatory phone policy saves and native validation focuses the empty phone; completing the form creates case, signing status and downloadable contract without previewing first.
- Windows process-state parsing now keeps timestamps as strings, preventing duplicate service starts; restored state to existing services and stopped duplicate antivirus processes.
- Visual proof: docs/overview-filters.png and docs/auto-contract.png. Tests did not send real Telegram messages or change production customer data.
- Final production verification: Admin sign-in succeeds, clicking New shows only the two existing New cases (one Documents collecting case excluded), All cases link and three total records remain. All local services report running; health ready=true. Live screenshot: docs/overview-live.png.

## 2026-10-07 — Stable dashboard filters and white transitions

- Dashboard filters keep the rendered workspace, summary cards, stage controls and activity panel visible. Only the result list and selected filter change; a small list update notice remains local to that panel.
- Results use the filter selection committed with the response, so a slow request does not show old rows under a new heading. Request sequence checks still discard stale responses and preserve button focus.
- Initial loading, route fallback and section loading use a full viewport white layer with inline styles, without icons or text. Startup waits for authentication before displaying the workspace or sign-in form, avoiding a momentary login flash.
- TypeScript, ESLint, language tests, production build and Windows build preparation passed. Browser verification used an isolated database and an HTTP proxy delaying health by 6 seconds and list requests by 1.2–1.8 seconds: startup and section transitions were entirely white; New filter retained the surrounding DOM and focus, then showed exactly its one synthetic case.
- No production customer records were changed or real Telegram test messages sent. Visual proof: docs/white-loading.png, docs/white-route.png and docs/dashboard-inline-loading.png.
- Final production verification: Admin sign-in succeeds, New filter changes only its list and retains stage controls, activity and button focus. All local services are running and health ready=true. Screenshot: docs/overview-stable.png.

## 2026-10-07 — Revised case stages and visible Telegram checks

- Case stages are shared by overview, list filters and case editing: Contract signing, Waiting for payment, Documents collecting (Document preparation), Under review (Document review), Ready for submission, Waiting for decision, Visa approved, Additional request, Visa refused.
- New cases start in Contract signing. File uploads and status-check date changes preserve manually selected stages. Done submits a complete ZIP for administrator review and sets Under review; whole-package approval completes the checklist task and sets Ready for submission. Returning a package or editing documents while in these two stages returns Document preparation. Additional request is now manual.
- Check-date reminders remain active for document review, ready for submission, waiting for decision and additional request; closed cases stop reminders. Document and task approval statuses remain independent of visa approval/refusal.
- Migration 017 preserves records and writes migration history for obsolete case stages. Production backup: .data/before-case-stages-2026-10-06T20-06-57.703Z.dump. All three existing cases and their client/assignment/deadline data were preserved; two old New cases became Contract signing and the collection case keeps Document preparation. Their affected deadline reminders were rescheduled.
- 68 tests passed, including migration preservation, full review chain, unchanged stage on Telegram uploads, manual stage selection/filter agreement and reminders. After Telegram feedback changes, all 41 affected integration/language tests passed. TypeScript, ESLint, production build and Windows preparation passed.
- Isolated browser check: employee Done with 8 October check date sets Document review and attaches ZIP; administrator confirms the group then approves the package, producing Ready for submission. The ZIP and 08.10.2026 09:00 reminder remain. Screenshot: docs/case-ready-stage.png. No test case/files were inserted in production or sent to real Telegram recipients.
- Telegram Check chat previously displayed its success notice above the scrolled viewport. Progress, success with returned chat name, and errors now appear beside the corresponding button. getChat waits at most 15 seconds; bot polling is unchanged. Real checks for Vizyou and Vizyou backups succeeded and visibly showed both accessible names. Only chat metadata was requested; no test messages/documents sent. Screenshot: docs/telegram-chat-check.png.
