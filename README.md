# D-Shift Workouts

An offline-first, mobile-responsive PWA for people training around 12-hour shift rotas.

## GitHub Pages

Upload this folder to a repository and enable **Settings → Pages → Deploy from a branch**. The app is static and needs no build command. Serve it over HTTPS for service-worker caching and iOS Web Push permissions.

All user data is stored in the browser's IndexedDB database named `d-shift-workouts`; there is no localStorage dependency.

## Fuel quantities and daily quotes

Food nutrition is stored per 100 g and scaled when you enter a quantity in grams or ounces. Daily inspirational quotes are bundled locally and appear on Today. If notifications are enabled, D-Shift attempts one daily quote at 8:00 AM in the local timezone while the PWA is active. Reliable delivery while the app is fully closed requires a Web Push backend with VAPID; GitHub Pages alone cannot provide that sender.
