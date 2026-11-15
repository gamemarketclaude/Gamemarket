package com.gamemarket.vpn

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class Server(
    val id: String,
    val name: String,
    val link: String,
    val protocol: String,
    val address: String,
    val port: Int,
    val subId: String?,
)

data class Sub(
    val id: String,
    val url: String,
    val title: String,
    val expire: Long,
    val upload: Long,
    val download: Long,
    val total: Long,
    val updatedAt: Long,
)

/** Ключи хранятся в приватном хранилище приложения (недоступно другим приложениям, бэкап выключен). */
class Storage(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("data", Context.MODE_PRIVATE)

    fun servers(): List<Server> {
        val arr = JSONArray(prefs.getString("servers", "[]"))
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            Server(
                id = o.getString("id"),
                name = o.getString("name"),
                link = o.getString("link"),
                protocol = o.optString("protocol"),
                address = o.optString("address"),
                port = o.optInt("port"),
                subId = if (o.isNull("subId")) null else o.optString("subId"),
            )
        }
    }

    fun saveServers(list: List<Server>) {
        val arr = JSONArray()
        list.forEach { s ->
            arr.put(JSONObject().apply {
                put("id", s.id); put("name", s.name); put("link", s.link)
                put("protocol", s.protocol); put("address", s.address); put("port", s.port)
                put("subId", s.subId ?: JSONObject.NULL)
            })
        }
        prefs.edit().putString("servers", arr.toString()).apply()
    }

    fun subs(): List<Sub> {
        val arr = JSONArray(prefs.getString("subs", "[]"))
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            Sub(
                o.getString("id"), o.getString("url"), o.optString("title"),
                o.optLong("expire"), o.optLong("upload"), o.optLong("download"),
                o.optLong("total"), o.optLong("updatedAt"),
            )
        }
    }

    fun saveSubs(list: List<Sub>) {
        val arr = JSONArray()
        list.forEach { s ->
            arr.put(JSONObject().apply {
                put("id", s.id); put("url", s.url); put("title", s.title)
                put("expire", s.expire); put("upload", s.upload); put("download", s.download)
                put("total", s.total); put("updatedAt", s.updatedAt)
            })
        }
        prefs.edit().putString("subs", arr.toString()).apply()
    }

    var selectedId: String?
        get() = prefs.getString("selected", null)
        set(v) = prefs.edit().putString("selected", v).apply()

    fun selected(): Server? = servers().let { list -> list.find { it.id == selectedId } ?: list.firstOrNull() }

    companion object {
        fun newId() = UUID.randomUUID().toString()
    }
}
