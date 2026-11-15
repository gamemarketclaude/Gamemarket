package com.gamemarket.vpn

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import libcore.Libcore
import org.json.JSONArray
import org.json.JSONObject

/** Добавление ключей и подписок. Разбор делает Go-ядро (Libcore). */
class Repo(context: Context) {
    val storage = Storage(context)

    private fun profilesFrom(arr: JSONArray, subId: String?): List<Server> =
        (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            Server(
                id = Storage.newId(),
                name = o.optString("name"),
                link = o.getString("link"),
                protocol = o.optString("protocol"),
                address = o.optString("address"),
                port = o.optInt("port"),
                subId = subId,
            )
        }

    /** Текст из буфера / поля ввода / ссылки: одиночный ключ, список ключей или ссылка подписки. */
    suspend fun import(rawText: String): String = withContext(Dispatchers.IO) {
        val text = unwrapDeepLink(rawText.trim())
        if (text.isEmpty()) throw IllegalArgumentException("Буфер обмена пуст")
        val isSubUrl = (text.startsWith("https://") || text.startsWith("http://")) &&
            text.lines().size == 1
        if (isSubUrl) {
            addOrUpdateSub(text)
        } else {
            val arr = JSONArray(Libcore.parseKeys(text))
            val existing = storage.servers()
            val fresh = profilesFrom(arr, null).filter { p -> existing.none { it.link == p.link } }
            storage.saveServers(existing + fresh)
            if (storage.selectedId == null) fresh.firstOrNull()?.let { storage.selectedId = it.id }
            if (fresh.isEmpty()) "Эти ключи уже добавлены" else "Добавлено серверов: ${fresh.size}"
        }
    }

    private fun unwrapDeepLink(t: String): String {
        // myvpn://import/<url> и myvpn://add/<url>
        for (prefix in listOf("myvpn://import/", "myvpn://add/")) {
            if (t.startsWith(prefix)) return t.removePrefix(prefix)
        }
        return t
    }

    private fun addOrUpdateSub(url: String): String {
        val js = JSONObject(Libcore.fetchSubscription(url, USER_AGENT))
        val subs = storage.subs()
        val old = subs.find { it.url == url }
        val subId = old?.id ?: Storage.newId()
        val sub = Sub(
            id = subId, url = url,
            title = js.optString("title").ifBlank { "Подписка" },
            expire = js.optLong("expire"), upload = js.optLong("upload"),
            download = js.optLong("download"), total = js.optLong("total"),
            updatedAt = System.currentTimeMillis(),
        )
        storage.saveSubs(subs.filter { it.id != subId } + sub)
        val oldServers = storage.servers()
        val newServers = profilesFrom(js.getJSONArray("profiles"), subId)
        // сохраняем выбранный сервер, если он остался в подписке
        val selected = oldServers.find { it.id == storage.selectedId }
        val merged = newServers.map { n ->
            if (selected != null && selected.subId == subId && selected.link == n.link) n.copy(id = selected.id) else n
        }
        storage.saveServers(oldServers.filter { it.subId != subId } + merged)
        if (storage.servers().none { it.id == storage.selectedId }) {
            storage.selectedId = storage.servers().firstOrNull()?.id
        }
        return "${sub.title}: серверов ${merged.size}"
    }

    suspend fun refreshAll(): String = withContext(Dispatchers.IO) {
        val subs = storage.subs()
        if (subs.isEmpty()) return@withContext "Нет подписок для обновления"
        var ok = 0
        var lastError: String? = null
        for (s in subs) {
            try { addOrUpdateSub(s.url); ok++ } catch (e: Exception) { lastError = e.message }
        }
        if (lastError != null) "Обновлено $ok из ${subs.size}. Ошибка: $lastError" else "Подписки обновлены"
    }

    fun deleteServer(id: String) {
        storage.saveServers(storage.servers().filter { it.id != id })
        if (storage.selectedId == id) storage.selectedId = storage.servers().firstOrNull()?.id
    }

    fun deleteSub(id: String) {
        storage.saveSubs(storage.subs().filter { it.id != id })
        deleteServersOfSub(id)
    }

    private fun deleteServersOfSub(id: String) {
        storage.saveServers(storage.servers().filter { it.subId != id })
        if (storage.servers().none { it.id == storage.selectedId }) {
            storage.selectedId = storage.servers().firstOrNull()?.id
        }
    }

    suspend fun ping(link: String): Long = withContext(Dispatchers.IO) { Libcore.tcpPing(link, 3000) }

    companion object {
        const val USER_AGENT = "MyVPN-Android/1.0"
    }
}
