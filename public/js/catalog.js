// Каталог: на телефоне блок фильтров свёрнут в одну строку «Фильтры и
// сортировка», чтобы товары были видны сразу. Если какой-то фильтр уже
// выбран — оставляем открытым. На компьютере фильтры всегда раскрыты.
(function () {
  if (!window.matchMedia) return;
  const mobile = window.matchMedia('(max-width: 720px)');

  document.querySelectorAll('[data-filters]').forEach((details) => {
    const hasActive = Number(details.dataset.activeCount) > 0;
    if (mobile.matches && !hasActive) details.open = false;
    // На компьютере фильтры каталога всегда раскрыты (у них нет заголовка-кнопки)
    if (mobile.addEventListener && details.classList.contains('filters__details')) {
      mobile.addEventListener('change', () => { if (!mobile.matches) details.open = true; });
    }
  });
})();
