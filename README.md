# Mal und Geteilt lernen

Lernseite für Mal- und Geteilt-Rechnen mit Admin-Panel.

- `public/index.html`: Lernseite
- `public/admin.html`: Admin-Panel (unter `/admin.html`)
- `netlify/functions/track.mjs`: speichert den Lernfortschritt (Netlify Blobs)
- `netlify/functions/admin.mjs`: Einmal-PIN, Owner-Zugang und Daten fürs Admin-Panel

Die PIN steht **nicht** im Code, sondern als Umgebungsvariable `ADMIN_PIN` in Netlify.
Eine PIN funktioniert nur einmal. Neue PIN = `ADMIN_PIN` in Netlify ändern und neu deployen.
