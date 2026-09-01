package com.cfmanager.app

import android.app.*
import android.content.Intent
import android.os.*
import android.util.Log
import androidx.core.app.NotificationCompat
import java.io.*

class NodeService : Service() {
    private val TAG = "NodeService"
    private val CHANNEL_ID = "cf_manager_node_service"
    private val NOTIFICATION_ID = 1
    private val SERVER_PORT = 38765
    
    private var nodeProcess: java.lang.Process? = null
    private var isRunning = false
    private var serverReady = false
    private var startupError: String? = null

    companion object {
        const val ACTION_START = "com.cfmanager.app.START_NODE"
        const val ACTION_STOP = "com.cfmanager.app.STOP_NODE"
        const val ACTION_STATUS = "com.cfmanager.app.STATUS_NODE"
        
        @Volatile
        private var instance: NodeService? = null
        
        fun isServerReady(): Boolean {
            return instance?.serverReady ?: false
        }
        
        fun getServerPort(): Int {
            return instance?.SERVER_PORT ?: 38765
        }
        
        fun getStartupError(): String? {
            return instance?.startupError
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startNode()
            ACTION_STOP -> stopNode()
        }
        return START_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "CF Manager 后台服务",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "运行本地 Node.js 服务器"
            }
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun startForegroundService() {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("CF Manager")
            .setContentText("后台服务运行中...")
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setOngoing(true)
            .build()
        
        startForeground(NOTIFICATION_ID, notification)
    }

    private fun getNodeFilesDir(): File {
        return File(filesDir, "node_env")
    }
    
    private fun getNativeLibDir(): String {
        return applicationInfo.nativeLibraryDir
    }

    private fun ensureNodeEnvironment() {
        val filesDir = getNodeFilesDir()
        filesDir.mkdirs()
        
        val nativeLibDir = getNativeLibDir()
        Log.i(TAG, "Native library dir: $nativeLibDir")
        Log.i(TAG, "Files dir: ${filesDir.absolutePath}")
        
        // Create lib symlinks directory for versioned .so files
        // Always recreate to avoid stale symlinks after app updates (nativeLibraryDir changes)
        val libSymlinkDir = File(filesDir, "lib")
        if (libSymlinkDir.exists()) {
            libSymlinkDir.deleteRecursively()
        }
        libSymlinkDir.mkdirs()
        
        // Create symlinks for versioned libraries
        // These point to the actual .so files in nativeLibraryDir (which is executable)
        createLibSymlinks(libSymlinkDir, nativeLibDir)
        
        // Verify node binary exists in native lib dir
        val nodeBinary = File(nativeLibDir, "libnode.so")
        if (!nodeBinary.exists()) {
            throw RuntimeException("Node.js binary not found at ${nodeBinary.absolutePath}")
        }
        
        Log.i(TAG, "Node binary found: ${nodeBinary.absolutePath}, exists=${nodeBinary.exists()}")
        
        // Test node binary
        testNodeBinary(nodeBinary.absolutePath, libSymlinkDir.absolutePath, nativeLibDir)
        
        // Extract backend code
        val backendDir = File(filesDir, "backend")
        val versionCode = getVersionCode()
        val versionFile = File(backendDir, ".app_version")
        
        if (!backendDir.exists() || !versionFile.exists() || versionFile.readText().trim() != versionCode.toString()) {
            Log.i(TAG, "Extracting backend (version $versionCode)...")
            if (backendDir.exists()) {
                backendDir.deleteRecursively()
            }
            extractAssetFolder("backend", backendDir.absolutePath)
            versionFile.writeText(versionCode.toString())
            Log.i(TAG, "Backend extracted successfully")
        }
    }
    
    private fun createLibSymlinks(linkDir: File, nativeLibDir: String) {
        // Map of expected soname -> actual file in nativeLibraryDir
        val symlinks = mapOf(
            "libz.so.1" to "libz1.so",
            "libcrypto.so.3" to "libcrypto3.so",
            "libssl.so.3" to "libssl3.so",
            "libicui18n.so.78" to "libicui18n78.so",
            "libicuuc.so.78" to "libicuuc78.so",
            "libicudata.so.78" to "libicudata78.so",
            // Also create unversioned symlinks for safety
            "libcares.so" to "libcares.so",
            "libsqlite3.so" to "libsqlite3.so",
            "libffi.so" to "libffi.so",
            "libc++_shared.so" to "libc++_shared.so"
        )
        
        for ((linkName, targetName) in symlinks) {
            val linkFile = File(linkDir, linkName)
            val targetFile = File(nativeLibDir, targetName)

            if (!targetFile.exists()) {
                Log.w(TAG, "Target library not found: ${targetFile.absolutePath}")
                continue
            }

            try {
                // Create symlink using OS command
                val process = Runtime.getRuntime().exec(
                    arrayOf("ln", "-s", targetFile.absolutePath, linkFile.absolutePath)
                )
                process.waitFor()
                if (linkFile.exists()) {
                    Log.i(TAG, "Created symlink: ${linkFile.name} -> $targetName")
                } else {
                    // Fallback: copy the file
                    Log.w(TAG, "Symlink failed, copying: $targetName")
                    targetFile.copyTo(linkFile, overwrite = true)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Error creating symlink for $linkName: ${e.message}, copying instead")
                targetFile.copyTo(linkFile, overwrite = true)
            }
        }
        
        Log.i(TAG, "Library symlinks created in ${linkDir.absolutePath}")
    }
    
    private fun getVersionCode(): Long {
        return try {
            val packageInfo = packageManager.getPackageInfo(packageName, 0)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                packageInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                packageInfo.versionCode.toLong()
            }
        } catch (e: Exception) {
            1
        }
    }
    
    private fun testNodeBinary(nodePath: String, libDir: String, nativeLibDir: String) {
        try {
            val ldLibPath = "$libDir:$nativeLibDir"
            Log.i(TAG, "Testing Node.js binary: $nodePath")
            Log.i(TAG, "LD_LIBRARY_PATH: $ldLibPath")
            
            val processBuilder = ProcessBuilder(nodePath, "--version")
                .redirectErrorStream(true)
            
            val envMap = processBuilder.environment()
            envMap["LD_LIBRARY_PATH"] = ldLibPath
            envMap["HOME"] = getNodeFilesDir().absolutePath
            
            val process = processBuilder.start()
            val reader = BufferedReader(InputStreamReader(process.inputStream))
            val output = StringBuilder()
            var line: String?
            while (reader.readLine().also { line = it } != null) {
                output.append(line)
            }
            val exitCode = process.waitFor()
            Log.i(TAG, "Node.js test: exit=$exitCode, output=${output.toString().trim()}")
            
            if (exitCode != 0) {
                throw RuntimeException("Node.js binary test failed with exit code $exitCode: ${output.toString().trim()}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Node.js binary test failed: ${e.message}", e)
            startupError = "Node.js 启动失败: ${e.message}"
            throw e
        }
    }

    private fun extractAssetFolder(assetPath: String, destPath: String) {
        val destDir = File(destPath)
        if (!destDir.exists()) destDir.mkdirs()
        
        try {
            val assetManager = assets
            val files = assetManager.list(assetPath) ?: return
            
            for (file in files) {
                val assetFilePath = "$assetPath/$file"
                val destFile = File(destDir, file)
                
                // Check if it's a directory
                val subFiles = assetManager.list(assetFilePath)
                if (subFiles != null && subFiles.isNotEmpty()) {
                    destFile.mkdirs()
                    extractAssetFolder(assetFilePath, destFile.absolutePath)
                } else {
                    copyAssetFile(assetFilePath, destFile.absolutePath)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error extracting $assetPath: ${e.message}", e)
        }
    }

    private fun copyAssetFile(assetPath: String, destPath: String) {
        try {
            assets.open(assetPath).use { input ->
                FileOutputStream(destPath).use { output ->
                    input.copyTo(output)
                }
            }
            File(destPath).setReadable(true, false)
        } catch (e: Exception) {
            Log.e(TAG, "Error copying $assetPath: ${e.message}", e)
        }
    }

    private fun startNode() {
        if (isRunning) {
            Log.i(TAG, "Node.js is already running")
            return
        }
        
        startupError = null
        startForegroundService()
        
        Thread {
            try {
                Log.i(TAG, "Starting Node.js setup...")
                ensureNodeEnvironment()
                
                val nativeLibDir = getNativeLibDir()
                val nodeBinary = File(nativeLibDir, "libnode.so").absolutePath
                val filesDir = getNodeFilesDir()
                val libDir = File(filesDir, "lib").absolutePath
                val backendDir = File(filesDir, "backend").absolutePath
                val dataDir = File(filesDir, "data").apply { mkdirs() }
                
                val ldLibPath = "$libDir:$nativeLibDir"
                
                Log.i(TAG, "Node binary: $nodeBinary")
                Log.i(TAG, "Backend dir: $backendDir")
                Log.i(TAG, "Data dir: ${dataDir.absolutePath}")
                Log.i(TAG, "LD_LIBRARY_PATH: $ldLibPath")
                
                val processBuilder = ProcessBuilder(nodeBinary, "index.js")
                    .directory(File(backendDir))
                    .redirectErrorStream(true)
                
                // Set environment
                val envMap = processBuilder.environment()
                envMap["HOME"] = filesDir.absolutePath
                envMap["LD_LIBRARY_PATH"] = ldLibPath
                envMap["NODE_ENV"] = "production"
                envMap["PORT"] = SERVER_PORT.toString()
                envMap["DB_PATH"] = "${dataDir.absolutePath}/cf-manager.db"
                envMap["API_SECRET"] = ""
                envMap["ENCRYPTION_KEY"] = "cf-manager-android-key"
                envMap["NODE_SKIP_PLATFORM_CHECK"] = "1"
                
                val process = processBuilder.start()
                nodeProcess = process
                isRunning = true
                Log.i(TAG, "Node.js process started")
                
                // Read output
                val reader = BufferedReader(InputStreamReader(process.inputStream))
                var line: String?
                var lineCount = 0
                while (reader.readLine().also { line = it } != null) {
                    lineCount++
                    Log.d("NodeJS", line ?: "")
                    
                    // Check for server startup message
                    if (line?.contains("Server running") == true || 
                        line?.contains("listening") == true ||
                        line?.contains("running on port") == true ||
                        line?.contains("[STARTUP] Server running") == true) {
                        serverReady = true
                        Log.i(TAG, "Node.js server is ready!")
                        updateNotification("后台服务运行中")
                    }
                    
                    // Check for errors
                    val currentLine = line
                    if (currentLine != null && (
                        currentLine.contains("Error:") || 
                        currentLine.contains("error]") ||
                        currentLine.contains("ERROR") ||
                        currentLine.contains("UNCAUGHT") ||
                        currentLine.contains("UNHANDLED_REJECTION") ||
                        (currentLine.contains("[STARTUP]") && currentLine.contains("error", true))
                    )) {
                        Log.e(TAG, "Node.js error detected: $currentLine")
                        if (!serverReady) {
                            startupError = currentLine
                        }
                    }
                }
                
                val exitCode = process.waitFor()
                isRunning = false
                serverReady = false
                nodeProcess = null
                Log.i(TAG, "Node.js process exited with code $exitCode (read $lineCount lines)")
                
                if (exitCode != 0 && startupError == null) {
                    startupError = "进程异常退出 (代码: $exitCode)"
                }
                
                updateNotification("服务已停止")
                
            } catch (e: Exception) {
                Log.e(TAG, "Error starting Node.js: ${e.message}", e)
                startupError = e.message ?: "未知错误"
                isRunning = false
                serverReady = false
                nodeProcess = null
            }
        }.start()
    }
    
    private fun updateNotification(text: String) {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("CF Manager")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setOngoing(isRunning)
            .build()
        
        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.notify(NOTIFICATION_ID, notification)
    }

    private fun stopNode() {
        val process = nodeProcess
        if (process != null) {
            try {
                process.destroy()
                Thread {
                    try {
                        Thread.sleep(3000)
                        if (process.isAlive) {
                            process.destroyForcibly()
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error force-killing Node.js: ${e.message}")
                    }
                }.start()
            } catch (e: Exception) {
                Log.e(TAG, "Error stopping Node.js: ${e.message}")
            }
        }
        isRunning = false
        serverReady = false
        nodeProcess = null
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }

    override fun onDestroy() {
        stopNode()
        instance = null
        super.onDestroy()
    }
}
