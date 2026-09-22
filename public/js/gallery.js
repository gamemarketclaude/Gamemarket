// Пролистывание фото (до 10 шт.) — стрелки и точки. Работает и на странице
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

    // Свайп пальцем влево/вправо на телефоне. Если листали на карточке
    // каталога, следующий «клик» (он приходит после свайпа) не должен
    // открывать товар.
    if (slides.length > 1) {
      let startX = null;
      let startY = null;
      let swiped = false;
      root.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        swiped = false;
      }, { passive: true });
      root.addEventListener('touchend', (e) => {
        if (startX === null) return;
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        startX = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          swiped = true;
          show(dx < 0 ? index + 1 : index - 1);
        }
      }, { passive: true });
      root.addEventListener('click', (e) => {
        if (swiped) {
          stop(e);
          swiped = false;
        }
      });
    }
  });
})();
