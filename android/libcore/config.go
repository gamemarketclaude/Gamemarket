package libcore

import (
	"encoding/json"
	"strings"
)

type obj = map[string]any

func streamSettings(p *Profile) obj {
	network := p.Network
	switch network {
	case "", "tcp":
		network = "raw"
	case "splithttp":
		network = "xhttp"
	}
	s := obj{"network": network}
	security := p.Security
	if security == "" {
		security = "none"
	}
	s["security"] = security
	fp := p.Fingerprint
	if fp == "" {
		fp = "chrome"
	}
	switch security {
	case "tls":
		tls := obj{"fingerprint": fp}
		sni := p.SNI
		if sni == "" {
			sni = p.Host
		}
		if sni != "" {
			tls["serverName"] = sni
		}
		if p.ALPN != "" {
			tls["alpn"] = strings.Split(p.ALPN, ",")
		}
		if p.Insecure {
			tls["allowInsecure"] = true
		}
		s["tlsSettings"] = tls
	case "reality":
		s["realitySettings"] = obj{
			"serverName":  p.SNI,
			"fingerprint": fp,
			"publicKey":   p.PublicKey,
			"shortId":     p.ShortID,
			"spiderX":     p.SpiderX,
		}
	}
	switch network {
	case "ws":
		s["wsSettings"] = obj{"path": p.Path, "host": p.Host}
	case "httpupgrade":
		s["httpupgradeSettings"] = obj{"path": p.Path, "host": p.Host}
	case "xhttp":
		x := obj{"path": p.Path, "host": p.Host}
		if p.Mode != "" {
			x["mode"] = p.Mode
		}
		s["xhttpSettings"] = x
	case "grpc":
		s["grpcSettings"] = obj{"serviceName": p.ServiceName}
	}
	return s
}

func proxyOutbound(p *Profile) obj {
	var settings obj
	switch p.Protocol {
	case "vless":
		settings = obj{"address": p.Address, "port": p.Port, "id": p.ID, "flow": p.Flow, "encryption": p.Encryption}
	case "vmess":
		sec := p.Method
		if sec == "" {
			sec = "auto"
		}
		settings = obj{"address": p.Address, "port": p.Port, "id": p.ID, "security": sec}
	case "trojan":
		settings = obj{"address": p.Address, "port": p.Port, "password": p.ID}
	case "shadowsocks":
		settings = obj{"address": p.Address, "port": p.Port, "method": p.Method, "password": p.ID}
	}
	out := obj{"tag": "proxy", "protocol": p.Protocol, "settings": settings}
	if p.Protocol != "shadowsocks" {
		out["streamSettings"] = streamSettings(p)
	}
	return out
}

var privateCIDRs = []string{
	"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16",
	"100.64.0.0/10", "fc00::/7", "fe80::/10", "::1/128",
}

// buildConfig собирает JSON-конфиг Xray. inbound — "tun" для телефона или "socks:<port>" для тестов.
func buildConfig(p *Profile, inbound string) ([]byte, error) {
	var in obj
	if inbound == "tun" {
		in = obj{"tag": "tun-in", "port": 0, "protocol": "tun", "settings": obj{"name": "xray0", "MTU": 1500}}
	} else {
		port := strings.TrimPrefix(inbound, "socks:")
		in = obj{"tag": "socks-in", "listen": "127.0.0.1", "port": json.Number(port), "protocol": "socks", "settings": obj{"udp": true}}
	}
	in["sniffing"] = obj{"enabled": true, "destOverride": []string{"http", "tls", "quic"}, "routeOnly": true}
	cfg := obj{
		"log":      obj{"loglevel": "warning"},
		"inbounds": []obj{in},
		"outbounds": []obj{
			proxyOutbound(p),
			{"tag": "direct", "protocol": "freedom"},
			{"tag": "block", "protocol": "blackhole"},
		},
		"routing": obj{
			"domainStrategy": "AsIs",
			"rules": []obj{
				// локальная сеть (принтер, роутер) — мимо VPN
				{"type": "field", "ip": privateCIDRs, "outboundTag": "direct"},
			},
		},
	}
	return json.Marshal(cfg)
}
