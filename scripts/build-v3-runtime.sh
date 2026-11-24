#!/usr/bin/env bash
set -euo pipefail

compiler_dir="${1:?Kotlin compiler lib directory}"
output="${2:-runtime-bin}"
mkdir -p "$output"
base=https://repo.maven.apache.org/maven2
curl -fsSL "$base/org/json/json/20250517/json-20250517.jar" -o "$output/json.jar"
curl -fsSL "$base/org/java-websocket/Java-WebSocket/1.6.0/Java-WebSocket-1.6.0.jar" -o "$output/websocket.jar"
curl -fsSL "$base/org/slf4j/slf4j-api/2.0.17/slf4j-api-2.0.17.jar" -o "$output/slf4j.jar"
cp "$compiler_dir/kotlin-stdlib.jar" "$output/"
separator=:
case "$(uname -s)" in MINGW*|MSYS*) separator=";";; esac
classpath="$output/kotlin-stdlib.jar${separator}$output/json.jar${separator}$output/websocket.jar${separator}$output/slf4j.jar"
java -cp "$compiler_dir/*" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
  -jvm-target 17 -no-stdlib -no-reflect -classpath "$classpath" -d "$output/ps5-v3.jar" runtime/*.kt runtime/core/*.kt
java -cp "$output/ps5-v3.jar${separator}$classpath" expo.modules.ps5translator.core.DesktopCoreKt --self-test
