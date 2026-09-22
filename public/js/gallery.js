// Пролистывание фото (до 4 шт.) — стрелки и точки. Работает и на странице
// товара, и на самих карточках в каталоге (там карточка целиком — ссылка на
// товар, поэтому клик по стрелке/точке останавливаем, чтобы не переходило).
(function () {
  document.querySelectorAll('[data-gallery]').forEach((root) => {
    const slides = Array.from(root.querySelectorAll('[data-gallery-slide]'));
    const dots = Array.from(root.querySelectorAll('[data-gallery-dot]'));
    const prevBtn = root.querySelector('[data-gallery-prev]');
    const nextBtn = root.querySelector('[data-gallery-next]');
    let index = 0;

    function show(i) {
      index = (i + slides.length) % slides.length;
      slides.forEach((el, n) => el.classList.toggle('is-active', n === index));
      dots.forEach((el, n) => el.classList.toggle('is-active', n === index));
    }

    function stop(e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (prevBtn) prevBtn.addEventListener('click', (e) => { stop(e); show(index - 1); });
    if (nextBtn) nextBtn.addEventListener('click', (e) => { stop(e); show(index + 1); });
    dots.forEach((dot, i) => dot.addEventListener('click', (e) => { stop(e); show(i); }));
  });
})();
