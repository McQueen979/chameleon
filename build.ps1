# Chameleon portable build script
#
# NOTE: this file is intentionally ASCII-only. Windows PowerShell 5.1 reads .ps1
# files with the system ANSI codepage unless they carry a UTF-8 BOM, so Chinese
# characters here get decoded as garbage and break string literals.
#
# Why not electron-builder / electron-packager: they download extra build tools
# (NSIS, rcedit, ...) from GitHub, which is slow or blocked here. This script
# assembles the already-downloaded Electron runtime into a portable folder
# instead. Fully offline, and the result can be copied to a USB stick.
#
# Usage:  npm run build   (or)   powershell -ExecutionPolicy Bypass -File build.ps1
# Output: dist\Chameleon\Chameleon.exe plus a desktop shortcut

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$electronDist = Join-Path $root 'node_modules\electron\dist'
$out = Join-Path $root 'dist\Chameleon'
$appDir = Join-Path $out 'resources\app'

if (-not (Test-Path (Join-Path $electronDist 'electron.exe'))) {
    throw "Electron runtime not found at $electronDist - run npm install first."
}

Write-Host 'Cleaning previous build...'
if (Test-Path $out) { Remove-Item -LiteralPath $out -Recurse -Force }
New-Item -ItemType Directory -Path $out -Force | Out-Null

Write-Host 'Copying Electron runtime...'
Copy-Item -Path (Join-Path $electronDist '*') -Destination $out -Recurse -Force
Rename-Item -LiteralPath (Join-Path $out 'electron.exe') -NewName 'Chameleon.exe'

Write-Host 'Installing application code...'
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
Copy-Item -Path (Join-Path $root 'src') -Destination $appDir -Recurse -Force
Copy-Item -Path (Join-Path $root 'package.json') -Destination $appDir -Force

# Only ship production dependencies (markdown-it and its dependency chain).
Write-Host 'Copying runtime dependencies...'
$deps = @('markdown-it', 'argparse', 'entities', 'linkify-it', 'mdurl', 'punycode.js', 'uc.micro')
$nm = Join-Path $appDir 'node_modules'
New-Item -ItemType Directory -Path $nm -Force | Out-Null
foreach ($dep in $deps) {
    $src = Join-Path $root "node_modules\$dep"
    if (Test-Path $src) {
        Copy-Item -LiteralPath $src -Destination $nm -Recurse -Force
    } else {
        Write-Warning "Missing dependency: $dep - run npm install again."
    }
}

Write-Host 'Creating desktop shortcut...'
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'Chameleon.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnk)
$shortcut.TargetPath = Join-Path $out 'Chameleon.exe'
$shortcut.WorkingDirectory = $out
# A plain system document icon: on the desktop it just looks like an ordinary file.
$shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,-102"
$shortcut.Description = ''
$shortcut.Save()

# Second shortcut: opens the settings window, which is an ordinary window separate
# from the zero-chrome reader (this script must stay ASCII-only, hence the English name).
Write-Host 'Creating settings shortcut...'
$lnkSettings = Join-Path $desktop 'Chameleon Settings.lnk'
$settings = $shell.CreateShortcut($lnkSettings)
$settings.TargetPath = Join-Path $out 'Chameleon.exe'
$settings.Arguments = '--settings'
$settings.WorkingDirectory = $out
$settings.IconLocation = "$env:SystemRoot\System32\imageres.dll,-70"
$settings.Description = ''
$settings.Save()

$size = [math]::Round(((Get-ChildItem $out -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB), 1)
Write-Host ''
Write-Host "Done:      $out   ($size MB)"
Write-Host "Shortcut:  $lnk"
Write-Host "Settings:  $lnkSettings"
Write-Host ''
Write-Host 'Drag a folder or a .md file onto the shortcut to open it.'
