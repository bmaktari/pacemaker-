# Launches the Android emulator and the Expo dev server for PaceMaker.
# One-time SDK setup is done separately; this is the day-to-day launcher.
#
#   powershell -ExecutionPolicy Bypass -File mobile\run-emulator.ps1
#
# Boots the AVD if it isn't already running, waits for it, then starts Expo
# pointed at the emulator (press `a` in the Expo CLI if it doesn't auto-open).

$ErrorActionPreference = "Stop"
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:Path = "$sdk\platform-tools;$sdk\emulator;$sdk\cmdline-tools\latest\bin;" +
  [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
  [System.Environment]::GetEnvironmentVariable("Path", "User")

$avd = "pacemaker_pixel"

# Is a device already online?
$devices = & "$sdk\platform-tools\adb.exe" devices
if ($devices -notmatch "emulator-\d+\s+device") {
  Write-Host "Booting emulator '$avd'..." -ForegroundColor Cyan
  Start-Process -FilePath "$sdk\emulator\emulator.exe" -ArgumentList "-avd", $avd, "-gpu", "host"
  Write-Host "Waiting for device to come online..." -ForegroundColor Cyan
  & "$sdk\platform-tools\adb.exe" wait-for-device
  # Wait for full boot
  do {
    Start-Sleep -Seconds 2
    $booted = & "$sdk\platform-tools\adb.exe" shell getprop sys.boot_completed 2>$null
  } while ($booted.Trim() -ne "1")
  Write-Host "Emulator ready." -ForegroundColor Green
} else {
  Write-Host "Emulator already running." -ForegroundColor Green
}

Set-Location $PSScriptRoot
Write-Host "Starting Expo (press 'a' to open on the emulator if it doesn't auto-launch)..." -ForegroundColor Cyan
npx expo start --android
