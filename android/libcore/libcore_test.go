package libcore

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/xtls/xray-core/core"
	"github.com/xtls/xray-core/infra/conf/serial"
	"golang.org/x/net/proxy"
)

const realityKey = "vless://3cc4934a-c2a4-4b4d-bf1d-4378d880ce54@1.2.3.4:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=XlvrUi8Yrnpymlvn5CVzKhORspAbkjVhTCs50kcHJ1Y&sid=a1b2c3d4&type=tcp#%F0%9F%87%B3%F0%9F%87%B1%20NL"

func TestParseVariants(t *testing.T) {
	vmessJSON := `{"v":"2","ps":"VM","add":"ex.com","port":"443","id":"3cc4934a-c2a4-4b4d-bf1d-4378d880ce54","net":"ws","path":"/ws","host":"ex.com","tls":"tls","sni":"ex.com"}`
	cases := []struct {
		link, proto, addr string
		port              int
		name              string
	}{
		{realityKey, "vless", "1.2.3.4", 443, "🇳🇱 NL"},
		{"vless://3cc4934a-c2a4-4b4d-bf1d-4378d880ce54@[2001:db8::1]:8443?type=grpc&serviceName=gs&security=tls&sni=a.com#v6", "vless", "2001:db8::1", 8443, "v6"},
		{"trojan://pass%40word@tr.example.com:443?type=ws&path=%2Fp#TR", "trojan", "tr.example.com", 443, "TR"},
		{"vmess://" + base64.StdEncoding.EncodeToString([]byte(vmessJSON)), "vmess", "ex.com", 443, "VM"},
		{"ss://" + base64.RawURLEncoding.EncodeToString([]byte("aes-256-gcm:secret")) + "@ss.example.com:8388#SS", "shadowsocks", "ss.example.com", 8388, "SS"},
		{"ss://2022-blake3-aes-128-gcm:YWJjZGVmZ2hpamtsbW5vcA%3D%3D@1.1.1.1:443#SS22", "shadowsocks", "1.1.1.1", 443, "SS22"},
		{"ss://" + base64.StdEncoding.EncodeToString([]byte("chacha20-ietf-poly1305:pw@9.9.9.9:1234")) + "#Old", "shadowsocks", "9.9.9.9", 1234, "Old"},
	}
	for _, c := range cases {
		p, err := ParseLink(c.link)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if p.Protocol != c.proto || p.Address != c.addr || p.Port != c.port || p.Name != c.name {
			t.Fatalf("%s: got %+v", c.name, p)
		}
		// конфиг должен приниматься самим Xray
		cfg, err := buildConfig(p, "socks:10999")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := serial.LoadJSONConfig(strings.NewReader(string(cfg))); err != nil {
			t.Fatalf("%s: xray rejected config: %v\n%s", c.name, err, cfg)
		}
	}
	if p, _ := ParseLink(cases[2].link); p.ID != "pass@word" || p.Security != "tls" {
		t.Fatalf("trojan: %+v", p)
	}
	for _, bad := range []string{"", "hello", "http://x.com", "vless://@:0", "vmess://!!!", "ss://bad"} {
		if _, err := ParseLink(bad); err == nil {
			t.Fatalf("expected error for %q", bad)
		}
	}
}

func TestTunConfigLoads(t *testing.T) {
	p, _ := ParseLink(realityKey)
	cfg, _ := buildConfig(p, "tun")
	if _, err := serial.LoadJSONConfig(strings.NewReader(string(cfg))); err != nil {
		t.Fatalf("tun config rejected: %v\n%s", err, cfg)
	}
}

func TestParseTextAndSubscription(t *testing.T) {
	list := realityKey + "\r\ntrash\n" + "trojan://pw@t.com:443#T\n"
	if n := len(ParseText(list)); n != 2 {
		t.Fatalf("plain list: %d", n)
	}
	if n := len(ParseText(base64.StdEncoding.EncodeToString([]byte(list)))); n != 2 {
		t.Fatalf("base64 list: %d", n)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-hwid") == "" { // как панели с лимитом устройств
			io.WriteString(w, base64.StdEncoding.EncodeToString([]byte(
				"vless://00000000-0000-0000-0000-000000000000@0.0.0.0:1?type=tcp#%E2%9D%8C%20%D0%9F%D1%80%D0%B8%D0%BB%D0%BE%D0%B6%D0%B5%D0%BD%D0%B8%D0%B5%20%D0%BD%D0%B5%20%D0%BF%D0%BE%D0%B4%D0%B4%D0%B5%D1%80%D0%B6%D0%B8%D0%B2%D0%B0%D0%B5%D1%82%D1%81%D1%8F")))
			return
		}
		if r.Header.Get("x-device-os") != "Android" || r.Header.Get("User-Agent") != "test" {
			w.WriteHeader(400)
			return
		}
		w.Header().Set("announce", "base64:"+base64.StdEncoding.EncodeToString([]byte("Выберите сервер")))
		w.Header().Set("support-url", "https://t.me/support")
		w.Header().Set("profile-title", "base64:"+base64.StdEncoding.EncodeToString([]byte("Мой VPN")))
		w.Header().Set("subscription-userinfo", "upload=1; download=2; total=3; expire=1797362923")
		io.WriteString(w, base64.StdEncoding.EncodeToString([]byte(list)))
	}))
	defer srv.Close()
	_, err := FetchSubscription(srv.URL, "test", "", "", "", "")
	if err == nil || !strings.Contains(err.Error(), "Приложение не поддерживается") {
		t.Fatalf("placeholder must become readable error, got %v", err)
	}
	js, err := FetchSubscription(srv.URL, "test", "abc123", "Android", "14", "Pixel")
	if err != nil {
		t.Fatal(err)
	}
	var s Subscription
	json.Unmarshal([]byte(js), &s)
	if s.Announce != "Выберите сервер" || s.Support != "https://t.me/support" {
		t.Fatalf("announce/support: %+v", s)
	}
	if s.Title != "Мой VPN" || s.Expire != 1797362923 || s.Total != 3 || len(s.Profiles) != 2 {
		t.Fatalf("sub: %+v", s)
	}
	if strings.Contains(js, "3cc4934a") == false || strings.Contains(js, `"ID"`) {
		t.Fatalf("json must contain link but not internal fields: %s", js)
	}
	if _, err := FetchSubscription("ftp://x", "t", "", "", "", ""); err == nil {
		t.Fatal("ftp must fail")
	}
}

func freePort(t *testing.T) int {
	l, _ := net.Listen("tcp", "127.0.0.1:0")
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

// Живой тест: поднимаем VLESS-сервер на Xray, клиент из нашего конфига, HTTP-запрос через туннель.
func TestEndToEndVLESS(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "через-туннель") }))
	defer target.Close()

	vport, sport := freePort(t), freePort(t)
	uuid := "3cc4934a-c2a4-4b4d-bf1d-4378d880ce54"
	serverCfg := fmt.Sprintf(`{"log":{"loglevel":"none"},"inbounds":[{"listen":"127.0.0.1","port":%d,"protocol":"vless","settings":{"clients":[{"id":"%s"}],"decryption":"none"},"streamSettings":{"network":"raw"}}],"outbounds":[{"protocol":"freedom"}]}`, vport, uuid)
	sc, err := serial.LoadJSONConfig(strings.NewReader(serverCfg))
	if err != nil {
		t.Fatal(err)
	}
	server, err := core.New(sc)
	if err != nil {
		t.Fatal(err)
	}
	server.Start()
	defer server.Close()

	p, err := ParseLink(fmt.Sprintf("vless://%s@127.0.0.1:%d?type=tcp&security=none#local", uuid, vport))
	if err != nil {
		t.Fatal(err)
	}
	cfg, _ := buildConfig(p, fmt.Sprintf("socks:%d", sport))
	// для теста убираем правило «локальная сеть напрямую», чтобы 127.0.0.1 пошёл через VLESS
	var m map[string]any
	json.Unmarshal(cfg, &m)
	m["routing"] = map[string]any{"rules": []any{}}
	cfg, _ = json.Marshal(m)
	if err := startConfig(cfg); err != nil {
		t.Fatal(err)
	}
	defer Stop()
	if !IsRunning() {
		t.Fatal("not running")
	}

	dialer, _ := proxy.SOCKS5("tcp", fmt.Sprintf("127.0.0.1:%d", sport), nil, proxy.Direct)
	hc := &http.Client{Transport: &http.Transport{Dial: dialer.Dial}, Timeout: 5 * time.Second}
	resp, err := hc.Get(target.URL)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	if string(b) != "через-туннель" {
		t.Fatalf("body %q", b)
	}

	// Неверный UUID — трафик не должен пройти.
	Stop()
	p2, _ := ParseLink(fmt.Sprintf("vless://00000000-0000-0000-0000-000000000000@127.0.0.1:%d?type=tcp#bad", vport))
	cfg2, _ := buildConfig(p2, fmt.Sprintf("socks:%d", sport))
	json.Unmarshal(cfg2, &m)
	m["routing"] = map[string]any{"rules": []any{}}
	cfg2, _ = json.Marshal(m)
	if err := startConfig(cfg2); err != nil {
		t.Fatal(err)
	}
	hc2 := &http.Client{Transport: &http.Transport{Dial: dialer.Dial, DisableKeepAlives: true}, Timeout: 5 * time.Second}
	if _, err := hc2.Get(target.URL); err == nil {
		t.Fatal("wrong uuid must not work")
	}
	if ms := TcpPing(fmt.Sprintf("vless://%s@127.0.0.1:%d#x", uuid, vport), 1000); ms < 0 {
		t.Fatal("ping failed")
	}
}
