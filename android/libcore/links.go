package libcore

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

// Profile — один сервер, разобранный из ключа (vless://, vmess://, trojan://, ss://).
type Profile struct {
	Name     string `json:"name"`
	Link     string `json:"link"`
	Protocol string `json:"protocol"`
	Address  string `json:"address"`
	Port     int    `json:"port"`

	// данные для конфигурации ядра (не отдаются в UI)
	ID          string `json:"-"` // uuid (vless/vmess) или пароль (trojan/ss)
	Method      string `json:"-"` // ss cipher / vmess security
	Flow        string `json:"-"`
	Encryption  string `json:"-"`
	Network     string `json:"-"`
	Security    string `json:"-"`
	SNI         string `json:"-"`
	Fingerprint string `json:"-"`
	PublicKey   string `json:"-"`
	ShortID     string `json:"-"`
	SpiderX     string `json:"-"`
	ALPN        string `json:"-"`
	Path        string `json:"-"`
	Host        string `json:"-"`
	ServiceName string `json:"-"`
	Mode        string `json:"-"`
	Insecure    bool   `json:"-"`
}

var errUnsupported = errors.New("неподдерживаемый формат ключа")

// ParseLink разбирает один ключ.
func ParseLink(raw string) (*Profile, error) {
	raw = strings.TrimSpace(raw)
	scheme, _, ok := strings.Cut(raw, "://")
	if !ok {
		return nil, errUnsupported
	}
	var p *Profile
	var err error
	switch strings.ToLower(scheme) {
	case "vless", "trojan":
		p, err = parseURLStyle(raw, strings.ToLower(scheme))
	case "vmess":
		p, err = parseVMess(raw)
	case "ss":
		p, err = parseSS(raw)
	default:
		return nil, errUnsupported
	}
	if err != nil {
		return nil, err
	}
	if p.Address == "" || p.Port <= 0 || p.Port > 65535 {
		return nil, errors.New("в ключе нет адреса или порта")
	}
	if p.Name == "" {
		p.Name = net.JoinHostPort(p.Address, strconv.Itoa(p.Port))
	}
	p.Link = raw
	return p, nil
}

func parseURLStyle(raw, proto string) (*Profile, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("ключ повреждён: %w", err)
	}
	port, _ := strconv.Atoi(u.Port())
	q := u.Query()
	p := &Profile{
		Protocol: proto,
		Name:     u.Fragment,
		Address:  u.Hostname(),
		Port:     port,
		ID:       u.User.Username(),
	}
	if p.ID == "" {
		return nil, errors.New("в ключе нет id/пароля")
	}
	p.Flow = q.Get("flow")
	p.Encryption = q.Get("encryption")
	if p.Encryption == "" {
		p.Encryption = "none"
	}
	p.Network = q.Get("type")
	p.Security = q.Get("security")
	if proto == "trojan" && p.Security == "" {
		p.Security = "tls"
	}
	p.SNI = q.Get("sni")
	if p.SNI == "" {
		p.SNI = q.Get("peer")
	}
	p.Fingerprint = q.Get("fp")
	p.PublicKey = q.Get("pbk")
	p.ShortID = q.Get("sid")
	p.SpiderX = q.Get("spx")
	p.ALPN = q.Get("alpn")
	p.Path = q.Get("path")
	p.Host = q.Get("host")
	p.ServiceName = q.Get("serviceName")
	p.Mode = q.Get("mode")
	p.Insecure = q.Get("allowInsecure") == "1" || q.Get("insecure") == "1"
	return p, nil
}

func decodeB64(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	s = strings.TrimRight(s, "=")
	if b, err := base64.RawStdEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	return base64.RawURLEncoding.DecodeString(s)
}

func parseVMess(raw string) (*Profile, error) {
	body := strings.TrimPrefix(raw[strings.Index(raw, "://")+3:], "")
	b, err := decodeB64(body)
	if err != nil {
		return nil, errors.New("vmess: не base64")
	}
	var v map[string]any
	if err := json.Unmarshal(b, &v); err != nil {
		return nil, errors.New("vmess: не JSON")
	}
	str := func(k string) string {
		switch x := v[k].(type) {
		case string:
			return x
		case float64:
			return strconv.FormatFloat(x, 'f', -1, 64)
		}
		return ""
	}
	port, _ := strconv.Atoi(str("port"))
	p := &Profile{
		Protocol:    "vmess",
		Name:        str("ps"),
		Address:     str("add"),
		Port:        port,
		ID:          str("id"),
		Method:      str("scy"),
		Network:     str("net"),
		Security:    str("tls"),
		SNI:         str("sni"),
		Fingerprint: str("fp"),
		ALPN:        str("alpn"),
		Path:        str("path"),
		Host:        str("host"),
	}
	if p.Network == "grpc" {
		p.ServiceName = p.Path
	}
	if p.Security != "tls" && p.Security != "reality" {
		p.Security = "none"
	}
	if p.ID == "" {
		return nil, errors.New("vmess: нет id")
	}
	return p, nil
}

func parseSS(raw string) (*Profile, error) {
	rest := raw[strings.Index(raw, "://")+3:]
	name := ""
	if i := strings.IndexByte(rest, '#'); i >= 0 {
		name, _ = url.PathUnescape(rest[i+1:])
		rest = rest[:i]
	}
	if i := strings.IndexByte(rest, '?'); i >= 0 { // плагины не поддерживаем
		rest = rest[:i]
	}
	rest = strings.TrimSuffix(rest, "/")
	var userinfo, hostport string
	if at := strings.LastIndexByte(rest, '@'); at >= 0 {
		userinfo, hostport = rest[:at], rest[at+1:]
		if b, err := decodeB64(userinfo); err == nil && strings.Contains(string(b), ":") {
			userinfo = string(b)
		} else if u, err := url.PathUnescape(userinfo); err == nil {
			userinfo = u
		}
	} else { // ss://base64(method:password@host:port)
		b, err := decodeB64(rest)
		if err != nil {
			return nil, errors.New("ss: ключ повреждён")
		}
		at := strings.LastIndexByte(string(b), '@')
		if at < 0 {
			return nil, errors.New("ss: ключ повреждён")
		}
		userinfo, hostport = string(b[:at]), string(b[at+1:])
	}
	method, password, ok := strings.Cut(userinfo, ":")
	if !ok {
		return nil, errors.New("ss: нет метода или пароля")
	}
	host, portS, err := net.SplitHostPort(hostport)
	if err != nil {
		return nil, errors.New("ss: нет адреса или порта")
	}
	port, _ := strconv.Atoi(portS)
	return &Profile{Protocol: "shadowsocks", Name: name, Address: host, Port: port, Method: method, ID: password}, nil
}

// ParseText разбирает текст с ключами: по одному на строку, либо base64 от такого списка.
func ParseText(text string) []*Profile {
	text = strings.TrimSpace(text)
	if !strings.Contains(text, "://") {
		if b, err := decodeB64(strings.Join(strings.Fields(text), "")); err == nil {
			text = string(b)
		}
	}
	var out []*Profile
	for _, line := range strings.Split(text, "\n") {
		if p, err := ParseLink(line); err == nil {
			out = append(out, p)
		}
	}
	return out
}
