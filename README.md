# CF Manager Android 构建项目

一键构建 CF Manager Android 版的 GitHub Actions 项目，内置签名，开箱即用。

## ✨ 特性

- ✅ **零配置**：内置签名文件，无需手动配置
- ✅ **一键构建**：GitHub Actions 手动触发即可生成 APK
- ✅ **自动拉取源码**：从 `hefy2027/cf-manager` 拉取最新代码
- ✅ **前后端一体**：APK 内置前端 + Node.js 后端
- ✅ **自动签名**：Release 构建自动使用内置签名
- ✅ **可选发布**：支持自动发布到 GitHub Release

## 📁 项目结构

```
cf-manager-android-build/
├── .github/
│   └── workflows/
│       └── build-android.yml    ← GitHub Actions 工作流
├── app/
│   ├── build.gradle             ← App 构建配置（含签名）
│   └── src/
│       └── main/
│           ├── AndroidManifest.xml
│           ├── java/com/cfmanager/app/
│           │   ├── MainActivity.kt    ← 主界面（WebView）
│           │   └── NodeService.kt     ← Node.js 前台服务
│           ├── res/                   ← 资源文件
│           ├── assets/                ← 后端代码（构建时填充）
│           └── jniLibs/               ← 原生库（构建时填充）
├── signing/
│   ├── release.keystore         ← 签名密钥库（已内置）
│   └── signing.properties       ← 签名配置
├── gradle/
│   └── wrapper/
│       ├── gradle-wrapper.jar
│       └── gradle-wrapper.properties
├── build.gradle                 ← 项目级 Gradle 配置
├── settings.gradle
├── gradle.properties
├── gradlew                      ← Gradle Wrapper
├── gradlew.bat
├── .gitignore
└── README.md
```

## 🚀 使用方法

### 第一步：上传到 GitHub

将本项目整个目录推送到你的 GitHub 仓库：

```bash
cd cf-manager-android-build
git init
git add .
git commit -m "Initial commit: CF Manager Android build project"
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
```

### 第二步：触发构建

1. 打开 GitHub 仓库页面
2. 点击顶部的 **Actions** 标签
3. 在左侧菜单选择 **Build Android APK**
4. 点击 **Run workflow** 按钮
5. 填写参数（可选，直接用默认值也可以）：
   - **cf_manager_ref**: cf-manager 源码的分支/tag（默认 master）
   - **build_type**: 构建类型（默认 release，已签名）
   - **version_name**: 版本号（默认自动从源码读取）
   - **version_code**: 整数版本号（默认自动生成）
   - **create_release**: 是否创建 GitHub Release（默认关闭）
6. 点击 **Run workflow** 开始构建

### 第三步：下载 APK

构建完成后（约 5-10 分钟）：

1. 点击进入该次构建记录
2. 在页面底部 **Artifacts** 区域找到 APK 文件
3. 点击下载

如果勾选了 `create_release`，还会自动发布到 Releases 页面。

## ⚙️ 构建参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `cf_manager_ref` | string | `master` | cf-manager 源码的分支、tag 或 commit |
| `build_type` | choice | `release` | `release`（已签名）或 `debug` |
| `version_name` | string | 自动读取 | 显示版本号，如 `2.0.4` |
| `version_code` | string | 自动生成 | 整数版本号，用于应用升级 |
| `create_release` | boolean | `false` | 是否创建 GitHub Release |

## 🔐 签名信息

> ⚠️ **注意**：签名文件已内置在项目中，如果仓库是公开的，建议更换为自己的签名文件！

当前内置签名信息：

| 项 | 值 |
|----|----|
| 密钥库文件 | `signing/release.keystore` |
| 密钥库密码 | `cfmanager2024` |
| 密钥别名 | `cfmanager` |
| 密钥密码 | `cfmanager2024` |
| 有效期 | 10000 天 |

### 更换自己的签名

生成新的签名文件：

```bash
keytool -genkeypair -v \
  -keystore signing/release.keystore \
  -alias 你的别名 \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=你的名称, OU=部门, O=组织, L=城市, ST=省份, C=CN"
```

然后修改 `signing/signing.properties` 中的密码和别名。

## 📱 应用信息

| 项 | 值 |
|----|----|
| 包名 | `com.cfmanager.app` |
| 最低 Android 版本 | 7.0 (API 24) |
| 目标 SDK | 34 |
| 支持架构 | arm64-v8a |
| 服务端口 | 38765 |

## 🏗️ 构建流程

工作流执行以下步骤：

1. **检出代码** - 当前 Android 项目 + cf-manager 源码
2. **构建前端** - npm ci + npm run build
3. **构建后端** - npm ci + npm run build
4. **Android 适配** - 用 sql.js 替换 better-sqlite3
5. **下载原生库** - Termux Node.js + 依赖库
6. **组装资源** - 后端 → assets，原生库 → jniLibs
7. **构建 APK** - Gradle assembleRelease（自动签名）
8. **验证签名** - apksigner verify
9. **上传产物** - Artifacts 保存 90 天
10. **发布 Release**（可选）- 发布到 GitHub Releases

## 🔧 本地构建（可选）

如果你想在本地构建：

```bash
# 需要安装 JDK 17 和 Android SDK
export ANDROID_HOME=/path/to/android-sdk

./gradlew assembleRelease
# APK 输出路径: app/build/outputs/apk/release/app-release.apk
```

## ❓ 常见问题

### Q: 构建失败怎么办？

A: 查看 Actions 构建日志中的错误信息，常见原因：
- 网络问题导致 Termux 包下载失败 → 重新运行
- cf-manager 源码结构变化导致路径错误 → 检查并更新工作流

### Q: 可以支持 32 位手机吗？

A: 目前只支持 arm64-v8a（64位）。大部分新手机都是 64 位的。

### Q: 安装时提示解析包错误？

A: 可能的原因：
- Android 版本低于 7.0
- APK 下载不完整（重新下载）
- 设备是 32 位的（不支持）

### Q: 首次启动很慢？

A: 首次启动需要解压 Node.js 运行环境和后端代码，约 10-30 秒，属正常现象。

## 📄 许可证

与 CF Manager 主项目保持一致。
