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
# Output: dist\Chameleon\Chameleon.exe (reader), Chameleon Settings.exe (settings)
#         plus desktop shortcuts for both

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

# Second executable, same byte-for-byte binary: the app reads its own file name and
# opens the settings window instead of the reader. Double-clicking it just works,
# no shortcut arguments and no property editing needed.
Write-Host 'Creating settings executable...'
# The settings entry point is a tiny launcher (~4 KB) rather than a second copy of the
# 180 MB Electron binary: it just starts Chameleon.exe with --settings. Falls back to a
# plain copy if no C# compiler is available (the app also detects its own file name).
$settingsExe = Join-Path $out 'Chameleon Settings.exe'
$csc = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($csc) {
    $src = Join-Path $env:TEMP 'chameleon-settings-launcher.cs'
    $code = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

class ChameleonSettings
{
    [STAThread]
    static void Main()
    {
        string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string exe = Path.Combine(dir, "Chameleon.exe");
        if (!File.Exists(exe)) exe = Path.Combine(dir, "Chameleon Settings.exe");
        if (!File.Exists(exe)) return;
        Process.Start(new ProcessStartInfo(exe, "--settings") { UseShellExecute = true });
    }
}
'@
    Set-Content -LiteralPath $src -Value $code -Encoding ASCII
    & $csc /nologo /target:winexe /optimize+ /out:$settingsExe $src | Out-Null
    Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path $settingsExe)) {
        Write-Warning 'Launcher build failed, falling back to a copy of Chameleon.exe.'
        Copy-Item -LiteralPath (Join-Path $out 'Chameleon.exe') -Destination $settingsExe -Force
    }
} else {
    Write-Warning 'No C# compiler found, settings entry will be a copy of Chameleon.exe.'
    Copy-Item -LiteralPath (Join-Path $out 'Chameleon.exe') -Destination $settingsExe -Force
}

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

# Second shortcut: opens the settings window, which is a separate ordinary window
# from the zero-chrome reader. It targets the dedicated settings executable, so a
# plain double-click works without passing any arguments.
Write-Host 'Creating settings shortcut...'
$lnkSettings = Join-Path $desktop 'Chameleon Settings.lnk'
$settings = $shell.CreateShortcut($lnkSettings)
$settings.TargetPath = Join-Path $out 'Chameleon Settings.exe'
$settings.Arguments = ''
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
