# Pension Mylos — web

Astro 7 + Tailwind CSS 4. Home con una película que avanza con el scroll (motor *scroll-world*), página de reservas propia (con el paso de datos y pago de Beds24 integrado) y blog en Markdown.

Requiere **Node ≥ 22.23.4** (Astro 7 se niega a arrancar con versiones anteriores).

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # genera dist/ (sitio estático)
npm run preview   # sirve dist/
npm run check     # comprobación de tipos
```

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Teléfono, email, enlaces, ID de las escenas de la película | `src/data/site.ts` (los textos están en `src/i18n/messages/`) |
| ID de Beds24 (`116338`, sacado del botón *Book Now* de la web actual) | `src/data/site.ts` → `BEDS24_PROPID` |
| Entradas del blog | `src/content/blog/*.md` |
| Colores y tipografía (tokens de Tailwind) | `src/styles/global.css` → `@theme`; la fuente Jost está en `public/fonts/` y se precarga en `BaseLayout.astro` |
| Estilos de la película | `src/styles/scroll-world.css` |
| Motor de scroll (adaptado del plugin scroll-world) | `src/scripts/scroll-world.js` |
| Fotos de la galería | `src/assets/gallery/` (textos alternativos en `src/components/Gallery.astro`) |
| Logo | `public/logo.svg`, incrustado por `src/components/Logo.astro` con `currentColor` (blanco sobre la película y el pie, azul `#012155` sobre la cabecera blanca) |
| Favicons | `public/favicon.svg` (molino del logo, blanco en modo oscuro), `favicon.ico`, `apple-touch-icon.png` |
| Aviso de cookies / analytics | `src/components/CookieBanner.astro`, `src/components/Analytics.astro` |

## Idiomas

La web está en 12 idiomas: inglés (por defecto, sin prefijo: `/`), español `/es/`, francés `/fr/`, italiano `/it/`, alemán `/de/`, catalán `/ca/`, neerlandés `/nl/`, griego `/el/`, japonés `/ja/`, chino simplificado `/zh/`, ruso `/ru/` y rumano `/ro/`. El selector de idioma de la cabecera lleva a la misma página en el otro idioma.

| Qué | Dónde |
|---|---|
| Lista de idiomas, nombres y formato de fecha | `src/i18n/config.ts` |
| Textos de la web (menú, película, secciones, formularios, cookies…) | `src/i18n/messages/<idioma>.json` — `en.json` es el original |
| Artículos del blog | `src/content/blog/<idioma>/<slug>.md` — el original es español (`es/`) y las traducciones comparten el nombre de archivo |
| Páginas | `src/pages/[...locale]/` (una sola plantilla para todos los idiomas) |

- Si falta una clave en un JSON, se usa el texto en inglés, así que una traducción incompleta no rompe la página.
- En los titulares, `<em>…</em>` marca las palabras que salen en naranja.
- Un artículo que no existe en un idioma no se publica en ese idioma, y el selector lleva al blog de ese idioma.
- La página de reserva de Beds24 sale en inglés, español, italiano, alemán, catalán, griego y japonés (los idiomas activados para la propiedad). En francés, neerlandés, chino, ruso y rumano sale en inglés hasta que se activen en Beds24.

## La película

`videos/all.mp4` se corta en 6 clips (uno por escena) en las marcas `0:00, 4:23, 9:18, 13:15, 18:20, 25:25` (segundos:fotogramas a 30 fps):

| Escena | Tramo | Contenido |
|---|---|---|
| Agios Nikolaos | 0:00–4:23 | vista aérea del pueblo hasta la fachada |
| The pension | 4:23–9:18 | fachada → ventana → pasillo |
| Rooms | 9:18–13:15 | pasillo → habitación |
| The view | 13:15–18:20 | habitación → balcón |
| Location | 18:20–25:25 | mar → vista aérea |
| Book | 25:25–final | vista aérea, llamada a reservar |

Cada clip incluye el fotograma frontera del siguiente, así que las transiciones no saltan. Para cambiar los cortes, edita `MARKS` en el script y vuelve a generar:

```bash
bash scripts/encode-film.sh   # necesita ffmpeg
```

Genera `public/video/<escena>.mp4` (H.264 1080p, ~24 MB en total), `<escena>-m.mp4` (H.264 720p, ~11 MB), sus versiones AV1 `<escena>.av1.mp4` (~15 MB) y `<escena>-m.av1.mp4` (~10 MB) y `public/scenes/<escena>.webp` (póster). Si cambias el número de escenas, actualiza también `film` en `src/data/site.ts`.

**Formato**: el motor usa AV1 solo si el navegador indica que lo decodifica por hardware (`navigator.mediaCapabilities`, `powerEfficient`); si no, H.264, que funciona en todos los navegadores. Si un clip AV1 falla al decodificar, se reintenta en H.264; si también falla, se queda el póster.

**Diagnóstico**: añade `?debug` a la URL (por ejemplo `/?debug`) para ver un panel con el navegador, el formato elegido, el soporte de códecs y el estado de cada clip (descarga, errores, tiempos de salto). `?codec=av1` o `?codec=h264` fuerzan un formato.

Cada clip se descarga entero antes de poder moverse con el scroll, así que el motor los baja de uno en uno: primero la escena en pantalla, luego las siguientes. Mientras tanto se ve el póster y, si tarda, un indicador «Loading video %» abajo a la derecha.

## Reservas (Beds24 + Stripe)

`/reservations/` (en cada idioma) hace toda la reserva en nuestra web (`src/components/BookingWidget.astro` + funciones de Netlify en `netlify/`):

1. El huésped elige fechas y adultos. La disponibilidad, la capacidad y los precios de cada habitación se consultan en directo a la API pública de Beds24 (`getAvailabilities`, sin clave; una consulta por ocupación de 1, 2 y 3 adultos).
2. Como en Booking.com, una tabla de tipos de habitación con un desplegable de cantidad en cada uno (cualquier combinación de tipos). El precio no cambia con 1 o 2 adultos, así que no se pregunta cuántos van en cada una: los adultos buscados se reparten entre las habitaciones elegidas (`src/lib/booking-math.ts`, el mismo cálculo en el navegador y en el servidor). Los precios se muestran **con impuestos**: IVA 13 %, tasa municipal 0,75 % y tasa climática de 2 € por habitación y noche, por habitación y redondeados al céntimo (`src/data/site.ts` → `beds24.taxes`; si cambian en Beds24, hay que cambiarlos ahí).
3. «Continuar con la reserva»: formulario propio con los datos del huésped (nombre, email, teléfono, país, hora de llegada, comentarios). «Continuar con el pago» está protegido por Google reCAPTCHA igual que el formulario de contacto (v3 invisible; casilla «No soy un robot» si la puntuación es baja; `netlify/lib/recaptcha.ts` y `src/lib/recaptcha-client.ts`, compartidos por los dos formularios), para que un bot no pueda bloquear habitaciones con reservas pendientes.
4. «Continuar con el pago»: `POST /api/booking/checkout` (`netlify/functions/booking-checkout.mts`) vuelve a calcular el precio con Beds24 (nunca se fía del navegador), crea en Beds24 **una reserva por habitación** en estado *request* (bloquea la habitación 30 min y ya da el número de reserva; varias habitaciones van agrupadas) con las líneas de factura (habitación, IVA, tasa municipal, tasa climática), y crea una sesión de Stripe Checkout por el total. El formulario de pago de Stripe se incrusta en la misma página (`ui_mode: embedded_page`).
5. Al pagar, Stripe manda al huésped a `/booking-confirmed/?session_id=…`, que llama a `GET /api/booking/status`: comprueba el pago con Stripe, pasa las reservas a *confirmed* en Beds24, anota el pago en su factura y pide a Beds24 que envíe el email de confirmación; la página muestra el **número de reserva de Beds24**, la estancia, las habitaciones y el importe pagado. El webhook de Stripe (`POST /api/stripe/webhook`) hace lo mismo por si el huésped cierra la pestaña (y Stripe reintenta hasta 3 días si Beds24 falla).
6. Si no se paga en 30 minutos, la sesión caduca: el webhook cancela las reservas *request*. De remate, `booking-maintenance.mts` se ejecuta cada hora (función programada): refresca el token de Beds24 (si no, el *refresh token* caduca a los 30 días sin uso) y cancela las reservas *request* de la web que lleven más de 2 horas sin pagar. «Cambiar datos» antes de pagar libera las habitaciones en el acto (`POST /api/booking/cancel`).
7. El buscador de la home envía las fechas a `/reservations/`, que busca automáticamente.

Las habitaciones (ID de Beds24, nombre y foto) están en `src/data/site.ts` → `bookableRooms`. Si se añade una habitación en Beds24, hay que añadirla ahí. Se puede reservar cualquier combinación de tipos (cada habitación es una reserva propia en Beds24, agrupadas); la limitación de la página de reservas de Beds24, que no dejaba mezclar los dos anuncios importados de Airbnb con las demás habitaciones, no existe en la API (probado).

Toda la lógica de servidor está en `netlify/lib/booking.ts` (flujo) y `netlify/lib/beds24.ts` (cliente de la API v2 de Beds24 + disponibilidad v1). Cada reserva lleva una referencia propia `PM-XXXXXXXX`, guardada como `apiReference` en Beds24 y como `client_reference_id` / metadatos en Stripe.

### Variables de entorno (Netlify → Site configuration → Environment variables)

| Variable | Para qué | Dónde se consigue |
|---|---|---|
| `BEDS24_REFRESH_TOKEN` (secreta) | Crear, leer y confirmar reservas por la API v2 | Beds24 → *Settings → Marketplace → API*: crear un *invite code* con permisos `all:bookings`, `all:bookings-personal`, `all:bookings-financial` y `read:inventory` (solo esta propiedad), y cambiarlo por un *refresh token* con `GET https://api.beds24.com/v2/authentication/setup` (cabeceras `code` y `deviceName`). El *invite code* caduca a las 24 h; el *refresh token* no caduca mientras se use (la función horaria lo usa). |
| `STRIPE_SECRET_KEY` (secreta) | Crear sesiones de pago y comprobarlas | Stripe → *Developers → API keys* (`sk_live_…`; en pruebas `sk_test_…`) |
| `STRIPE_PUBLISHABLE_KEY` | Mostrar el formulario de pago en el navegador | Misma página (`pk_live_…` / `pk_test_…`); la función `booking-checkout` se la pasa a la página |
| `STRIPE_WEBHOOK_SECRET` (secreta) | Verificar que los avisos vienen de Stripe | Stripe → *Developers → Webhooks*: crear un endpoint `https://pensionmylos.com/api/stripe/webhook` con los eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` y `checkout.session.expired`; copiar su *signing secret* (`whsec_…`) |
| `RECAPTCHA_SECRET_KEY` (secreta) | Formularios de contacto y reserva: reCAPTCHA v3 | Google reCAPTCHA (clave secreta de la clave v3) |
| `RECAPTCHA_ENTERPRISE_API_KEY` (secreta) | Formularios de contacto y reserva: desafío si la puntuación es baja | Google Cloud → clave de API restringida a *reCAPTCHA Enterprise API* |

Las claves de prueba y las reales se cambian solo aquí, sin tocar el código. Para probar en local: `npx netlify dev` con las variables en un `.env` (ignorado por git).

### Ajustes en Beds24

- **Reservas *request* bloquean disponibilidad**: en *Settings → Properties → Booking rules → Request bookings* debe estar activado el bloqueo; si no, dos huéspedes podrían pagar la última habitación a la vez. La función de checkout además pide a Beds24 que compruebe la disponibilidad al crear cada reserva (`checkAvailability`).
- **Email de confirmación al huésped**: lo envía Beds24 cuando la reserva pasa a *confirmed* (`notifyGuest`), con la plantilla de confirmación configurada en la cuenta. Stripe envía además su recibo de pago (`receipt_email`).
- Ya no hace falta el CSS de la página de reservas de Beds24 ni la *Booking Return URL*: la página de Beds24 solo queda como enlace de emergencia («¿Problemas? Reserva en nuestra página de Beds24») y como destino del buscador sin JavaScript.

## Blog

Crea un `.md` en `src/content/blog/<idioma>/` (mismo nombre de archivo en todos los idiomas) con este frontmatter:

```yaml
---
title: Título
description: Una frase para el listado y las redes.
pubDate: 2026-11-20
heroImage: ../../../assets/blog/mi-foto.jpg   # opcional
lang: es
heroAlt: Descripción de la foto
tags: [beaches]
draft: false        # true = no se publica
---
```

Las tres entradas iniciales están escritas solo con información de la web actual. Revisadlas antes de publicar.
