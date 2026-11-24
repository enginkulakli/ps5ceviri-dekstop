$ErrorActionPreference = 'Stop'
$tools = Join-Path $PWD '.native-deps'
$runtime = Join-Path $PWD 'runtime-bin'
New-Item -ItemType Directory -Path $tools, $runtime -Force | Out-Null

$kotlin = Join-Path $tools 'kotlin.zip'
Invoke-WebRequest 'https://github.com/JetBrains/kotlin/releases/download/v2.2.21/kotlin-compiler-2.2.21.zip' -OutFile $kotlin
Expand-Archive $kotlin -DestinationPath $tools -Force

$ffmpeg = Join-Path $tools 'ffmpeg.zip'
Invoke-WebRequest 'https://github.com/GyanD/codexffmpeg/releases/download/9.1/ffmpeg-9.1-essentials_build.zip' -OutFile $ffmpeg
$actual = (Get-FileHash -Algorithm SHA256 $ffmpeg).Hash.ToLowerInvariant()
if ($actual -ne 'b9bbbb3acece000cbeec994f856649354e52c773807841e78908374b24d658fd') {
  throw 'FFmpeg archive checksum mismatch.'
}
Expand-Archive $ffmpeg -DestinationPath $tools -Force
$ffmpegRoot = Join-Path $tools 'ffmpeg-9.1-essentials_build'
Copy-Item (Join-Path $ffmpegRoot 'bin/ffmpeg.exe') $runtime
Copy-Item (Join-Path $ffmpegRoot 'LICENSE') (Join-Path $runtime 'FFmpeg-LICENSE.txt')
& (Join-Path $runtime 'ffmpeg.exe') -version
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

jlink --add-modules java.base,java.logging,java.xml --no-header-files --no-man-pages --strip-debug --compress=2 --output (Join-Path $runtime 'jre')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
