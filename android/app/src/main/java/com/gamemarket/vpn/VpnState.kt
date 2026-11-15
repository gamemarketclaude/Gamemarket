package com.gamemarket.vpn

import kotlinx.coroutines.flow.MutableStateFlow

enum class Status { OFF, CONNECTING, ON }

/** Общее состояние VPN между сервисом и экраном (один процесс). */
object VpnState {
    val status = MutableStateFlow(Status.OFF)
    val error = MutableStateFlow<String?>(null)
    val serverName = MutableStateFlow<String?>(null)
}
