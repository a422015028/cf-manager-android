#!/bin/bash
# ============================================================
# cf-manager Android 构建脚本
# 功能：从官方源码拉取最新代码 → 适配 Android → 构建 APK
#
# 前置要求：
#   - Node.js + npm
#   - Git
#   - Android SDK + Gradle（或使用 Android Studio 构建）
#
# 注意：Node.js 原生库（.so 文件）已预置在 app/src/main/jniLibs/arm64-v8a/
#       无需重新下载，构建脚本只负责更新前后端代码
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
ASSETS_BACKEND="$PROJECT_DIR/app/src/main/assets/backend"
PATCHES_DIR="$PROJECT_DIR/patches"
TMP_DIR="$PROJECT_DIR/tmp_build"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()  { echo -e "${CYAN}[STEP]${NC} $1"; }

usage() {
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  --source <路径>    指定本地 cf-manager 源码路径（不指定则从 GitHub 克隆）"
    echo "  --repo <url>       指定 Git 仓库地址（默认: https://github.com/123456789l/cf-manager.git）"
    echo "  --branch <name>    指定分支（默认: main）"
    echo "  --assets-only      只更新 assets/backend 代码，不构建 APK"
    echo "  --no-build         同 --assets-only（兼容旧版）"
    echo "  --build-apk        仅构建 APK（假设 assets 已准备好）"
    echo "  --clean            构建前清理 Gradle 缓存"
    echo "  -h, --help         显示帮助"
    echo ""
    echo "示例:"
    echo "  $0                                        # 从 GitHub 拉取最新代码并构建 APK"
    echo "  $0 --source ~/cf-manager                 # 使用本地源码构建"
    echo "  $0 --assets-only                         # 只更新后端代码到 assets，不构建 APK"
    echo "  $0 --build-apk                           # 直接构建 APK（assets 已准备好）"
    echo "  $0 --clean                               # 清理后重新构建"
}

# 默认参数
SOURCE_DIR=""
REPO_URL="https://github.com/123456789l/cf-manager.git"
BRANCH="main"
UPDATE_ASSETS=true
BUILD_APK=true
CLEAN=false

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --source)
            SOURCE_DIR="$2"
            shift 2
            ;;
        --repo)
            REPO_URL="$2"
            shift 2
            ;;
        --branch)
            BRANCH="$2"
            shift 2
            ;;
        --assets-only|--no-build)
            BUILD_APK=false
            shift
            ;;
        --build-apk)
            UPDATE_ASSETS=false
            shift
            ;;
        --clean)
            CLEAN=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            log_error "未知参数: $1"
            usage
            exit 1
            ;;
    esac
done

# ============================================================
# 环境检查
# ============================================================
check_environment() {
    log_info "检查构建环境..."
    
    local missing=0
    
    # 检查 Node.js
    if command -v node &> /dev/null; then
        log_info "  Node.js: $(node --version)"
    else
        log_error "  未找到 Node.js，请先安装: https://nodejs.org/"
        missing=1
    fi
    
    # 检查 npm
    if command -v npm &> /dev/null; then
        log_info "  npm: $(npm --version)"
    else
        log_error "  未找到 npm"
        missing=1
    fi
    
    # 检查 Git（只有需要克隆时才检查）
    if [ "$UPDATE_ASSETS" = true ] && [ -z "$SOURCE_DIR" ]; then
        if command -v git &> /dev/null; then
            log_info "  Git: $(git --version)"
        else
            log_error "  未找到 Git，请先安装或使用 --source 指定本地源码"
            missing=1
        fi
    fi
    
    # 检查 jniLibs 原生库
    JNI_LIBS_DIR="$PROJECT_DIR/app/src/main/jniLibs/arm64-v8a"
    if [ -d "$JNI_LIBS_DIR" ] && [ -f "$JNI_LIBS_DIR/libnode.so" ]; then
        log_info "  原生库: 已就绪 ($JNI_LIBS_DIR)"
    else
        log_error "  未找到 Node.js 原生库！请将 .so 文件放到 $JNI_LIBS_DIR"
        missing=1
    fi
    
    # 检查 patches 目录
    if [ ! -f "$PATCHES_DIR/db.js" ]; then
        log_error "  未找到 patches/db.js 补丁文件"
        missing=1
    fi
    
    if [ $missing -ne 0 ]; then
        log_error "环境检查失败，请修复上述问题后重试"
        exit 1
    fi
    
    log_info "环境检查通过"
}

# ============================================================
# 步骤 1: 获取源码
# ============================================================
get_source() {
    log_step "1/4 获取源码"
    
    if [ -n "$SOURCE_DIR" ]; then
        if [ ! -d "$SOURCE_DIR" ]; then
            log_error "源码目录不存在: $SOURCE_DIR"
            exit 1
        fi
        log_info "使用本地源码: $SOURCE_DIR"
        rm -rf "$TMP_DIR"
        mkdir -p "$TMP_DIR"
        cp -r "$SOURCE_DIR/backend" "$TMP_DIR/"
        cp -r "$SOURCE_DIR/frontend" "$TMP_DIR/"
    else
        log_info "从 $REPO_URL (分支: $BRANCH) 克隆..."
        rm -rf "$TMP_DIR"
        git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$TMP_DIR"
    fi
    
    if [ ! -d "$TMP_DIR/backend" ] || [ ! -d "$TMP_DIR/frontend" ]; then
        log_error "源码结构不正确，缺少 backend 或 frontend 目录"
        exit 1
    fi
    
    log_info "源码获取完成"
}

# ============================================================
# 步骤 2: 构建前端
# ============================================================
build_frontend() {
    log_step "2/4 构建前端"
    
    cd "$TMP_DIR/frontend"
    
    log_info "安装前端依赖..."
    npm install
    
    log_info "执行前端构建..."
    npm run build
    
    if [ ! -d "dist" ]; then
        log_error "前端构建失败，dist 目录不存在"
        exit 1
    fi
    
    log_info "前端构建完成"
}

# ============================================================
# 步骤 3: 准备后端 + Android 适配
# ============================================================
prepare_backend() {
    log_step "3/4 准备后端并适配 Android"
    
    cd "$TMP_DIR/backend"
    
    # 移除 better-sqlite3（Android 不兼容原生模块，改用 sql.js）
    log_info "移除 better-sqlite3 依赖（替换为 sql.js）..."
    if [ -f "package.json" ]; then
        # 使用 node 脚本安全地修改 package.json
        node -e "
            const fs = require('fs');
            const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
            if (pkg.dependencies) {
                delete pkg.dependencies['better-sqlite3'];
            }
            if (pkg.devDependencies) {
                delete pkg.devDependencies['@types/better-sqlite3'];
            }
            // 确保 sql.js 在依赖中
            if (!pkg.dependencies) pkg.dependencies = {};
            pkg.dependencies['sql.js'] = '^1.14.2';
            fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
            console.log('Updated package.json');
        "
    fi
    
    # 安装后端依赖
    log_info "安装后端依赖..."
    npm install --omit=dev
    
    # 确认 sql.js 已安装
    if [ ! -d "node_modules/sql.js" ]; then
        log_error "sql.js 安装失败"
        exit 1
    fi
    log_info "sql.js 已安装"
    
    # 替换 db.js 为 Android 适配版本（sql.js 兼容层）
    log_info "替换数据库层为 sql.js 兼容版..."
    cp "$PATCHES_DIR/db.js" "$TMP_DIR/backend/db.js"
    
    # 修改 index.js 中的前端静态文件路径（从 ../public 改为 ./public）
    log_info "修正前端静态文件路径..."
    sed -i "s|path.join(__dirname, '..', 'public')|path.join(__dirname, 'public')|g" "$TMP_DIR/backend/index.js"
    
    # 也修正 SPA fallback 中的路径
    sed -i "s|path.join(path.join(__dirname, 'public'), 'index.html')|path.join(__dirname, 'public', 'index.html')|g" "$TMP_DIR/backend/index.js"
    
    # 将前端构建产物复制到后端 public 目录
    log_info "复制前端构建产物到后端 public 目录..."
    rm -rf "$TMP_DIR/backend/public"
    cp -r "$TMP_DIR/frontend/dist" "$TMP_DIR/backend/public"
    
    log_info "后端准备完成"
}

# ============================================================
# 步骤 4: 更新 assets/backend
# ============================================================
update_assets() {
    log_step "4/4 更新 Android assets 目录"
    
    # 清理旧的后端代码
    rm -rf "$ASSETS_BACKEND"
    mkdir -p "$ASSETS_BACKEND"
    
    # 复制后端代码
    cd "$TMP_DIR/backend"
    
    # 需要复制的文件/目录
    ITEMS_TO_COPY=(
        "index.js"
        "db.js"
        "config.js"
        "utils.js"
        "constants.js"
        "version.js"
        "package.json"
        "routes/"
        "services/"
        "middleware/"
        "models/"
        "data/"
        "public/"
        "node_modules/"
    )
    
    local count=0
    for item in "${ITEMS_TO_COPY[@]}"; do
        if [ -e "$item" ]; then
            cp -r "$item" "$ASSETS_BACKEND/"
            count=$((count + 1))
            log_info "  已复制: $item"
        fi
    done
    
    # 统计 assets 大小
    local size=$(du -sh "$ASSETS_BACKEND" | cut -f1)
    log_info "Assets 更新完成（共 $count 项，总大小: $size）"
}

# ============================================================
# 构建 APK
# ============================================================
build_apk() {
    if [ "$BUILD_APK" = false ]; then
        log_info "跳过 APK 构建"
        return
    fi
    
    log_step "构建 APK"
    
    cd "$PROJECT_DIR"
    
    # 检查是否有 gradlew
    if [ ! -f "./gradlew" ]; then
        log_warn "未找到 gradlew 脚本"
        log_info "请使用 Android Studio 打开项目构建，或先执行以下命令生成 gradle wrapper:"
        echo ""
        echo "  gradle wrapper --gradle-version 8.5"
        echo ""
        log_info "跳过 APK 构建步骤"
        return 1
    fi
    
    if [ "$CLEAN" = true ]; then
        log_info "清理构建缓存..."
        ./gradlew clean
    fi
    
    # 检查环境变量
    if [ -z "$ANDROID_HOME" ] && [ -z "$ANDROID_SDK_ROOT" ]; then
        # 尝试常见路径
        if [ -d "$HOME/Android/Sdk" ]; then
            export ANDROID_HOME="$HOME/Android/Sdk"
        elif [ -d "$HOME/Library/Android/sdk" ]; then
            export ANDROID_HOME="$HOME/Library/Android/sdk"
        elif [ -d "/opt/android-sdk" ]; then
            export ANDROID_HOME="/opt/android-sdk"
        else
            log_warn "未设置 ANDROID_HOME，构建可能失败"
        fi
    fi
    
    log_info "执行 Gradle 构建 (assembleDebug)..."
    ./gradlew assembleDebug --no-daemon
    
    APK_PATH="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"
    
    if [ -f "$APK_PATH" ]; then
        # 复制到项目根目录，方便查找
        OUTPUT_APK="$PROJECT_DIR/cf-manager-android-debug.apk"
        cp "$APK_PATH" "$OUTPUT_APK"
        
        APK_SIZE=$(du -h "$OUTPUT_APK" | cut -f1)
        log_info "APK 构建成功!"
        log_info "输出文件: $OUTPUT_APK"
        log_info "文件大小: $APK_SIZE"
    else
        log_error "APK 构建失败，未找到输出文件"
        exit 1
    fi
}

# ============================================================
# 清理临时文件
# ============================================================
cleanup() {
    if [ -d "$TMP_DIR" ]; then
        log_info "清理临时文件..."
        rm -rf "$TMP_DIR"
    fi
}

# ============================================================
# 主流程
# ============================================================
main() {
    echo ""
    log_info "========================================"
    log_info " cf-manager Android 构建脚本"
    log_info "========================================"
    echo ""
    
    check_environment
    
    if [ "$UPDATE_ASSETS" = true ]; then
        get_source
        build_frontend
        prepare_backend
        update_assets
    fi
    
    build_apk
    cleanup
    
    echo ""
    log_info "========================================"
    log_info " 构建完成!"
    log_info "========================================"
    echo ""
    
    if [ "$BUILD_APK" = false ]; then
        log_info "Assets 已更新，可在 Android Studio 中构建 APK"
        log_info "或运行: $0 --build-apk"
    fi
}

# 捕获异常并清理
trap 'log_error "构建失败，正在清理..."; cleanup; exit 1' ERR

main
