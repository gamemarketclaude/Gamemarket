// Форма "Выставить товар":
//  1) поля под игру и раздел: скины (только «Аккаунты», обязательны для
//     Fortnite) и характеристики — Prime/ранг/уровень и т.п.;
//  2) фото добавляются плитками: пустой квадратик с «+» -> выбрали фото ->
//     появляется следующий «+», и так до лимита (10). Фото можно удалить (×)
//     или сделать обложкой (★). На телефоне «+» открывает галерею/камеру.
//
// Как это устроено: браузер не даёт дописывать файлы в <input type="file">,
// поэтому выбранные фото копятся в массиве, а перед отправкой (на каждое
// изменение) собираются в настоящий input name="images" через DataTransfer.
// Если браузер этого не умеет — остаётся обычное поле выбора нескольких файлов.
(function () {
  const form = document.querySelector('[data-sell-form]');
  if (!form) return;

  // ---------- Поля под игру и раздел ----------
  const categorySelect = form.querySelector('[data-sell-category]');
  const gameInput = form.querySelector('#game_id');
  const accountsFields = form.querySelector('[data-sell-accounts-fields]');
  const itemsCountInput = accountsFields ? accountsFields.querySelector('input[name="items_count"]') : null;
  const notableItemsInput = accountsFields ? accountsFields.querySelector('input[name="notable_items"]') : null;
  const extraBox = form.querySelector('[data-sell-extra]');
  const extraGrid = form.querySelector('[data-sell-extra-grid]');

  function readJson(id) {
    const el = document.getElementById(id);
    try { return el ? JSON.parse(el.textContent) : null; } catch (e) { return null; }
  }
  const config = readJson('listing-fields-config') || { common: {}, games: {}, skinsRequired: [] };
  // Уже введённые значения (после ошибки формы или при переключении раздела)
  const values = readJson('listing-fields-values') || {};

  function currentGame() { return gameInput ? gameInput.dataset.slug || '' : ''; }
  function currentCategory() { return categorySelect ? categorySelect.value : ''; }

  function fieldsFor(game, category) {
    const own = (config.games[game] && config.games[game][category]) || [];
    return own.concat(config.common[category] || []);
  }

  // Скины: блок только для «Аккаунтов»; обязателен только для Fortnite
  function syncAccountsFields() {
    if (!accountsFields) return;
    const isAccounts = currentCategory() === 'accounts';
    const required = isAccounts && config.skinsRequired.indexOf(currentGame()) !== -1;
    accountsFields.hidden = !isAccounts;
    if (itemsCountInput) itemsCountInput.required = required;
    if (notableItemsInput) notableItemsInput.required = required;
    accountsFields.querySelectorAll('[data-skins-optional]').forEach((el) => {
      el.textContent = required ? '— обязательно' : '— необязательно';
      el.classList.toggle('is-required', required);
    });
  }

  function rememberValues() {
    extraGrid.querySelectorAll('[name^="attr_"]').forEach((el) => {
      values[el.name] = el.type === 'checkbox' ? (el.checked ? 'on' : '') : el.value;
    });
  }

  function makeField(f) {
    const name = 'attr_' + f.key;
    const saved = values[name];
    const label = document.createElement('label');
    label.className = 'sell-form__extra-field' + (f.type === 'bool' ? ' sell-form__extra-field--check' : '');

    const caption = document.createElement('span');
    caption.textContent = f.label + (f.required ? ' *' : '');

    let control;
    if (f.type === 'select') {
      control = document.createElement('select');
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = f.required ? 'Выберите…' : 'Не указано';
      control.appendChild(empty);
      f.options.forEach((o) => {
        const opt = document.createElement('option');
        opt.value = o;
        opt.textContent = o;
        if (saved === o) opt.selected = true;
        control.appendChild(opt);
      });
    } else if (f.type === 'bool') {
      control = document.createElement('input');
      control.type = 'checkbox';
      control.checked = saved === 'on' || saved === '1' || saved === true;
    } else {
      control = document.createElement('input');
      control.type = f.type === 'number' ? 'number' : 'text';
      if (f.type === 'number') {
        control.min = f.min != null ? f.min : 0;
        if (f.max != null) control.max = f.max;
        control.step = 'any';
        control.inputMode = 'numeric';
      } else {
        control.maxLength = f.maxLength || 80;
      }
      if (f.placeholder) control.placeholder = f.placeholder;
      if (saved) control.value = saved;
    }
    control.name = name;
    if (f.required) control.required = true;

    if (f.type === 'bool') {
      label.appendChild(control);
      label.appendChild(caption);
    } else {
      label.appendChild(caption);
      label.appendChild(control);
    }
    return label;
  }

  function renderExtraFields() {
    if (!extraGrid) return;
    rememberValues();
    extraGrid.innerHTML = '';
    const fields = currentCategory() ? fieldsFor(currentGame(), currentCategory()) : [];
    fields.forEach((f) => extraGrid.appendChild(makeField(f)));
    extraBox.hidden = fields.length === 0;
  }

  function sync() {
    syncAccountsFields();
    renderExtraFields();
  }

  if (categorySelect) categorySelect.addEventListener('change', sync);
  if (gameInput) gameInput.addEventListener('change', sync);
  sync();

  // ---------- Фото плитками ----------
  const nativeInput = form.querySelector('[data-sell-images]');
  const tiles = form.querySelector('[data-sell-tiles]');
  const countLabel = form.querySelector('[data-sell-photo-count]');
  const errorBox = form.querySelector('[data-sell-photo-error]');
  if (!nativeInput || !tiles) return;

  const MAX_IMAGES = Number(tiles.dataset.max) || 10;
  const MAX_SIZE = 5 * 1024 * 1024;
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  function canUseDataTransfer() {
    try {
      const dt = new DataTransfer();
      dt.items.add(new File(['x'], 'x.png', { type: 'image/png' }));
      return dt.files.length === 1;
    } catch (e) {
      return false;
    }
  }
  if (!canUseDataTransfer()) return; // старый браузер — обычное поле выбора файлов

  const photos = []; // { file, url }

  // Отдельный «невидимый» input только для выбора: из него фото переносятся
  // в массив, а сам он каждый раз очищается, чтобы можно было выбрать ещё.
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = ALLOWED_TYPES.join(',');
  picker.multiple = true;
  picker.id = 'sell-photo-picker';
  picker.className = 'visually-hidden';
  picker.tabIndex = -1;
  picker.setAttribute('aria-hidden', 'true');
  form.appendChild(picker);

  nativeInput.hidden = true;
  nativeInput.classList.add('is-enhanced');
  tiles.hidden = false;

  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message || '';
    errorBox.hidden = !message;
  }

  function syncNativeInput() {
    const dt = new DataTransfer();
    photos.forEach((p) => dt.items.add(p.file));
    nativeInput.files = dt.files;
  }

  function makeButton(className, label, text, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function render() {
    tiles.innerHTML = '';

    photos.forEach((photo, index) => {
      const tile = document.createElement('div');
      tile.className = 'photo-tile photo-tile--filled';

      const img = document.createElement('img');
      img.src = photo.url;
      img.alt = `Фото ${index + 1}`;
      tile.appendChild(img);

      if (index === 0) {
        const badge = document.createElement('span');
        badge.className = 'photo-tile__badge';
        badge.textContent = 'Обложка';
        tile.appendChild(badge);
      } else {
        tile.appendChild(makeButton('photo-tile__cover', 'Сделать обложкой', '★', () => {
          photos.unshift(photos.splice(index, 1)[0]);
          update();
        }));
      }

      tile.appendChild(makeButton('photo-tile__remove', 'Удалить фото', '×', () => {
        URL.revokeObjectURL(photo.url);
        photos.splice(index, 1);
        showError('');
        update();
      }));

      tiles.appendChild(tile);
    });

    // Пустой квадратик с «+» — только один, и только пока не достигнут лимит
    if (photos.length < MAX_IMAGES) {
      const add = document.createElement('label');
      add.className = 'photo-tile photo-tile--add';
      add.htmlFor = picker.id;
      add.tabIndex = 0;
      add.setAttribute('role', 'button');
      add.innerHTML = '<span class="photo-tile__plus" aria-hidden="true">+</span>'
        + '<span class="photo-tile__add-text">' + (photos.length ? 'Ещё фото' : 'Добавить фото') + '</span>';
      add.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          picker.click();
        }
      });
      tiles.appendChild(add);
    }

    if (countLabel) {
      countLabel.textContent = photos.length ? `${photos.length} из ${MAX_IMAGES}` : `до ${MAX_IMAGES} шт.`;
    }
  }

  function update() {
    syncNativeInput();
    render();
  }

  picker.addEventListener('change', () => {
    const picked = Array.from(picker.files || []);
    picker.value = '';
    const problems = [];

    for (const file of picked) {
      if (photos.length >= MAX_IMAGES) {
        problems.push(`Можно добавить не больше ${MAX_IMAGES} фото — лишние не добавлены.`);
        break;
      }
      if (!ALLOWED_TYPES.includes(file.type)) {
        problems.push(`«${file.name}»: подходят только JPG, PNG или WEBP.`);
        continue;
      }
      if (file.size > MAX_SIZE) {
        problems.push(`«${file.name}»: файл больше 5 МБ.`);
        continue;
      }
      photos.push({ file, url: URL.createObjectURL(file) });
    }

    showError(problems.join(' '));
    update();
  });

  render();
})();
