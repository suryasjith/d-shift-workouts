# D-Shift Workouts

An offline-first, mobile-responsive PWA for people training around 12-hour shift rotas.

## GitHub Pages

Upload this folder to a repository and enable **Settings → Pages → Deploy from a branch**. The app is static and needs no build command. Serve it over HTTPS for service-worker caching and iOS Web Push permissions.

All user data is stored in the browser's IndexedDB database named `d-shift-workouts`; there is no localStorage dependency.
