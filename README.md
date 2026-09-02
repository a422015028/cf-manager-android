# CF Manager Android 版

基于官方 [cf-manager]([https://github.com/123456789l/cf-manager]) 的 Android 移植版本，前后端均打包在 APK 中，本地运行 Node.js 服务。

## 目录结构

```
cf-manager-android/
├── app/
│   └── src/main/
│       ├── assets/backend/      # 后端代码 + 前端构建产物（运行时解压）
│       ├── jniLibs/arm64-v8a/  # Node.js 原生库（.so 文件，预置）
│       ├── java/com/cfmanager/ # Android 源码（MainActivity, NodeService）
│       ├── res/                 # 资源文件（图标、布局等）
│       └── AndroidManifest.xml
├── patches/                     # Android 适配补丁
│   └── db.js                    # sql.js 兼容层（替换 better-sqlite3）
├── signing/                     # APK 签名配置
│   ├── signing.properties.example  # 签名配置模板
│   └── README.md                # 签名使用说明
├── .github/workflows/           # GitHub Actions 工作流
│   ├── sync-official.yml        # 自动同步官方最新代码
│   └── build-apk.yml            # 自动构建 APK
├── gradle/wrapper/              # Gradle Wrapper（提交到 Git）
├── gradlew                      # Gradle 启动脚本
├── build.sh                     # 自动化构建脚本
├── build.gradle                 # 项目级 Gradle 配置
├── settings.gradle              # Gradle 设置
└── gradle.properties            # Gradle 属性
```

## 前置要求

- **Node.js** >= 18（含 npm）

- **Git**（从 GitHub 拉取源码时需要）

- **Android Studio**（推荐）或 Android SDK + Gradle

> **注意**：Node.js 原生库（`.so` 文件）已预置在 `app/src/main/jniLibs/arm64-v8a/` 目录中，无需重新下载。

## 快速开始

### 方式一：使用 Android Studio 构建（推荐）

> **首次构建前必须先准备后端代码**（见下方步骤 0）

**步骤 0：准备后端代码（首次或更新时需要）**

```bash
chmod +x build.sh
./build.sh --assets-only
```

这会自动安装依赖、适配 Android、生成 `app/src/main/assets/backend/node_modules/`。

**步骤 1-4：构建 APK**

1. 用 Android Studio 打开本项目
2. 等待 Gradle 同步完成
3. 点击 **Build → Build Bundle(s) / APK(s) → Build APK(s)**
4. 生成的 APK 在 `app/build/outputs/apk/debug/` 目录

### 方式二：使用命令行构建脚本

```bash
# 赋予执行权限
chmod +x build.sh

# 从 GitHub 拉取最新代码并构建 APK
./build.sh

# 使用本地源码构建
./build.sh --source /path/to/cf-manager

# 只更新后端代码到 assets，不构建 APK
./build.sh --assets-only

# 仅构建 APK（assets 已准备好时）
./build.sh --build-apk
```

> **Windows 用户**：使用 Git Bash 或 WSL 运行 `build.sh`。

> **注意**：`node_modules` 不提交到 Git，每次克隆或更新后需要先运行 `./build.sh --assets-only` 生成依赖。

## 官方更新后如何适配

当 cf-manager 官方发布新版本时，有两种更新方式：

### 方式一：GitHub Actions 自动同步（推荐）

将项目推送到 GitHub 后，可使用内置的 Workflow 一键同步：

1. 进入仓库 **Actions** 页面
2. 左侧选择 **Sync with Official**
3. 点击 **Run workflow**
4. 填写参数（默认即可）后点击运行

Workflow 会自动完成：
- 拉取官方最新源码
- 构建前端
- 后端 Android 适配（sql.js 替换 better-sqlite3）
- 更新 `app/src/main/assets/backend/`
- 创建 Pull Request（或直接提交）

> Workflow 文件位于 `.github/workflows/sync-official.yml`

### 自动构建 APK

每次推送代码或 PR 时，GitHub Actions 会自动构建 APK：

- **触发方式**：push 到 main/master、PR、手动触发
- **产物位置**：Action 页面的 Artifacts 中下载
- **Workflow 文件**：`.github/workflows/build-apk.yml`

手动触发步骤：
1. 进入仓库 **Actions → Build APK**
2. 点击 **Run workflow**
3. 选择构建类型（debug/release）
4. 运行完成后在 Artifacts 下载 APK

### 方式二：本地脚本更新

```bash
# 从 GitHub 拉取最新代码，自动适配并更新到 assets 目录
./build.sh --assets-only
```

脚本会自动完成：

1. 拉取最新源码（或使用本地源码）
2. 构建前端
3. 移除 `better-sqlite3` 原生依赖，添加 `sql.js`
4. 替换 `db.js` 为 sql.js 兼容层
5. 修正前端静态文件路径
6. 将所有文件复制到 `app/src/main/assets/backend/`

### 步骤 2：构建 APK

```bash
# 方式一：Android Studio 中点击 Build
# 方式二：命令行构建
./build.sh --build-apk
```

### 构建脚本参数说明

| 参数                | 说明                                    |
| ----------------- | ------------------------------------- |
| `--source <路径>`   | 指定本地 cf-manager 源码路径（不指定则从 GitHub 克隆） |
| `--repo <url>`    | 指定 Git 仓库地址（默认官方仓库）                   |
| `--branch <name>` | 指定分支（默认: main）                        |
| `--assets-only`   | 只更新 assets/backend 代码，不构建 APK         |
| `--build-apk`     | 仅构建 APK（假设 assets 已准备好）               |
| `--clean`         | 构建前清理 Gradle 缓存                       |
| `-h, --help`      | 显示帮助                                  |

## Android 适配说明

### 数据库层替换

官方使用 `better-sqlite3`（原生模块），Android 不兼容。改用 `sql.js`（纯 JS + WASM），并提供兼容层：

- **文件**: `patches/db.js`

- **功能**: 封装 sql.js API，使其兼容 better-sqlite3 的常用方法

- **自动保存**: 数据库修改后 2 秒自动保存到磁盘

### Node.js 运行环境

- Node.js 二进制以 `libnode.so` 形式放在 jniLibs 中，Android 会将其解压到 nativeLibraryDir（可执行）

- 其他依赖库（libcrypto, libssl, libicu 等）同样以 .so 文件形式提供

- 应用启动时创建符号链接，处理版本化库名

### 前端路径调整

官方项目中后端从 `../public` 加载前端，Android 中改为从 `./public` 加载（前后端打包在一起）。

## 常见问题

### Q: 构建时报错 "SDK location not found"

A: 设置 `ANDROID_HOME` 环境变量，或在 `local.properties` 中添加：

```properties
sdk.dir=/path/to/your/Android/Sdk
```

### Q: 构建时报错 "gradlew: command not found"

A: 项目没有 gradle wrapper，请用 Android Studio 打开项目自动生成，或执行：

```bash
gradle wrapper --gradle-version 8.5
```

### Q: 启动后一直显示"正在启动服务"

A: 查看 Logcat 日志，过滤 `NodeService` 和 `NodeJS` 标签，通常是：

- 后端代码有语法错误

- 缺少 node\_modules 依赖

- 数据库初始化失败

### Q: 如何更换 App 图标

替换以下目录中的图标文件：

- `app/src/main/res/mipmap-*/ic_launcher.png`

- `app/src/main/res/mipmap-*/ic_launcher_round.png`

- `app/src/main/res/drawable-*/ic_launcher_foreground.png`

各密度对应尺寸（单位: px）：

| 密度      | 尺寸      |
| ------- | ------- |
| mdpi    | 48x48   |
| hdpi    | 72x72   |
| xhdpi   | 96x96   |
| xxhdpi  | 144x144 |
| xxxhdpi | 192x192 |

## 版本信息

- 版本号: 2.0.4

- 最低 Android 版本: 7.0 (API 24)

- 目标 Android 版本: 14 (API 34)

- 架构: arm64-v8a

