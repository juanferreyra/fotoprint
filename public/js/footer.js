export function initFooterYear() {
  document.querySelectorAll('.footer-year').forEach((el) => {
    el.textContent = new Date().getFullYear();
  });
}
