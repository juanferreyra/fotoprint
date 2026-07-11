// Pide una foto de fondo al azar (de public/img/login-bg/) para las
// pantallas de login/registro. Si no hay ninguna cargada en el servidor,
// se queda con el fondo solido de siempre.
export async function initAuthBackground() {
  try {
    const res = await fetch('/api/login-background');
    const { url } = await res.json();
    if (!url) return;
    const bg = document.getElementById('login-bg');
    if (bg) bg.style.backgroundImage = `url("${url}")`;
  } catch {
    // sin conexion o error: se queda con el fondo solido, no es critico.
  }
}
