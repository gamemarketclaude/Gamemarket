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
	Expire   int64      `json:"expire"` // unix-время, 0 — неизвестно
	Upload   int64      `json:"upload"`
	Download int64      `json:"download"`
	Total    int64      `json:"total"`
	Profiles []*Profile `json:"profiles"`
}

const maxSubBody = 2 << 20

func fetchSubscription(rawURL, userAgent string) (*Subscription, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return nil, errors.New("это не ссылка подписки")
	}
	client := &http.Client{Timeout: 20 * time.Second}
	req, _ := http.NewRequest(http.MethodGet, u.String(), nil)
	req.Header.Set("User-Agent", userAgent)
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
	sub := &Subscription{Profiles: ParseText(string(body))}
	if len(sub.Profiles) == 0 {
		return nil, errors.New("в подписке нет поддерживаемых серверов (или она истекла)")
	}
	sub.Title = decodeTitle(resp.Header.Get("profile-title"))
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

func decodeTitle(t string) string {
	if rest, ok := strings.CutPrefix(t, "base64:"); ok {
		if b, err := base64.StdEncoding.DecodeString(rest); err == nil {
			return string(b)
		}
	}
	if len(t) > 64 {
		t = t[:64]
	}
	return t
}
