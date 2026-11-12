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

## Reservas (Beds24)

`/reservations/` (en cada idioma) tiene un buscador propio (`src/components/BookingWidget.astro`):

1. El huésped elige fechas y adultos. La disponibilidad, la capacidad y los precios de cada habitación se consultan en directo a la API pública de Beds24 (`getAvailabilities`, sin clave; una consulta por ocupación de 1, 2 y 3 adultos).
2. Como en Booking.com, una tabla de tipos de habitación con un desplegable de cantidad en cada uno (sin nada preseleccionado y sin límite por adultos: cada adulto puede querer su habitación). El precio no cambia con 1 o 2 adultos, así que no se pregunta cuántos van en cada una: los adultos buscados se reparten entre las habitaciones elegidas al pasarlas a Beds24. Los precios se muestran **con impuestos**: IVA 13 %, tasa municipal 0,75 % y tasa climática de 2 € por habitación y noche, calculados igual que Beds24 (`src/data/site.ts` → `beds24.taxes`; si cambian en Beds24, hay que cambiarlos ahí).
3. «Continuar con la reserva» carga en la misma página, en un iframe, el paso de datos del huésped y pago de Beds24 con esa selección. El formulario de datos no puede ser nuestro: Beds24 lo envía por POST ligado a su propia sesión, que nuestra web no puede leer, y no acepta los datos del huésped por la URL.
4. El buscador de la home envía las fechas a `/reservations/`, que busca automáticamente.

Las habitaciones (ID de Beds24, nombre, foto y grupo) están en `src/data/site.ts` → `bookableRooms`. Si se añade una habitación en Beds24, hay que añadirla ahí. Beds24 no deja reservar juntas las habitaciones normales y los dos anuncios importados de Airbnb (`352782`, `352783`), por eso están en grupos distintos: si se eligen juntos, el resumen lo avisa y no deja continuar.

### Ajustes en Beds24

- **Estilo del iframe**: pega el contenido de `beds24/booking-page.css` en el campo de CSS personalizado de la página de reservas de Beds24 (*Settings → Booking Engine → Booking Page*, en los ajustes de desarrollador). Le da al formulario la tipografía, los colores y los botones de la web, con fondo transparente. La fuente se carga desde pensionmylos.com: el hosting debe servir `/fonts/*` con `Access-Control-Allow-Origin: *` (`public/_headers` ya lo hace en Netlify o Cloudflare Pages). Si no, se ve con una fuente de respaldo casi igual.
- **Pago dentro de la página**: la tarjeta se introduce en un iframe seguro de Beds24 que funciona dentro del nuestro. Si la pasarela de pago redirige a otra web (PayPal, Stripe Checkout…), el ajuste de Beds24 para iframes *Open in New Window* (ahora en *On Secure Payment*) decide si se abre en una ventana aparte. Se puede cambiar para que no abra ventana nueva, pero algunas pasarelas no se dejan mostrar dentro de un iframe; en ese caso hay que dejarlo como está.
- **Página de confirmación**: para medir reservas completadas, configura en Beds24 → *Settings → Booking Engine → Property Booking Page → Behaviour → Booking Return URL*: `https://pensionmylos.com/booking-confirmed/`. Esa página se queda dentro del iframe (sin cabecera, pie ni aviso de cookies), avisa a `/reservations/` de su altura para ajustar el marco y reenvía al idioma en que estaba el huésped; sus botones abren la web a pantalla completa.

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
