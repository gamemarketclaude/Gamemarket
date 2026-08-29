// Форма "Выставить товар": показывает поля, обязательные только для категории
// "Аккаунты", и рисует превью выбранных фото (до 4 шт.) перед отправкой.
(function () {
  const form = document.querySelector('[data-sell-form]');
  if (!form) return;

  const categorySelect = form.querySelector('[data-sell-category]');
  const accountsFields = form.querySelector('[data-sell-accounts-fields]');
  const itemsCountInput = accountsFields ? accountsFields.querySelector('input[name="items_count"]') : null;
  const notableItemsInput = accountsFields ? accountsFields.querySelector('input[name="notable_items"]') : null;

  function syncAccountsFields() {
    const isAccounts = categorySelect.value === 'accounts';
    accountsFields.hidden = !isAccounts;
    if (itemsCountInput) itemsCountInput.required = isAccounts;
    if (notableItemsInput) notableItemsInput.required = isAccounts;
  }

  if (categorySelect && accountsFields) {
    categorySelect.addEventListener('change', syncAccountsFields);
    syncAccountsFields();
  }

  const imagesInput = form.querySelector('[data-sell-images]');
  const previews = form.querySelector('[data-sell-previews]');
  const MAX_IMAGES = 4;

  if (imagesInput && previews) {
    imagesInput.addEventListener('change', () => {
      previews.innerHTML = '';
      let files = Array.from(imagesInput.files || []);

      // Если выбрали больше MAX_IMAGES — обрезаем сам список файлов, чтобы
      // превью совпадало с тем, что реально уйдёт на сервер при отправке.
      if (files.length > MAX_IMAGES && typeof DataTransfer !== 'undefined') {
        files = files.slice(0, MAX_IMAGES);
        const dt = new DataTransfer();
        files.forEach((file) => dt.items.add(file));
        imagesInput.files = dt.files;

        const note = document.createElement('p');
        note.className = 'sell-form__hint';
        note.textContent = `Можно выбрать не больше ${MAX_IMAGES} фото — оставлены первые ${MAX_IMAGES}.`;
        previews.appendChild(note);
      }

      files.forEach((file) => {
        const url = URL.createObjectURL(file);
        const fig = document.createElement('figure');
        fig.className = 'sell-form__preview';
        const img = document.createElement('img');
        img.src = url;
        img.alt = file.name;
        fig.appendChild(img);
        previews.appendChild(fig);
      });
    });
  }
})();
