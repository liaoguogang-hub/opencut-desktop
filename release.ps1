# opencut-desktop 一键发版脚本
#
# 用法:
#   .\release.ps1                                # 读 package.json version, build 自增
#   .\release.ps1 -NewVersion "0.1.1" -Build 2 -Message "修了 X"
#   .\release.ps1 -SkipBuild                     # 只做 commit + tag + release(EXE 已打)
#
# 自动完成:
#   1. next build  (production)
#   2. electron-builder --win --x64 (NSIS)
#   3. (可选)提示装 EXE 真机端到端验证
#   4. git commit + push
#   5. git tag + push tag (tag = v{Ver}+{Build})
#   6. gh release create + 挂 .exe + .exe.blockmap
#
# 前置:
#   - gh CLI 装好且 gh auth status 显示已登录 github.com
#   - Git 配置 user.name/user.email (脚本里兜底设成 liaoguogang-hub)
#   - Node.js 24+ 装好 (不能用 bun 跑 build,D 盘 sandbox 拒)
#   - monorepo 根 node_modules 装好 (apps/web 不需要自己的 node_modules)
#
# 注意:
#   - bun 跑 `next build` 在 D 盘 sandbox 报 `Operation not permitted`,
#     必须用 node 直跑根 .bin
#   - electron-builder 第一次会从 GitHub release 下 Electron binary(~115 MB,
#     实测 7m+),后续走本地 cache
#   - 产出约 1.8 GB,推 gh release 时长取决于网络
#   - 没买代码签名证书,SmartScreen 首次运行会警告(用户需"仍要运行")

[CmdletBinding()]
param(
  [string]$NewVersion = "",
  [int]$Build = 0,
  [string]$Message = "release build",
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# ===== 0. 前置检查 =====
Write-Host "=== opencut-desktop 一键发版 ===" -ForegroundColor Cyan
Write-Host ""

# 读 package.json version 默认值
$pkgPath = "apps/web/package.json"
if (-not (Test-Path $pkgPath)) {
  throw "找不到 $pkgPath,确认在 repo 根运行"
}
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
if ([string]::IsNullOrEmpty($NewVersion)) {
  $NewVersion = $pkg.version
}
if ($Build -eq 0) {
  # 自增 build number: 解析现有 tag "v0.1.0+3" 取 +n
  $lastTag = (git tag --list "v*" | Sort-Object | Select-Object -Last 1)
  if ($lastTag -and $lastTag -match '\+(\d+)$') {
    $Build = [int]$Matches[1] + 1
  } else {
    $Build = 1
  }
}
$Tag = "v${NewVersion}+${Build}"

Write-Host "版本: $NewVersion"
Write-Host "Build: $Build"
Write-Host "Tag: $Tag"
Write-Host "说明: $Message"
Write-Host "SkipBuild: $SkipBuild"
Write-Host ""

Write-Host "[0/7] 前置检查..." -ForegroundColor Cyan
if (-not (Test-Path .git)) {
  throw "当前目录不是 git 仓库"
}
$remote = git remote get-url origin 2>$null
if (-not $remote) {
  throw "没有配置 git remote origin"
}
Write-Host "  remote: $remote"

$ghStatus = gh auth status 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
  throw "gh CLI 未登录,先跑 gh auth login --with-token <PAT>"
}
Write-Host "  gh CLI: 已登录"

$gitUser = git config user.name
if (-not $gitUser) {
  git config user.name "liaoguogang-hub"
  git config user.email "liaoguogang-hub@users.noreply.github.com"
  Write-Host "  git: 已自动设置 user.name=liaoguogang-hub"
}

# ===== 1. pre-build 检查 =====
Write-Host ""
Write-Host "[1/7] pre-build 检查..." -ForegroundColor Cyan
$dirty = git status --porcelain | Where-Object {
  # 忽略 release/ 子目录(后面自己产生)
  $_ -notmatch '^.. apps/web/release/'
}
if ($dirty) {
  Write-Host "  工作区 dirty,先 commit 或 stash:" -ForegroundColor Yellow
  $dirty | ForEach-Object { Write-Host "    $_" }
  Write-Host "  或者用 -SkipBuild 跳过 build 阶段" -ForegroundColor Yellow
  throw "工作区不干净"
}

# 同步 package.json version
if ($pkg.version -ne $NewVersion) {
  Write-Host "  package.json version ($($pkg.version)) → $NewVersion"
  $pkg.version = $NewVersion
  $pkg | ConvertTo-Json -Depth 10 | Set-Content $pkgPath
}

# pin electron 必须是 fixed version(不是 caret)
$electronDep = $pkg.devDependencies.electron
if ($electronDep -match '^\^') {
  throw "electron 必须是 fixed version (electron-builder 不接受 caret), 当前: $electronDep"
}
Write-Host "  electron: $electronDep (fixed, ok)"

# ===== 2. next build =====
if (-not $SkipBuild) {
  Write-Host ""
  Write-Host "[2/7] next build (production)..." -ForegroundColor Cyan
  # 关键:用 node 直跑根的 next bin,不走 bun (D 盘 sandbox 拒)
  $nextBin = Join-Path (Get-Location).Path "node_modules/next/dist/bin/next"
  if (-not (Test-Path $nextBin)) {
    throw "找不到根 next bin: $nextBin,先在根跑 npm install 或 bun install --linker=hoisted"
  }
  Set-Location apps/web
  node $nextBin build
  if ($LASTEXITCODE -ne 0) {
    Set-Location $PSScriptRoot
    throw "next build 失败,看上面 ts 错"
  }
  Set-Location $PSScriptRoot

  # ===== 3. electron-builder 打 NSIS EXE =====
  Write-Host ""
  Write-Host "[3/7] electron-builder --win --x64 (NSIS)..." -ForegroundColor Cyan
  $ebBin = Join-Path (Get-Location).Path "node_modules/electron-builder/out/cli/cli.js"
  if (-not (Test-Path $ebBin)) {
    throw "找不到根 electron-builder bin: $ebBin"
  }
  Set-Location apps/web
  node $ebBin --win --x64
  if ($LASTEXITCODE -ne 0) {
    Set-Location $PSScriptRoot
    throw "electron-builder 失败"
  }
  Set-Location $PSScriptRoot
} else {
  Write-Host ""
  Write-Host "[2-3/7] 跳过 build (-SkipBuild)" -ForegroundColor Yellow
}

# ===== 验证 EXE 产出 =====
$exe = "apps/web/release/OpenCut Desktop-Setup-${NewVersion}.exe"
$blockmap = "apps/web/release/OpenCut Desktop-Setup-${NewVersion}.exe.blockmap"
if (-not (Test-Path $exe)) {
  Write-Host "  release/ 目录现有 .exe:" -ForegroundColor Yellow
  Get-ChildItem "apps/web/release/*.exe" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "    $($_.Name) ($([math]::Round($_.Length / 1MB, 2)) MB)"
  }
  throw "找不到目标 EXE: $exe,可以传 -SkipBuild 跳过 build 阶段"
}
$sizeMB = [math]::Round((Get-Item $exe).Length / 1MB, 2)
Write-Host ""
Write-Host "  ✓ EXE: $exe (${sizeMB} MB)" -ForegroundColor Green
if (Test-Path $blockmap) {
  $bmSizeKB = [math]::Round((Get-Item $blockmap).Length / 1KB, 0)
  Write-Host "  ✓ blockmap: $blockmap (${bmSizeKB} KB)" -ForegroundColor Green
}

# ===== 4. 真机端到端 gate(可选) =====
Write-Host ""
Write-Host "[4/7] 真机端到端验证 (可选)" -ForegroundColor Yellow
Write-Host "  可以装 $exe 后测:"
Write-Host "    - NSIS 安装流程"
Write-Host "    - Electron 启动 + Next.js server"
Write-Host "    - Whisper 模型(首次下 ~500MB from hf-mirror.com)"
Write-Host "    - MiniMax 翻译(需 MINIMAX_API_KEY env)"
Write-Host "    - 3 个 SRT 导出按钮"
Write-Host "  跳过验证请直接按 Enter"
Read-Host

# ===== 5. git commit + push =====
Write-Host ""
Write-Host "[5/7] git commit + push..." -ForegroundColor Cyan

# 确保 apps/web/.gitignore 排除 release/(1.8GB EXE + win-unpacked/)
$webGitignore = "apps/web/.gitignore"
$giContent = Get-Content $webGitignore -Raw -ErrorAction SilentlyContinue
if ($giContent -notmatch '(?m)^/?release/?$') {
  Write-Host "  提示:apps/web/.gitignore 没排除 release/, 自动加上" -ForegroundColor Yellow
  Add-Content -Path $webGitignore -Value "`r`n# electron-builder output (NSIS EXE + win-unpacked ~2GB)`r`nrelease/`r`n"
  git add $webGitignore
}

# builder-debug.yml 不进 release/(可放进 source),这里 gitignore 它
# (electron-builder 每次重写,容易触发 git pull 噪音)

# 显式 add 源文件(不靠 -A,.next/build cache 本来就 .gitignore)
git add apps/web/package.json apps/web/src bun.lock 2>$null

$status = git status --porcelain
if ($status) {
  git commit -m "${Tag}: ${Message}"
  if ($LASTEXITCODE -ne 0) {
    throw "git commit 失败"
  }
  git push origin master
  if ($LASTEXITCODE -ne 0) {
    throw "git push 失败"
  }
  Write-Host "  ✓ commit + push" -ForegroundColor Green
} else {
  Write-Host "  没有 source 改动,跳过 commit (EXE 已 release 也要 tag)" -ForegroundColor Yellow
}

# ===== 6. git tag + push tag =====
Write-Host ""
Write-Host "[6/7] git tag ${Tag} + push..." -ForegroundColor Cyan
$existingTag = git tag --list $Tag
if ($existingTag) {
  Write-Host "  tag $Tag 已存在,先删旧的" -ForegroundColor Yellow
  git tag -d $Tag
  git push origin :$Tag --force
}
git tag -a $Tag -m "${Tag}: ${Message}"
git push origin $Tag
if ($LASTEXITCODE -ne 0) {
  throw "git push tag 失败"
}
Write-Host "  ✓ tag pushed" -ForegroundColor Green

# ===== 7. gh release create + 挂 EXE =====
Write-Host ""
Write-Host "[7/7] gh release create ${Tag} + 挂 EXE..." -ForegroundColor Cyan
$existingRelease = gh release view $Tag 2>&1 | Out-String
$existingOk = $LASTEXITCODE -eq 0

$assets = @($exe)
if (Test-Path $blockmap) {
  $assets += $blockmap
}

if ($existingOk) {
  Write-Host "  release $Tag 已存在,补传 .exe (clobber)" -ForegroundColor Yellow
  gh release upload $Tag $assets --clobber
} else {
  $notes = @"
## opencut-desktop v${NewVersion} (build ${Build})

### 改动

$Message

### 技术栈
- Electron $electronDep + electron-builder 25.1.8
- Next.js 16.2.4 (production, Turbopack)
- Whisper: onnx-community/whisper-small (q4, hf-mirror.com,首次 ~500MB)
- 翻译: MiniMax chat completions (MiniMax-Text-01) → Simplified Chinese
- SRT 导出: .en / .zh / bilingual 三种

### EXE 信息
- 路径: \`${exe}\`
- 大小: **${sizeMB} MB** (NSIS installer, x64)
- 安装到: \`%LOCALAPPDATA%\Programs\OpenCut Desktop\` (默认)
- ⚠️ **首次运行需在 SmartScreen 选 "仍要运行"**(没代码签名)

### 已知限制
- 没代码签名证书,SmartScreen 会警告
- 主进程是 CJS (electron@^33 仍支持),没切 ESM
- 没接 NSIS 自动更新,新版本需手动下载安装
"@

  $notesFile = "$env:TEMP\opencut_release_notes.md"
  Set-Content -Path $notesFile -Value $notes -Encoding UTF8

  gh release create $Tag $assets `
    --title "opencut-desktop ${Tag}" `
    --notes-file $notesFile
}
if ($LASTEXITCODE -ne 0) {
  throw "gh release create 失败"
}

Write-Host ""
Write-Host "=== 发布完成 ===" -ForegroundColor Green
Write-Host "Release: https://github.com/liaoguogang-hub/opencut-desktop/releases/tag/$Tag" -ForegroundColor Green
Write-Host "本地 EXE: $(Resolve-Path $exe)" -ForegroundColor Green
