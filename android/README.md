# Android-приложение VPN-клиент

Клиент в духе Happ и v2RayTun: вставляете купленный ключ или ссылку подписки, нажимаете одну кнопку, и весь трафик телефона идёт через VPN.

## Что умеет
- Ключи `vless://` (Reality, TLS, XHTTP, WS, gRPC, HTTPUpgrade, Vision, VLESS Encryption), `vmess://`, `trojan://`, `ss://` (включая Shadowsocks 2022).
- Ссылки подписки `https://…` в формате base64 или списком. Показывает название, дату окончания и трафик (заголовки `profile-title`, `subscription-userinfo`). Есть кнопка «Обновить».
- Добавление ключа: из буфера обмена, ручным вводом, через «Поделиться» из мессенджера, по ссылке `vless://…` или `myvpn://import/<ссылка подписки>`.
- Список серверов с TCP-пингом и переключение сервера на лету.
- Весь трафик устройства (IPv4 + IPv6) идёт через туннель, локальная сеть — напрямую. Уведомление с кнопкой «Отключить».

## Как устроено
- `libcore/` — Go-ядро: разбор ключей и подписок, сборка конфига и запуск [Xray-core](https://github.com/XTLS/Xray-core) (MPL-2.0) со встроенным TUN. Покрыто тестами (`go test ./...`), включая живой тест через настоящий VLESS-туннель.
- `app/` — Kotlin + Jetpack Compose: экран, `VpnService`, хранение ключей в приватном хранилище приложения.

## Сборка
APK собирается автоматически в GitHub Actions (`.github/workflows/android.yml`) при каждом пуше в `android/`:
- **Actions → Android APK → последний запуск → Artifacts → apk**: там готовые APK.
- Тег `v0.1.0` (`git tag v0.1.0 && git push --tags`) публикует APK в **Releases**. Ссылку оттуда можно давать пользователям.

Какой APK брать: `myvpn-universal.apk` работает везде. `myvpn-arm64-v8a.apk` — для почти всех современных телефонов, он меньше по размеру.

### Своя подпись (обязательно до раздачи пользователям)
Без неё APK подписан debug-ключом. Он установится, но обновлять его поверх и публиковать в Google Play нельзя.
```bash
keytool -genkeypair -v -keystore release.jks -alias myvpn -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 release.jks   # результат → секрет ANDROID_KEYSTORE_BASE64
```
GitHub → Settings → Secrets and variables → Actions → добавить `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
**Файл `release.jks` и пароли храните в надёжном месте и не коммитьте.** Если ключ потеряется, выпустить обновление для уже установленных приложений будет невозможно.

## Переименование под свой бренд
- Название: `app/src/main/res/values/strings.xml` → `app_name`.
- Идентификатор пакета: `applicationId` в `app/build.gradle.kts`. Менять до первой публикации.
- Схема ссылок `myvpn://`: `AndroidManifest.xml` и `Repo.kt`.
- Иконка: `app/src/main/res/drawable/ic_launcher_foreground.xml`, цвет фона — `values/colors.xml`.
