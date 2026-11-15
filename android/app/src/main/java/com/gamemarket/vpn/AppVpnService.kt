package com.gamemarket.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import libcore.Libcore

class AppVpnService : VpnService() {

    private var tun: ParcelFileDescriptor? = null
    private val lock = Any()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopVpn()
            return START_NOT_STICKY
        }
        val server = Storage(this).selected()
        if (server == null) {
            VpnState.error.value = "Сначала добавьте ключ"
            stopVpn()
            return START_NOT_STICKY
        }
        // startForeground — сразу, иначе Android убьёт сервис.
        showNotification(server.name)
        VpnState.status.value = Status.CONNECTING
        VpnState.serverName.value = server.name
        VpnState.error.value = null
        Thread { startVpn(server) }.start()
        return START_NOT_STICKY
    }

    private fun startVpn(server: Server) = synchronized(lock) {
        try {
            closeTun()
            Libcore.stop()
            val builder = Builder()
                .setSession(server.name)
                .setMtu(1500)
                .addAddress("172.19.0.1", 30)
                .addRoute("0.0.0.0", 0)
                .addDnsServer("1.1.1.1")
                .addDnsServer("8.8.8.8")
            try {
                // IPv6 тоже заворачиваем в туннель, чтобы не было утечек мимо VPN.
                builder.addAddress("fdfe:dcba:9876::1", 126).addRoute("::", 0)
            } catch (_: Exception) {
            }
            // Само приложение (ядро Xray) ходит в интернет напрямую — иначе петля.
            builder.addDisallowedApplication(packageName)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) builder.setMetered(false)
            val pfd = builder.establish() ?: throw IllegalStateException("Нет разрешения на VPN")
            tun = pfd
            Libcore.start(server.link, pfd.fd)
            VpnState.status.value = Status.ON
        } catch (e: Exception) {
            VpnState.error.value = e.message ?: "Не удалось подключиться"
            stopVpn()
        }
    }

    private fun closeTun() {
        try { tun?.close() } catch (_: Exception) {}
        tun = null
    }

    private fun stopVpn() {
        synchronized(lock) {
            try { Libcore.stop() } catch (_: Exception) {}
            closeTun()
        }
        VpnState.status.value = Status.OFF
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onRevoke() = stopVpn() // пользователь отключил VPN в настройках или включил другой

    override fun onDestroy() {
        synchronized(lock) {
            try { Libcore.stop() } catch (_: Exception) {}
            closeTun()
        }
        VpnState.status.value = Status.OFF
        super.onDestroy()
    }

    private fun showNotification(serverName: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "VPN", NotificationManager.IMPORTANCE_LOW)
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, AppVpnService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE
        )
        val n = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.app_name))
            .setContentText("Подключено: $serverName")
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null, "Отключить", stop).build())
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, n)
        }
    }

    companion object {
        private const val CHANNEL = "vpn"
        private const val NOTIFICATION_ID = 1
        const val ACTION_STOP = "com.gamemarket.vpn.STOP"

        fun start(ctx: Context) {
            ctx.startForegroundService(Intent(ctx, AppVpnService::class.java))
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, AppVpnService::class.java).setAction(ACTION_STOP))
        }
    }
}
