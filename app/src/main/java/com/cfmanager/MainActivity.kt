package com.cfmanager.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.*
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import top.yukonga.miuix.kmp.basic.NavigationBar
import top.yukonga.miuix.kmp.basic.NavigationBarItem
import top.yukonga.miuix.kmp.basic.Scaffold
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme

data class NavItem(
    val route: String,
    val path: String,
    val labelRes: Int,
    val icon: ImageVector
)

val navItems = listOf(
    NavItem("dashboard", "/", R.string.nav_dashboard, Icons.Outlined.Dashboard),
    NavItem("accounts", "/accounts", R.string.nav_accounts, Icons.Outlined.Person),
    NavItem("dns", "/dns", R.string.nav_dns, Icons.Outlined.Dns),
    NavItem("workers", "/workers", R.string.nav_workers, Icons.Outlined.Code),
    NavItem("settings", "/settings", R.string.nav_settings, Icons.Outlined.Settings)
)

class MainActivity : ComponentActivity() {
    private var webView: WebView? = null
    private var swipeRefresh: SwipeRefreshLayout? = null
    private val handler = Handler(Looper.getMainLooper())
    private var serverCheckRunnable: Runnable? = null
    private var checkCount = 0
    private val SERVER_PORT = 38765

    private var isServerReady = mutableStateOf(false)
    private var loadingMessage = mutableStateOf("")
    private var currentRoute = mutableStateOf("dashboard")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        startNodeService()

        setContent {
            MiuixTheme {
                CFManagerApp()
            }
        }

        startServerCheck()
    }

    @Composable
    fun CFManagerApp() {
        val context = LocalContext.current

        Scaffold(
            bottomBar = {
                if (isServerReady.value) {
                    NavigationBar {
                        navItems.forEach { item ->
                            NavigationBarItem(
                                selected = currentRoute.value == item.route,
                                onClick = {
                                    navigateTo(item.path)
                                    currentRoute.value = item.route
                                },
                                icon = item.icon,
                                label = stringResource(item.labelRes)
                            )
                        }
                    }
                }
            }
        ) { padding ->
            Box(modifier = Modifier.padding(padding)) {
                if (isServerReady.value) {
                    WebViewContainer()
                } else {
                    LoadingScreen()
                }
            }
        }

        BackHandler(enabled = isServerReady.value) {
            if (webView?.canGoBack() == true) {
                webView?.goBack()
            } else {
                finish()
            }
        }
    }

    @Composable
    fun LoadingScreen() {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            CircularProgressIndicator()
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = loadingMessage.value,
            )
        }
    }

    @Composable
    fun WebViewContainer() {
        val context = LocalContext.current
        AndroidView(
            factory = { ctx ->
                val layout = LinearLayout(ctx).apply {
                    orientation = LinearLayout.VERTICAL
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.MATCH_PARENT
                    )
                }

                swipeRefresh = SwipeRefreshLayout(ctx).apply {
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.MATCH_PARENT
                    )
                }

                webView = WebView(ctx).apply {
                    layoutParams = FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT
                    )
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.databaseEnabled = true
                    settings.setSupportZoom(true)
                    settings.builtInZoomControls = true
                    settings.displayZoomControls = false
                    settings.useWideViewPort = true
                    settings.loadWithOverviewMode = true
                    settings.cacheMode = WebSettings.LOAD_DEFAULT
                    settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                    settings.mediaPlaybackRequiresUserGesture = false

                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(
                            view: WebView?,
                            request: WebResourceRequest?
                        ): Boolean {
                            val url = request?.url?.toString() ?: return false
                            if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
                                return false
                            }
                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                            context.startActivity(intent)
                            return true
                        }

                        override fun onPageFinished(view: WebView?, url: String?) {
                            super.onPageFinished(view, url)
                            swipeRefresh?.isRefreshing = false
                            url?.let { updateCurrentRoute(it) }
                        }
                    }

                    webChromeClient = object : WebChromeClient() {}
                }

                swipeRefresh?.addView(webView)
                layout.addView(swipeRefresh)

                swipeRefresh?.setOnRefreshListener {
                    webView?.reload()
                }

                swipeRefresh?.setOnChildScrollUpCallback { _, _ ->
                    webView?.canScrollVertically(-1) ?: false
                }

                layout
            },
            update = {
                // 首次加载
                if (webView?.url == null) {
                    webView?.loadUrl("http://127.0.0.1:$SERVER_PORT/")
                }
            },
            modifier = Modifier.fillMaxSize()
        )
    }

    private fun navigateTo(path: String) {
        webView?.let { wv ->
            wv.evaluateJavascript(
                "window.location.href = '$path';",
                null
            )
        }
    }

    private fun updateCurrentRoute(url: String) {
        val path = url.substringAfter("127.0.0.1:$SERVER_PORT", "")
            .substringAfter("localhost:$SERVER_PORT", "")
            .trimEnd('/')
        
        val route = when (path) {
            "", "/" -> "dashboard"
            "/accounts" -> "accounts"
            "/dns" -> "dns"
            "/workers" -> "workers"
            "/settings" -> "settings"
            else -> {
                // 对于子页面，尝试匹配一级路由
                navItems.find { path.startsWith(it.path) && it.path != "/" }?.route ?: currentRoute.value
            }
        }
        currentRoute.value = route
    }

    private fun startNodeService() {
        val intent = Intent(this, NodeService::class.java)
        intent.action = NodeService.ACTION_START
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun startServerCheck() {
        checkCount = 0
        loadingMessage.value = getString(R.string.loading_server)

        val checkRunnable = object : Runnable {
            override fun run() {
                val self = this
                checkCount++
                if (checkCount > 120) {
                    val error = NodeService.getStartupError()
                    loadingMessage.value = if (error != null) {
                        getString(R.string.startup_failed, error)
                    } else {
                        getString(R.string.startup_timeout)
                    }
                    return
                }

                val error = NodeService.getStartupError()
                if (error != null) {
                    loadingMessage.value = getString(R.string.startup_failed, error)
                    return
                }

                loadingMessage.value = getString(R.string.loading_server_with_count, checkCount)

                if (NodeService.isServerReady()) {
                    onServerReady()
                    return
                }

                Thread {
                    var isReady = false
                    try {
                        val url = java.net.URL("http://127.0.0.1:$SERVER_PORT/api/health")
                        val conn = url.openConnection() as java.net.HttpURLConnection
                        conn.connectTimeout = 1000
                        conn.readTimeout = 1000
                        val code = conn.responseCode
                        if (code == 200) {
                            isReady = true
                        }
                    } catch (e: Exception) {
                        // Server not ready yet
                    }

                    if (isReady) {
                        runOnUiThread {
                            onServerReady()
                        }
                    } else {
                        runOnUiThread {
                            handler.postDelayed(self, 1000)
                        }
                    }
                }.start()
            }
        }

        serverCheckRunnable = checkRunnable
        handler.postDelayed(checkRunnable, 2000)
    }

    private fun onServerReady() {
        isServerReady.value = true
    }

    override fun onDestroy() {
        serverCheckRunnable?.let {
            handler.removeCallbacks(it)
        }
        webView?.stopLoading()
        webView?.destroy()
        webView = null
        super.onDestroy()
    }
}
