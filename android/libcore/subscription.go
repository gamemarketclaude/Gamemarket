package libcore

import (
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Subscription struct {
	Title    string     `json:"title"`
	Announce string     `json:"announce"`   // объявление провайдера
	Support  string     `json:"supportUrl"` // ссылка на поддержку провайдера
	Notices  []string   `json:"notices"`    // служебные «ключи»-заглушки (0.0.0.0) — это сообщения, а не серверы
	Expire   int64      `json:"expire"`     // unix-время, 0 — неизвестно
	Upload   int64      `json:"upload"`
	Download int64      `json:"download"`
	Total    int64      `json:"total"`
	Profiles []*Profile `json:"profiles"`
}

const maxSubBody = 2 << 20

// Device — данные устройства для панелей с лимитом устройств (Remnawave и аналоги).
// Отправляются честно, от имени нашего приложения.
type Device struct {
	HWID, OS, OSVersion, Model string
}

func fetchSubscription(rawURL, userAgent string, dev Device) (*Subscription, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return nil, errors.New("это не ссылка подписки")
	}
	client := &http.Client{Timeout: 20 * time.Second}
	req, _ := http.NewRequest(http.MethodGet, u.String(), nil)
	req.Header.Set("User-Agent", userAgent)
	if dev.HWID != "" {
		req.Header.Set("x-hwid", dev.HWID)
		req.Header.Set("x-device-os", dev.OS)
		req.Header.Set("x-ver-os", dev.OSVersion)
		req.Header.Set("x-device-model", dev.Model)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, errors.New("не удалось загрузить подписку: проверьте интернет и ссылку")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("сервер подписки ответил ошибкой " + strconv.Itoa(resp.StatusCode))
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxSubBody))
	if err != nil {
		return nil, err
	}
	sub := &Subscription{}
	for _, p := range ParseText(string(body)) {
		if isPlaceholder(p) {
			sub.Notices = append(sub.Notices, p.Name)
		} else {
			sub.Profiles = append(sub.Profiles, p)
		}
	}
	if len(sub.Profiles) == 0 {
		if len(sub.Notices) > 0 {
			return nil, errors.New("провайдер не выдал серверы: " + strings.Join(sub.Notices, " · "))
		}
		return nil, errors.New("в подписке нет поддерживаемых серверов (или она истекла)")
	}
	sub.Title = decodeTitle(resp.Header.Get("profile-title"))
	sub.Announce = decodeTitle(resp.Header.Get("announce"))
	if su := resp.Header.Get("support-url"); strings.HasPrefix(su, "https://") || strings.HasPrefix(su, "tg://") {
		sub.Support = su
	}
	for _, part := range strings.Split(resp.Header.Get("subscription-userinfo"), ";") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		n, _ := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
		switch strings.TrimSpace(k) {
		case "upload":
			sub.Upload = n
		case "download":
			sub.Download = n
		case "total":
			sub.Total = n
		case "expire":
			sub.Expire = n
		}
	}
	return sub, nil
}

// isPlaceholder — «ключ»-сообщение: адрес 0.0.0.0 / порт 1 или нулевой UUID.
func isPlaceholder(p *Profile) bool {
	return p.Address == "0.0.0.0" || p.ID == "00000000-0000-0000-0000-000000000000"
}

func decodeTitle(t string) string {
	if rest, ok := strings.CutPrefix(t, "base64:"); ok {
		if b, err := base64.StdEncoding.DecodeString(strings.TrimSpace(rest)); err == nil {
			t = string(b)
		}
	}
	r := []rune(strings.TrimSpace(t))
	if len(r) > 300 {
		r = r[:300]
	}
	return string(r)
}
