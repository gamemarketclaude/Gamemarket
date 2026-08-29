// Пролистывание фото на странице товара (до 4 шт.) — стрелки и точки.
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

    if (prevBtn) prevBtn.addEventListener('click', () => show(index - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => show(index + 1));
    dots.forEach((dot, i) => dot.addEventListener('click', () => show(i)));
  });
})();
