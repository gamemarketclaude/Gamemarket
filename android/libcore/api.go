// Package libcore — ядро VPN-клиента: разбор ключей и подписок, запуск Xray-core.
// Экспортируемые функции вызываются из Kotlin через gomobile.
package libcore

import (
	"encoding/json"
	"errors"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/xtls/xray-core/core"
	"github.com/xtls/xray-core/infra/conf/serial"
	_ "github.com/xtls/xray-core/main/distro/all"
)

var (
	mu       sync.Mutex
	instance *core.Instance
)

// ParseKeys разбирает вставленный пользователем текст (ключи или base64-список).
// Возвращает JSON-массив профилей.
func ParseKeys(text string) (string, error) {
	ps := ParseText(text)
	if len(ps) == 0 {
		return "", errors.New("не нашли ни одного ключа. Поддерживаются vless://, vmess://, trojan://, ss:// и ссылки подписки")
	}
	b, err := json.Marshal(ps)
	return string(b), err
}

// FetchSubscription скачивает подписку. hwid и данные устройства отправляются в
// стандартных заголовках x-hwid / x-device-os / x-ver-os / x-device-model.
// Возвращает JSON Subscription.
func FetchSubscription(url, userAgent, hwid, deviceOS, osVersion, model string) (string, error) {
	sub, err := fetchSubscription(url, userAgent, Device{hwid, deviceOS, osVersion, model})
	if err != nil {
		return "", err
	}
	b, err := json.Marshal(sub)
	return string(b), err
}

// Start запускает ядро для ключа link, используя TUN-дескриптор от Android VpnService.
func Start(link string, tunFd int32) error {
	p, err := ParseLink(link)
	if err != nil {
		return err
	}
	cfg, err := buildConfig(p, "tun")
	if err != nil {
		return err
	}
	if err := os.Setenv("xray.tun.fd", strconv.Itoa(int(tunFd))); err != nil {
		return err
	}
	return startConfig(cfg)
}

func startConfig(cfg []byte) error {
	mu.Lock()
	defer mu.Unlock()
	if instance != nil {
		_ = instance.Close()
		instance = nil
	}
	config, err := serial.LoadJSONConfig(strings.NewReader(string(cfg)))
	if err != nil {
		return errors.New("ошибка конфигурации: " + err.Error())
	}
	inst, err := core.New(config)
	if err != nil {
		return errors.New("ошибка запуска ядра: " + err.Error())
	}
	if err := inst.Start(); err != nil {
		_ = inst.Close()
		return errors.New("ошибка запуска ядра: " + err.Error())
	}
	instance = inst
	return nil
}

// Stop останавливает ядро.
func Stop() error {
	mu.Lock()
	defer mu.Unlock()
	if instance == nil {
		return nil
	}
	err := instance.Close()
	instance = nil
	return err
}

func IsRunning() bool {
	mu.Lock()
	defer mu.Unlock()
	return instance != nil
}

// TcpPing — время TCP-подключения к серверу ключа в мс, или -1.
func TcpPing(link string, timeoutMs int32) int64 {
	p, err := ParseLink(link)
	if err != nil {
		return -1
	}
	start := time.Now()
	c, err := net.DialTimeout("tcp", net.JoinHostPort(p.Address, strconv.Itoa(p.Port)), time.Duration(timeoutMs)*time.Millisecond)
	if err != nil {
		return -1
	}
	_ = c.Close()
	return time.Since(start).Milliseconds()
}

func CoreVersion() string { return core.Version() }
