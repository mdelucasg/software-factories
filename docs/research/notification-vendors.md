# Comparativa de proveedores 3rd-party de notificaciones para Cadence

> **Ticket**: [#2 — Comparativa de proveedores 3rd-party de notificaciones (Novu, Knock, SuprSend, Courier/MagicBell)](https://github.com/mdelucasg/software-factories/issues/2)  
> **Mapa**: [#1 — Mapa: Notificaciones transaccionales y de adherencia en Cadence (vía servicio 3rd-party)](https://github.com/mdelucasg/software-factories/issues/1)  
> **Fecha**: Noviembre 2026

---

## 1. Resumen ejecutivo y recomendación

Para cubrir las notificaciones transaccionales del dominio de **Cadence** (**Student**, **Instructor**, **Team Admin** y **Platform Admin** ante eventos de **Purchase**, **Individual Purchase**, **Team Licence**, **Seat** `Unclaimed`/`Claimed`, **Enrollment** `Active`/`Lapsed`, **Refund Request** `Open`/`Approved`/`Declined` y **Refund** `Pending`/`Issued`/`Failed`), junto con los recordatorios de adherencia estilo Duolingo y recomendaciones de nuevos **Courses**, **recomendamos seleccionar Novu (`@novu/react` + `@novu/api` / `@novu/framework`) como primera opción**, con **Knock (`@knocklabs/react` + `@knocklabs/node`) como segunda opción sólida**.

### Por qué **Novu** es la mejor opción para Cadence:
1. **Soporte explícito de React 19 y personalización con Tailwind v4 / shadcn**: `@novu/react` (`v3.19.2`) declara `react: "^18.0.0 || ^19.0.0"` en sus `peerDependencies` oficiales, ofrece tanto el componente `<Inbox />` preconstruido (personalizable con `appearance.variables` y clases de Tailwind) como el hook headless `useNotifications` bajo `<NovuProvider>`, y reacciona automáticamente al cambio de `subscriberId` cuando se alterna de usuario en `DevUI` (`app/components/dev-ui.tsx`).
2. **Motor de workflows code-first en TypeScript (`@novu/framework`) ideal para adherencia estilo Duolingo**: permite definir `step.delay()`, `step.digest()` y `step.inApp()` / `step.email()` directamente en el repositorio con validación Zod, y cancelar recordatorios en espera mediante un `transactionId` determinista (`novu.cancel(transactionId)` / `DELETE /v1/events/trigger/{transactionId}`) cuando el **Student** completa una lección antes de que venza el temporizador.
3. **DX local sin fricción, self-hosting MIT y testabilidad en Vitest**: incluye **Keyless mode** en `<Inbox />`, **Local Studio** (`npx novu@latest dev`), opción de **self-hosting con Docker** (100 % open-source MIT, sin límite de workflows) además del **Free Tier en Cloud (10.000 eventos/mes)**, y una costura (*seam*) mínima para inyectar un adaptador en memoria o mockear llamadas durante `npm run db:seed` y `npm run test`.

---

## 2. Matriz comparativa

| Criterio | **Novu** (Recomendado #1) | **Knock** (Alternativa #2) | **SuprSend** | **Courier / MagicBell** |
| :--- | :--- | :--- | :--- | :--- |
| **Paquete React y soporte React 19** | `@novu/react@3.19.2`<br>Soporte explícito: `^18.0.0 \|\| ^19.0.0` ([npm](https://www.npmjs.com/package/@novu/react), [docs](https://docs.novu.co/platform/inbox/setup-inbox)) | `@knocklabs/react@0.15.1`<br>Soporte explícito: `^17.0.0 \|\| ^18.0.0 \|\| ^19.0.0` ([npm](https://www.npmjs.com/package/@knocklabs/react), [docs](https://docs.knock.app/in-app-ui/react/overview)) | `@suprsend/react@1.5.0` / `@suprsend/react-core@2.4.0`<br>`peerDependencies`: `>= 16.8.0` ([npm](https://www.npmjs.com/package/@suprsend/react-core), [docs](https://docs.suprsend.com/docs/react-sdk-headless-feed)) | **Courier**: `@trycourier/react-inbox@7.4.8` (`>=17.X.X`, requiere `styled-components >=5.X.X`)<br>**MagicBell**: `@magicbell/react-headless@5.5.1` (`>= 18.3.1`) |
| **Componentes `<Inbox />` vs. Hooks Headless (Tailwind v4 / shadcn)** | Ambos: `<Inbox />` con `appearance` (CSS variables/clases) + `<NovuProvider>` y `useNotifications()` ([Styling](https://docs.novu.co/platform/inbox/configuration/styling), [Hooks](https://docs.novu.co/platform/sdks/react/hooks/use-notifications)) | Ambos: `<NotificationFeedPopover />` + hooks headless `useNotifications` y `useNotificationStore` ([Headless UI](https://docs.knock.app/in-app-ui/react/headless/feed)) | Ambos: Inbox preconstruido + `<SuprSendProvider>` y `useNotifications()` ([Headless Feed](https://docs.suprsend.com/docs/react-sdk-headless-feed)) | **Courier**: dependiente de `styled-components` en UI preconstruida.<br>**MagicBell**: `<FloatingInbox />` o `@magicbell/react-headless` |
| **Cambio en caliente de usuario (`DevUI`)** | Reactivo al cambiar `subscriberId` en `<Inbox />` / `<NovuProvider>` (o forzando `key={currentUser.id}`) ([Setup Inbox](https://docs.novu.co/platform/inbox/setup-inbox)) | Reactivo al cambiar `user={{ id }}` en `<KnockProvider>` ([React Overview](https://docs.knock.app/in-app-ui/react/overview)) | Reactivo al cambiar `subscriberId` / `distinctId` en `<SuprSendProvider>` ([Headless Feed](https://docs.suprsend.com/docs/react-sdk-headless-feed)) | Cambio de `userId` / JWT en el provider correspondiente |
| **Delay & Digest / Batch nativos** | Sí: **Delay** (fijo, programado o horario del suscriptor) y **Digest** (agrupación por `subscriberId` y clave de payload) ([Delay](https://docs.novu.co/platform/workflow/add-and-configure-steps/configure-action-steps/delay), [Digest](https://docs.novu.co/platform/workflow/add-and-configure-steps/configure-action-steps/digest)) | Sí: **Delay Function** (intervalo fijo/dinámico o ventana horaria) y **Batch Function** con `batch_key` ([Delay](https://docs.knock.app/designing-workflows/delay-function), [Batch](https://docs.knock.app/designing-workflows/batch-function)) | Sí: **Delay Node** (fijo o dinámico con expresiones JQ) y **Batch / Digest Node** ([Delay](https://docs.suprsend.com/docs/delay)) | **Courier**: Delay + Digest en Automations/Journeys.<br>**MagicBell**: primitiva `wait`, sin motor de digest multi-evento tan rico |
| **Cancelación de workflows en espera (Adherencia Duolingo)** | **Por API / SDK**: pasar `transactionId` al disparar y llamar a `novu.cancel(transactionId)` (`DELETE /v1/events/trigger/{transactionId}`) ([Cancel Event](https://docs.novu.co/api-reference/events/cancel-triggered-event)) | **Por API / SDK**: pasar `cancellation_key` al disparar y llamar a `knock.workflows.cancel(key, { cancellation_key, recipients })` ([Canceling Workflows](https://docs.knock.app/send-notifications/canceling-workflows)) | **Declarativa en grafo o vía clave**: nodo **Cancel Workflow** en otro workflow filtrando por `cancellation_key` + `recipient`, o vía API ([Cancel Workflow](https://docs.suprsend.com/docs/cancel-workflow)) | **Courier**: nodo *Cancel Automation* o API con `cancelation_token` ([Cancel Node](https://www.courier.com/docs/journeys/nodes/cancel)) |
| **Workflows como código vs. Dashboard** | **Code-first nativo** en TypeScript (`@novu/framework@2.14.0` con esquemas Zod) + UI visual en Dashboard ([Framework](https://docs.novu.co/framework)) | Definición en Dashboard sincronizable como JSON mediante **Knock CLI** (`knock workflow pull/push`) ([Knock CLI](https://knock.app/cli)) | Definición visual en el Dashboard de Workflows | Definición visual en Dashboard |
| **Multicanal integrado (In-App, Email, SMS, Web Push)** | Sí: In-App, Email, SMS, Push y Chat en el mismo workflow ([Inbox & Channels](https://docs.novu.co/platform/inbox)) | Sí: In-App, Email, SMS, Push y Chat en el mismo workflow ([Pricing & Channels](https://knock.app/pricing)) | Sí: In-App, Email, SMS, Web/Mobile Push, WhatsApp y Chat ([Add a Channel](https://docs.suprsend.com/docs/add-a-channel)) | Sí en ambos |
| **Entorno local, Self-Hosted y Free Tier** | **Keyless mode**, **Local Studio** (`npx novu dev`), **Self-Hosted Docker (MIT)** y Cloud Free Tier de **10.000 workflow runs/mes** (límite de 5 workflows en Cloud Free; ilimitados en self-hosted o Pro $30/mes) ([Studio](https://docs.novu.co/framework/studio), [Pricing](https://www.novu.co/pricing/)) | Solo Cloud (con entornos aislados y `knock` CLI). Free Tier de **10.000 mensajes/mes** con workflows ilimitados; primer plan de pago desde **$250/mes** ([Pricing](https://knock.app/pricing)) | Solo Cloud (con *Sandbox Workspace* y *Verified Channels*). Free Tier de **10.000 notificaciones/mes** | **Courier**: Free Tier 10.000 envíos/mes.<br>**MagicBell**: Free Tier muy reducido (**1.000 entregas/mes**), plan Startup desde **$249/mes** ([Pricing](https://www.magicbell.com/pricing)) |

---

## 3. Análisis detallado por criterio para Cadence

### 3.1. UI In-App en React 19 + React Router v7 y cambio de usuario en `DevUI`

El stack actual de Cadence (`package.json`) utiliza **React `19.2.7`**, **React Router `8.3.0` (v7 framework mode)** y **Tailwind CSS v4 (`@tailwindcss/vite@4.1.13`) + shadcn/ui**. Además, `app/components/dev-ui.tsx` permite cambiar en caliente entre usuarios (**Student**, **Instructor**, **Team Admin**, **Platform Admin**) enviando un `POST` a `/api/switch-user`.

- **Novu (`@novu/react@3.19.2`)**:
  - Declara compatibilidad oficial con React 19 en sus `peerDependencies` (`react: "^18.0.0 || ^19.0.0 || ^19.0.0-0"`).
  - Ofrece dos modos de integración en el layout raíz de React Router:
    1. **Componente `<Inbox />` con `appearance`**: incluye campana (`<Bell />`), popover con pestañas, contador de no leídas, marcado como leído/archivado y soporte de redirección con React Router (`routerPush={(path: string) => navigate(path)}`). Se adapta al tema de Tailwind v4 y shadcn mediante `appearance={{ variables: { ... }, elements: { ... } }}` ([Novu Styling Docs](https://docs.novu.co/platform/inbox/configuration/styling)).
    2. **Hooks headless (`useNotifications`, `useCounts`)**: envolviendo el árbol con `<NovuProvider subscriberId={String(currentUser.id)} applicationIdentifier={...}>`, podemos renderizar las notificaciones con nuestros propios componentes `Popover`, `Badge` y `Button` de `app/components/ui/` ([Novu useNotifications Docs](https://docs.novu.co/platform/sdks/react/hooks/use-notifications)).
  - **Integración con `DevUI`**: al pasar `subscriberId={`cadence-user-${currentUser.id}`}` (y `key={currentUser.id}` en el proveedor o `<Inbox />`), cada vez que se selecciona otro usuario en `DevUI` (`app/components/dev-ui.tsx:111-130`), el cliente de Novu cierra la conexión WebSocket anterior e inicializa instantáneamente el buzón del nuevo **Student**, **Instructor**, **Team Admin** o **Platform Admin** ([Novu Setup Inbox](https://docs.novu.co/platform/inbox/setup-inbox)).

- **Knock (`@knocklabs/react@0.15.1`)**:
  - También soporta oficialmente React 19 (`react: "^17.0.0 || ^18.0.0 || ^19.0.0"`).
  - Su arquitectura headless con `<KnockProvider user={{ id: String(currentUser.id) }}>`, `<KnockFeedProvider feedId={...}>`, `useNotifications` y `useNotificationStore` es muy limpia para construir un dropdown en Tailwind v4 ([Knock Headless Feed Docs](https://docs.knock.app/in-app-ui/react/headless/feed)).

- **SuprSend (`@suprsend/react-core@2.4.0`)**:
  - Provee `<SuprSendProvider>` y `useNotifications()` para construir feeds headless ([SuprSend Headless Feed](https://docs.suprsend.com/docs/react-sdk-headless-feed)), aunque su `peerDependencies` sigue declarada de forma genérica como `react: ">= 16.8.0"`.

- **Courier / MagicBell**:
  - `@trycourier/react-inbox@7.4.8` arrastra `styled-components >= 5.X.X` como `peerDependency`, lo que introduce fricción innecesaria en una aplicación React 19 + Tailwind v4.
  - MagicBell (`@magicbell/react-headless@5.5.1`) funciona bien, pero su límite de 1.000 entregas mensuales en el plan gratuito penaliza las pruebas intensivas ([MagicBell Pricing](https://www.magicbell.com/pricing)).

---

### 3.2. Motor de workflows para adherencia estilo Duolingo y recomendaciones

El caso de uso de adherencia en Cadence requiere:
1. Cuando un **Student** con un **Enrollment** `Active` completa una lección (o se inscribe en un **Course**), programar un recordatorio tras un periodo de inactividad (p. ej., 24h / 48h).
2. **Cancelación por actividad**: si el **Student** avanza en otra lección o completa un quiz antes de que venza el temporizador, el recordatorio en espera debe cancelarse para no enviar mensajes obsoletos.
3. Si un **Refund Request** pasa a `Approved` y el **Enrollment** pasa a `Lapsed`, cualquier recordatorio pendiente para ese **Enrollment** también debe cancelarse.
4. **Digest / Batching**: agrupar actividad frecuente (p. ej., nuevos **Students** inscritos o discusiones en un **Course** para un **Instructor**, o resumen semanal de progreso) en una sola notificación.

#### Cómo lo resuelve cada proveedor:

1. **Novu (`@novu/framework` + `@novu/api`)**:
   - **Delay y Digest nativos en código TypeScript**: con `@novu/framework`, un workflow de adherencia se escribe directamente en el repositorio de Cadence usando `await step.delay('wait-inactivity', () => ({ amount: 24, unit: 'hours' }))` y `await step.digest('digest-events', () => ({ amount: 1, unit: 'days' }))` ([Novu Delay Docs](https://docs.novu.co/platform/workflow/add-and-configure-steps/configure-action-steps/delay), [Novu Digest Docs](https://docs.novu.co/platform/workflow/add-and-configure-steps/configure-action-steps/digest)).
   - **Cancelación determinista con `transactionId`**: al disparar el workflow de recordatorio de adherencia tras la actividad del **Student**, asignamos un `transactionId` determinista por **Enrollment**, por ejemplo `adherence-enrollment-${enrollmentId}`. Cuando el **Student** completa la siguiente lección (o cuando su **Enrollment** pasa a `Lapsed` tras aprobarse un **Refund Request**), el backend invoca `await novu.cancel(`adherence-enrollment-${enrollmentId}`)` (`DELETE /v1/events/trigger/{transactionId}`) y reprograma el nuevo ciclo ([Novu Cancel Triggered Event](https://docs.novu.co/api-reference/events/cancel-triggered-event)).

2. **Knock (`@knocklabs/node`)**:
   - **Delay Function y Batch Function**: configurables en el workflow con claves de agrupación (`batch_key`) ([Knock Delay Function](https://docs.knock.app/designing-workflows/delay-function), [Knock Batch Function](https://docs.knock.app/designing-workflows/batch-function)).
   - **Cancelación con `cancellation_key`**: al disparar `knock.workflows.trigger("adherence-reminder", { recipients: [studentId], cancellation_key: `enrollment-${enrollmentId}` })`, se puede cancelar en cualquier momento mientras esté en el paso `delay` llamando a `knock.workflows.cancel("adherence-reminder", { cancellation_key: `enrollment-${enrollmentId}`, recipients: [studentId] })` ([Knock Canceling Workflows](https://docs.knock.app/send-notifications/canceling-workflows)).

3. **SuprSend (`@suprsend/node-sdk`)**:
   - **Nodo declarativo *Cancel Workflow***: además de permitir claves de cancelación (`cancellation_key`), SuprSend permite colocar un nodo **Cancel Workflow** dentro del workflow de `lesson-completed` o `enrollment-lapsed` que busca y detiene automáticamente cualquier ejecución en espera (`Delay` o `Batch`) del workflow de adherencia para ese destinatario y clave ([SuprSend Cancel Workflow](https://docs.suprsend.com/docs/cancel-workflow)).

---

### 3.3. Soporte multicanal integrado (In-App, Email, SMS, Web Push)

Tanto **Novu** como **Knock** y **SuprSend** desacoplan el evento de dominio de los canales de entrega:
- El backend de Cadence emite un único trigger por evento de negocio (p. ej., `purchase.completed`, `seat.claimed`, `refund-request.opened`, `refund-request.decided`, `refund.issued`, `adherence.reminder`, `course.recommended`).
- Añadir **Email** (Resend, Postmark, SendGrid, SES), **SMS** (Twilio, SNS) o **Web Push** (FCM) posteriormente consiste únicamente en añadir un paso de canal al workflow (p. ej., `await step.email(...)` en `@novu/framework` o un paso de canal en Knock/SuprSend), pudiendo condicionar el envío de Email a si la notificación In-App no ha sido leída tras un `delay` (*channel fallback*), sin modificar los puntos de disparo en los actions/loaders de React Router ([Novu Framework](https://docs.novu.co/framework), [Knock Delay Fallback](https://docs.knock.app/designing-workflows/delay-function)).

---

### 3.4. DX, entorno local / self-hosted vs. cloud free tier y testabilidad en Cadence

Aquí es donde **Novu** marca una ventaja decisiva para un proyecto como Cadence:

1. **Desarrollo local y prototipado sin fricción**:
   - `<Inbox />` de Novu cuenta con **Keyless mode** para levantar la UI In-App inmediatamente en local sin configurar claves, y **Novu Local Studio** (`npx novu@latest dev`) para inspeccionar y probar workflows `@novu/framework` definidos en el propio código ([Novu Studio Docs](https://docs.novu.co/framework/studio)).
   - Además, Novu es **open-source (licencia MIT)** y puede ejecutarse en **Self-Hosted con Docker** si se necesitan más de los **5 workflows incluidos en el Free Tier de Novu Cloud** (10.000 eventos/mes gratis; el plan Pro cuesta $30/mes vs. $250/mes del primer plan de pago de Knock) ([Novu Pricing](https://www.novu.co/pricing/), [Knock Pricing](https://knock.app/pricing)).
   - *Nota importante sobre el límite de 5 workflows en Novu Cloud Free Tier*: incluso usando Novu Cloud Free Tier sin pagar ni auto-alojar, con `@novu/framework` podemos agrupar las notificaciones transaccionales en un número compacto de workflows (p. ej., 1 workflow transaccional de **Purchases & Seats**, 1 de **Refund Requests & Refunds**, 1 de **Adherencia con Delay/Cancel**, y 1 de **Recomendación de Courses** = 4 workflows en total, dentro del límite gratuito de 5).

2. **Sembrado de datos (`npm run db:seed`) y aislamiento en Vitest (`npm run test`)**:
   - Siguiendo los principios de diseño modular (*deep modules*), el resto de la aplicación Cadence no debe importar el SDK del proveedor directamente en las rutas de React Router, sino comunicarse con un módulo interno (p. ej., `app/services/notifications.server.ts`) que exponga operaciones de dominio tipadas con el vocabulario de `GLOSSARY.md`.
   - En **Vitest (`npm run test`)** y durante **`npm run db:seed`** (cuando no haya `NOVU_SECRET_KEY` definida o cuando `NODE_ENV === "test"`), el servicio utiliza un adaptador local/no-op o un espía en memoria que registra los eventos disparados y las cancelaciones sin realizar llamadas HTTP externas.
   - Si en `npm run db:seed` se desea poblar el buzón real del entorno de desarrollo en Cloud para los usuarios de `DevUI`, un flag opcional (p. ej., `SEED_NOTIFICATIONS=true`) puede sincronizar los suscriptores (`subscriberId`) y emitir un lote controlado de eventos iniciales.

---

## 4. Conclusión y siguientes pasos

1. **Proveedor recomendado**: **Novu** (`@novu/react` + `@novu/api` + `@novu/framework`), por su soporte nativo de React 19, su enfoque *code-first* en TypeScript con validación Zod, su cancelación determinista de `delay`/`digest` mediante `transactionId`, y su flexibilidad entre Cloud Free Tier (10k eventos/mes) y Self-Hosted open-source.
2. **Alternativa recomendada**: **Knock** (`@knocklabs/react` + `@knocklabs/node`), si se prefiere gestionar workflows en el dashboard/CLI de Knock sin límite de número de workflows en el plan gratuito (10k mensajes/mes).
3. **Impacto en la arquitectura de Cadence**: encapsular el proveedor detrás de una interfaz de dominio en el servidor (`notifyPurchase`, `notifySeatClaimed`, `notifyRefundRequestUpdated`, `scheduleAdherenceReminder`, `cancelAdherenceReminder`) y montar el proveedor de UI en el layout autenticado vinculando `subscriberId` al `currentUser.id` seleccionado en `DevUI`.

---

## 5. Fuentes primarias consultadas

- **Novu**:
  - [Novu React `<Inbox />` Overview & Setup](https://docs.novu.co/platform/inbox/setup-inbox)
  - [Novu React `<Inbox />` Styling & Tailwind Customization](https://docs.novu.co/platform/inbox/configuration/styling)
  - [Novu React `useNotifications` Hook](https://docs.novu.co/platform/sdks/react/hooks/use-notifications)
  - [Novu Code-First Workflows (`@novu/framework`)](https://docs.novu.co/framework)
  - [Novu Local Studio (`npx novu dev`)](https://docs.novu.co/framework/studio)
  - [Novu Workflow Delay Step](https://docs.novu.co/platform/workflow/add-and-configure-steps/configure-action-steps/delay)
  - [Novu Workflow Digest Step](https://docs.novu.co/platform/workflow/add-and-configure-steps/configure-action-steps/digest)
  - [Novu API: Cancel Triggered Event (`DELETE /v1/events/trigger/{transactionId}`)](https://docs.novu.co/api-reference/events/cancel-triggered-event)
  - [Novu Pricing](https://www.novu.co/pricing/)
  - [npm: `@novu/react@3.19.2`](https://www.npmjs.com/package/@novu/react)
- **Knock**:
  - [Knock React In-App UI Overview](https://docs.knock.app/in-app-ui/react/overview)
  - [Knock Headless Feed in React](https://docs.knock.app/in-app-ui/react/headless/feed)
  - [Knock Delay Function](https://docs.knock.app/designing-workflows/delay-function)
  - [Knock Batch Function](https://docs.knock.app/designing-workflows/batch-function)
  - [Knock Canceling Workflows (`cancellation_key`)](https://docs.knock.app/send-notifications/canceling-workflows)
  - [Knock CLI](https://knock.app/cli)
  - [Knock Pricing](https://knock.app/pricing)
  - [npm: `@knocklabs/react@0.15.1`](https://www.npmjs.com/package/@knocklabs/react)
- **SuprSend**:
  - [SuprSend React SDK Headless Feed](https://docs.suprsend.com/docs/react-sdk-headless-feed)
  - [SuprSend Delay Node](https://docs.suprsend.com/docs/delay)
  - [SuprSend Cancel Workflow Node](https://docs.suprsend.com/docs/cancel-workflow)
  - [SuprSend Sandbox & Channels](https://docs.suprsend.com/docs/add-a-channel)
  - [npm: `@suprsend/react-core@2.4.0`](https://www.npmjs.com/package/@suprsend/react-core)
- **Courier & MagicBell**:
  - [Courier Journeys Cancel Node (`cancelation_token`)](https://www.courier.com/docs/journeys/nodes/cancel)
  - [npm: `@trycourier/react-inbox@7.4.8`](https://www.npmjs.com/package/@trycourier/react-inbox)
  - [MagicBell Pricing](https://www.magicbell.com/pricing)
  - [npm: `@magicbell/react-headless@5.5.1`](https://www.npmjs.com/package/@magicbell/react-headless)
