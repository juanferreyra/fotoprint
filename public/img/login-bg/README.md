# Fondos del login

Poné acá fotos (`.jpg`, `.jpeg`, `.png`, `.webp` o `.gif`) para que se
muestren de fondo, elegidas al azar, en las pantallas de login y registro.

- Cada carga de página pide `GET /api/login-background`, que elige una
  imagen al azar entre las que haya en esta carpeta.
- Si la carpeta está vacía (como recién clonado el repo), se usa el fondo
  sólido de siempre — no hace falta ninguna imagen para que la app funcione.
- No hay límite de cantidad ni convención de nombres: cualquier archivo con
  esas extensiones cuenta.
