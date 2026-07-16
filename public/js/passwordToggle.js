// Agrega el "ojito" a cada campo con clase .password-field: alterna el
// input asociado entre type="password" y type="text" para poder ver la
// contrasena que se esta escribiendo.
export function initPasswordToggles() {
  document.querySelectorAll('.password-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;

      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? '👁' : '🙈';
      btn.setAttribute('aria-label', showing ? 'Mostrar contrasena' : 'Ocultar contrasena');
    });
  });
}
