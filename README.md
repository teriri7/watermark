# 相机水印（Camera Watermark）

为照片自动添加专业的相机水印，识别 EXIF 信息（机型、光圈、快门、ISO、焦距、时间、镜头），支持 Canon / Sony / Nikon。

提供 3 种水印样式：
1. 底部白边
2. 四边白框（三边为底部 50%）
3. 模糊背景 + 圆角主图 + 阴影

整个应用现已重构为**纯前端 + Capacitor**，所有图片处理在本机 Canvas 完成，不依赖后端，离线可用。

---

## 项目结构

```
canon-watermark/
├── www/                       # Web 资源（Capacitor 打包目录）
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js             # UI 主逻辑
│   │   ├── watermark.js       # 水印渲染（Canvas）
│   │   └── exif-reader.js     # EXIF 读取
│   ├── logo/                  # 品牌 logo
│   └── vendor/                # exifr 库（CI 自动下载）
├── capacitor.config.ts        # Capacitor 配置
├── package.json
├── .github/workflows/build.yml # GitHub Actions 自动打 APK
├── server.py                  # （旧 Flask 后端，已不再使用）
└── README.md
```

> 老的 `server.py`、`templates/`、`static/` 保留作历史参考，APK 不会用到它们。可以删除，也可以留着方便对照。

---

## 一、用 GitHub Actions 自动打 APK（推荐）

### 1. 推到 GitHub

```bash
git init
git add .
git commit -m "feat: 重构为前端应用，支持打包 APK"
git branch -M main
git remote add origin https://github.com/<你的用户名>/canon-watermark.git
git push -u origin main
```

### 2. 触发构建

push 到 `main` 分支会自动触发 `.github/workflows/build.yml`，也可以在 GitHub 仓库 → Actions 页面手动 Run workflow。

### 3. 下载 APK

构建成功后：
- 进入 Actions → 选择刚刚的运行 → 在底部 **Artifacts** 区域下载 `camera-watermark-apk.zip`
- 解压后里面就是 **相机水印.apk**

### 4.（可选）打 tag 自动发 Release

```bash
git tag v1.0.0
git push origin v1.0.0
```

会自动创建 GitHub Release 并附带 `相机水印.apk`，分享给别人直接给 Release 链接即可。

---

## 二、本地构建（可选）

如果你想在本机调试：

```bash
# 1. 安装依赖
npm install

# 2. 下载 exifr 到 vendor
mkdir -p www/vendor
curl -L -o www/vendor/exifr.min.js https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.umd.min.js

# 3. 添加 Android 平台
npx cap add android

# 4. 同步资源
npx cap sync android

# 5. 在 Android Studio 中打开
npx cap open android
```

要求：Node.js 20+、JDK 17、Android Studio。

---

## 三、本地预览（不打 APK）

直接用任意静态文件服务器跑 `www/` 即可，例如：

```bash
# 先下载 exifr
mkdir -p www/vendor
curl -L -o www/vendor/exifr.min.js https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.umd.min.js

# 启动一个静态服务器
cd www
npx serve .
```

打开浏览器访问提示的地址即可看到效果。

---

## 四、APK 安装与使用

1. 把 `相机水印.apk` 传到手机
2. 点击安装（首次安装可能要在系统设置里允许"安装未知来源"）
3. 打开"相机水印"
4. 选择样式 → 选择图片 → 输入昵称 → 导出
5. 导出的图片会保存到手机的 `Pictures/CameraWatermark/` 目录

> 因为是 **debug 签名** 的 APK，体积约 5 MB，可以直接装。如果想发 Google Play 或者长期使用，建议生成正式签名（见下文）。

---

## 五、配置正式签名（可选）

debug APK 安装在自己手机上没问题，分发给别人最好用 release 签名。

1. 生成 keystore：
   ```bash
   keytool -genkey -v -keystore camera-watermark.jks \
     -keyalg RSA -keysize 2048 -validity 10000 \
     -alias camera-watermark
   ```

2. 在 GitHub 仓库 → Settings → Secrets and variables → Actions 加：
   - `KEYSTORE_BASE64`：`base64 -w 0 camera-watermark.jks` 的输出
   - `KEYSTORE_PASSWORD`
   - `KEY_ALIAS`
   - `KEY_PASSWORD`

3. 修改 `.github/workflows/build.yml` 把 `assembleDebug` 改成 `assembleRelease`，并加签名步骤（按需）。

---

## 六、常见问题

**Q: GitHub Actions 第一次构建失败？**  
最常见的是 `npx cap add android` 阶段失败，重新运行一次通常就好。也可以在本地先 `npx cap add android`，把生成的 `android/` 目录提交到仓库，然后从 `.gitignore` 里去掉 `android/`。

**Q: 安装 APK 后打开是白屏？**  
打开手机的 Chrome 远程调试（chrome://inspect），看是不是 `exifr.min.js` 没下载下来。检查 `.github/workflows/build.yml` 里的下载步骤。

**Q: 输出图片质量差？**  
`www/js/app.js` 里 `canvasToBlob(canvas, mime, 0.95)` 把质量调到 1.0。

**Q: Canvas 渲染和原 Flask 版本对比有色差？**  
是的，浏览器 Canvas 默认不保留原图的 ICC profile，导出 JPG 时颜色可能略偏。如果在意，可以改用 `image/png` 输出。

---

## 七、开发说明

主要源文件：
- `www/js/watermark.js` — 三种样式的 Canvas 渲染逻辑（约 380 行，移植自 `server.py`）
- `www/js/exif-reader.js` — 用 [exifr](https://github.com/MikeKovarik/exifr) 读取 EXIF
- `www/js/app.js` — UI 交互、文件下载、Capacitor 文件保存

调整水印参数：直接改 `www/js/watermark.js` 顶部的 `portraitConfig`、`landscapeConfig`、`style3Config` 三个对象，结构和原 `server.py` 完全一致。

---

## 许可

MIT License
