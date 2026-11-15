'use strict';
document.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-copy]');
  if (!btn) return;
  var input = document.getElementById(btn.getAttribute('data-copy'));
  if (!input) return;
  var done = function () { var t = btn.textContent; btn.textContent = 'Скопировано'; setTimeout(function () { btn.textContent = t; }, 1500); };
  if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(done, function () { input.select(); });
  else { input.select(); document.execCommand('copy'); done(); }
});
document.addEventListener('submit', function (e) {
  var msg = e.target.getAttribute('data-confirm');
  if (msg && !window.confirm(msg)) e.preventDefault();
});
