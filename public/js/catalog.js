// Каталог: на телефоне блок фильтров свёрнут в одну строку «Фильтры и
// сортировка», чтобы товары были видны сразу. Если какой-то фильтр уже
// выбран — оставляем открытым. На компьютере фильтры всегда раскрыты.
(function () {
  const details = document.querySelector('[data-filters]');
  if (!details || !window.matchMedia) return;

  const mobile = window.matchMedia('(max-width: 720px)');
  const hasActive = Number(details.dataset.activeCount) > 0;

  function sync() {
    if (!mobile.matches) details.open = true;
  }

  if (mobile.matches && !hasActive) details.open = false;
  if (mobile.addEventListener) mobile.addEventListener('change', sync);
})();
