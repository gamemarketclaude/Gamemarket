package com.gamemarket.vpn

import android.Manifest
import android.content.ClipboardManager
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

private val Bg = Color(0xFF0D1117)
private val Panel = Color(0xFF161B22)
private val Accent = Color(0xFF3B82F6)
private val Ok = Color(0xFF22C55E)
private val Muted = Color(0xFF8B949E)
private val Danger = Color(0xFFEF4444)

class MainActivity : ComponentActivity() {
    /** Текст, пришедший по ссылке или через «Поделиться». */
    private val incoming = MutableStateFlow<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIntent(intent)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Accent, background = Bg, surface = Panel)) {
                Surface(Modifier.fillMaxSize(), color = Bg) { MainScreen(incoming) }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(i: Intent?) {
        when (i?.action) {
            Intent.ACTION_VIEW -> i.dataString?.let { incoming.value = it }
            Intent.ACTION_SEND -> i.getStringExtra(Intent.EXTRA_TEXT)?.let { incoming.value = it }
        }
    }
}

@Composable
fun MainScreen(incoming: MutableStateFlow<String?>) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val repo = remember { Repo(ctx) }
    val scope = rememberCoroutineScope()

    val status by VpnState.status.collectAsStateWithLifecycle()
    val error by VpnState.error.collectAsStateWithLifecycle()
    var servers by remember { mutableStateOf(repo.storage.servers()) }
    var subs by remember { mutableStateOf(repo.storage.subs()) }
    var selectedId by remember { mutableStateOf(repo.storage.selected()?.id) }
    val pings = remember { mutableStateMapOf<String, Long>() }
    var busy by remember { mutableStateOf(false) }
    var showManual by remember { mutableStateOf(false) }

    fun reload() {
        servers = repo.storage.servers(); subs = repo.storage.subs(); selectedId = repo.storage.selected()?.id
    }
    fun toast(msg: String) = Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show()

    fun doImport(text: String) {
        busy = true
        scope.launch {
            try { toast(repo.import(text)) } catch (e: Exception) { toast(e.message ?: "Ошибка") }
            reload(); busy = false
        }
    }

    val incomingText by incoming.collectAsStateWithLifecycle()
    LaunchedEffect(incomingText) {
        incomingText?.let { doImport(it); incoming.value = null }
    }

    val notifPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33) notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    val vpnPerm = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        if (res.resultCode == android.app.Activity.RESULT_OK) AppVpnService.start(ctx)
        else toast("Без разрешения на VPN подключиться нельзя")
    }

    fun connect() {
        if (repo.storage.selected() == null) { toast("Сначала добавьте ключ"); return }
        val prep = VpnService.prepare(ctx)
        if (prep != null) vpnPerm.launch(prep) else AppVpnService.start(ctx)
    }

    LazyColumn(
        Modifier.fillMaxSize().systemBarsPadding().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Text(
                ctx.getString(R.string.app_name), color = Color.White, fontSize = 22.sp,
                fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 16.dp, bottom = 8.dp)
            )
        }
        item {
            ConnectButton(status) {
                if (status == Status.OFF) connect() else AppVpnService.stop(ctx)
            }
        }
        item {
            val sel = servers.find { it.id == selectedId }
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(sel?.name ?: "Нет серверов", color = Color.White, fontSize = 16.sp)
                error?.let { Text(it, color = Danger, fontSize = 13.sp, textAlign = TextAlign.Center) }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = {
                        val cm = ctx.getSystemService(ClipboardManager::class.java)
                        val text = cm.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(ctx)?.toString()
                        doImport(text ?: "")
                    },
                    enabled = !busy, modifier = Modifier.weight(1f),
                ) { Text("Вставить ключ") }
                OutlinedButton(onClick = { showManual = true }, enabled = !busy, modifier = Modifier.weight(1f)) {
                    Text("Ввести", color = Color.White)
                }
            }
        }
        if (busy) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }

        if (servers.isEmpty()) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = Panel)) {
                    Text(
                        "Скопируйте купленный ключ (vless://, vmess://, trojan://, ss://) или ссылку подписки " +
                            "и нажмите «Вставить ключ». Затем — большую кнопку подключения.",
                        color = Muted, modifier = Modifier.padding(16.dp)
                    )
                }
            }
        }

        if (subs.isNotEmpty()) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Подписки", color = Color.White, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    TextButton(onClick = {
                        busy = true
                        scope.launch { toast(repo.refreshAll()); reload(); busy = false }
                    }, enabled = !busy) { Text("Обновить") }
                }
            }
            items(subs, key = { it.id }) { s ->
                SubCard(s) { repo.deleteSub(s.id); reload() }
            }
        }

        if (servers.isNotEmpty()) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Серверы", color = Color.White, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    TextButton(onClick = {
                        servers.forEach { s -> scope.launch { pings[s.id] = repo.ping(s.link) } }
                    }) { Text("Пинг") }
                }
            }
            items(servers, key = { it.id }) { s ->
                ServerRow(
                    s, selected = s.id == selectedId, ping = pings[s.id],
                    onSelect = {
                        repo.storage.selectedId = s.id; selectedId = s.id
                        if (status != Status.OFF) AppVpnService.start(ctx) // переподключение на новый сервер
                    },
                    onDelete = if (s.subId == null) ({ repo.deleteServer(s.id); reload() }) else null,
                )
            }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }

    if (showManual) {
        var text by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showManual = false },
            title = { Text("Ключ или ссылка подписки") },
            text = {
                OutlinedTextField(text, { text = it }, minLines = 3, maxLines = 8, placeholder = { Text("vless://… или https://…") })
            },
            confirmButton = { TextButton(onClick = { showManual = false; doImport(text) }) { Text("Добавить") } },
            dismissButton = { TextButton(onClick = { showManual = false }) { Text("Отмена") } },
        )
    }
}

@Composable
private fun ConnectButton(status: Status, onClick: () -> Unit) {
    val color = when (status) { Status.ON -> Ok; Status.CONNECTING -> Accent.copy(alpha = 0.6f); Status.OFF -> Accent }
    val label = when (status) { Status.ON -> "Отключить"; Status.CONNECTING -> "Подключение…"; Status.OFF -> "Подключить" }
    Box(Modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier.size(180.dp).clip(CircleShape).background(color).clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(if (status == Status.ON) "Защищено" else "", color = Color.White, fontSize = 13.sp)
                Text(label, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun SubCard(s: Sub, onDelete: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = Panel)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(s.title, color = Color.White, fontWeight = FontWeight.SemiBold)
                val parts = mutableListOf<String>()
                if (s.expire > 0) {
                    val d = DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(s.expire * 1000))
                    parts += if (s.expire * 1000 < System.currentTimeMillis()) "истекла $d" else "до $d"
                }
                if (s.total > 0) parts += "трафик ${gb(s.upload + s.download)} из ${gb(s.total)}"
                if (parts.isNotEmpty()) Text(parts.joinToString(" · "), color = Muted, fontSize = 13.sp)
                if (s.announce.isNotBlank()) Text(s.announce, color = Color.White, fontSize = 13.sp)
                if (s.supportUrl.isNotBlank()) {
                    val ctx = androidx.compose.ui.platform.LocalContext.current
                    Text(
                        "Поддержка провайдера", color = Accent, fontSize = 13.sp,
                        modifier = Modifier.clickable {
                            try {
                                ctx.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(s.supportUrl)))
                            } catch (_: Exception) {}
                        }
                    )
                }
            }
            TextButton(onClick = onDelete) { Text("Удалить", color = Danger) }
        }
    }
}

private fun gb(bytes: Long) = String.format("%.1f ГБ", bytes / 1_073_741_824.0)

@Composable
private fun ServerRow(s: Server, selected: Boolean, ping: Long?, onSelect: () -> Unit, onDelete: (() -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
            .background(if (selected) Accent.copy(alpha = 0.18f) else Panel)
            .clickable(onClick = onSelect).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = onSelect)
        Column(Modifier.weight(1f)) {
            Text(s.name, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(s.protocol.uppercase(), color = Muted, fontSize = 12.sp)
        }
        when {
            ping == null -> {}
            ping < 0 -> Text("нет ответа", color = Danger, fontSize = 12.sp)
            else -> Text("$ping мс", color = if (ping < 300) Ok else Muted, fontSize = 12.sp)
        }
        if (onDelete != null) TextButton(onClick = onDelete) { Text("✕", color = Muted) }
    }
}
