package com.cfmanager.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.*
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var loadingText: TextView
    private lateinit var handler: Handler
    private var serverCheckRunnable: Runnable? = null
    private var checkCount = 0
    private val SERVER_PORT = 38765

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        progressBar = findViewById(R.id.progressBar)
        swipeRefresh = findViewById(R.id.swipeRefresh)
        loadingText = findViewById(R.id.loadingText)
        handler = Handler(Looper.getMainLooper())

        setupWebView()
        setupBackPressedHandler()
        startNodeService()
        startServerCheck()
    }

    private fun setupWebView() {
        val settings = webView.settings
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

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
                    return false
                }
                // Open external links in browser
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                startActivity(intent)
                return true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                progressBar.visibility = View.GONE
                swipeRefresh.isRefreshing = false
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                super.onProgressChanged(view, newProgress)
                if (newProgress < 100) {
                    progressBar.visibility = View.VISIBLE
                    progressBar.progress = newProgress
                } else {
                    progressBar.visibility = View.GONE
                }
            }
        }

        swipeRefresh.setOnRefreshListener {
            webView.reload()
        }
        
        // Fix swipe refresh conflict with webview scroll
        // Only allow swipe refresh when webview cannot scroll up further (at the top)
        swipeRefresh.setOnChildScrollUpCallback { _, _ ->
            webView.canScrollVertically(-1)
        }
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
        loadingText.visibility = View.VISIBLE
        webView.visibility = View.GONE
        loadingText.text = "正在启动服务..."
        
        val checkRunnable = object : Runnable {
            override fun run() {
                val self = this
                checkCount++
                if (checkCount > 120) {
                    val error = NodeService.getStartupError()
                    if (error != null) {
                        loadingText.text = "启动失败: $error"
                    } else {
                        loadingText.text = "启动超时，请重启应用"
                    }
                    progressBar.visibility = View.GONE
                    return
                }
                
                // Check for startup error
                val error = NodeService.getStartupError()
                if (error != null) {
                    loadingText.text = "启动失败: $error"
                    progressBar.visibility = View.GONE
                    return
                }
                
                loadingText.text = "正在启动服务... (${checkCount}s)"
                
                if (NodeService.isServerReady()) {
                    loadApp()
                    return
                }
                
                // Also try to check via HTTP
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
                            loadApp()
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

    private fun loadApp() {
        loadingText.visibility = View.GONE
        webView.visibility = View.VISIBLE
        webView.loadUrl("http://127.0.0.1:$SERVER_PORT/")
    }

    private fun setupBackPressedHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    override fun onDestroy() {
        serverCheckRunnable?.let {
            handler.removeCallbacks(it)
        }
        webView.stopLoading()
        webView.destroy()
        super.onDestroy()
    }
}
