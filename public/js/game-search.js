// Автодополнение по играм: ищет и на русском, и на английском, и по
// сокращениям (см. games.aliases в БД). Используется в шапке (переход на
// страницу игры) и в форме "Выставить товар" (выбор game_id).
(function () {
  function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function initGameSearch(root) {
    const input = root.querySelector('[data-game-search-input]');
    const dropdown = root.querySelector('[data-game-search-dropdown]');
    const mode = root.dataset.gameSearchMode || 'navigate';
    const hiddenId = mode === 'select' ? document.querySelector(root.dataset.gameSearchTarget) : null;
    let items = [];
    let activeIndex = -1;

    function closeDropdown() {
      dropdown.hidden = true;
      dropdown.innerHTML = '';
      items = [];
      activeIndex = -1;
    }

    function renderDropdown(games) {
      items = games;
      activeIndex = -1;
      if (!games.length) {
        closeDropdown();
        return;
      }
      dropdown.innerHTML = games.map((g, i) => `
        <button type="button" class="game-search__item" data-index="${i}">
          <span class="game-search__item-icon">${g.icon}</span>
          <span class="game-search__item-name">${g.name_ru}</span>
          <span class="game-search__item-en">${g.name_en}</span>
        </button>
      `).join('');
      dropdown.hidden = false;
    }

    function selectGame(game) {
      if (mode === 'navigate') {
        window.location.href = '/game/' + game.slug;
        return;
      }
      input.value = game.name_ru + ' (' + game.name_en + ')';
      if (hiddenId) hiddenId.value = game.id;
      closeDropdown();
    }

    const fetchSuggestions = debounce(function (query) {
      if (!query.trim()) {
        closeDropdown();
        return;
      }
      fetch('/api/games/suggest?q=' + encodeURIComponent(query))
        .then((r) => (r.ok ? r.json() : []))
        .then(renderDropdown)
        .catch(() => closeDropdown());
    }, 200);

    input.addEventListener('input', () => {
      if (hiddenId) hiddenId.value = '';
      fetchSuggestions(input.value);
    });

    input.addEventListener('keydown', (e) => {
      if (dropdown.hidden) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, items.length - 1);
        updateActive();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        updateActive();
      } else if (e.key === 'Enter' && activeIndex >= 0) {
        e.preventDefault();
        selectGame(items[activeIndex]);
      } else if (e.key === 'Escape') {
        closeDropdown();
      }
    });

    function updateActive() {
      dropdown.querySelectorAll('.game-search__item').forEach((el, i) => {
        el.classList.toggle('is-active', i === activeIndex);
      });
    }

    dropdown.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-index]');
      if (!btn) return;
      selectGame(items[Number(btn.dataset.index)]);
    });

    document.addEventListener('click', (e) => {
      if (!root.contains(e.target)) closeDropdown();
    });
  }

  document.querySelectorAll('[data-game-search-root]').forEach(initGameSearch);
})();
