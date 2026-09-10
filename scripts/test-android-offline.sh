#!/usr/bin/env bash
set -euo pipefail
mkdir -p dist/android-offline
export ANDROID_USER_HOME="$RUNNER_TEMP/p08-android"
export ANDROID_AVD_HOME="$ANDROID_USER_HOME/avd"
mkdir -p "$ANDROID_AVD_HOME"
sdkmanager "system-images;android-35;google_apis;x86_64" "emulator" > dist/android-offline/sdk.log
echo no | avdmanager create avd -n p08 -k "system-images;android-35;google_apis;x86_64" --force
"$ANDROID_HOME/emulator/emulator" -list-avds | grep -qx p08
sudo chmod 666 /dev/kvm
"$ANDROID_HOME/emulator/emulator" -avd p08 -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect > dist/android-offline/emulator.log 2>&1 &
emulator_pid=$!
trap 'kill "$emulator_pid" || true' EXIT
timeout 90 adb wait-for-device || { cat dist/android-offline/emulator.log; exit 1; }
for attempt in $(seq 1 120); do
  if [[ "$(adb shell getprop sys.boot_completed | tr -d '\r')" == "1" ]]; then break; fi
  sleep 2
done
test "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" || { cat dist/android-offline/emulator.log; exit 1; }
adb shell input keyevent 82
adb shell settings put system screen_off_timeout 1800000
adb shell locksettings set-pin 123456
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb install -r apps/mobile/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell cmd connectivity airplane-mode enable
for stage in seed reopen; do
  adb shell am instrument -w -r -e stage "$stage" -e class app.finanzas.personales.demo.ManualOutboxTest app.finanzas.personales.demo.test/androidx.test.runner.AndroidJUnitRunner | tee "dist/android-offline/$stage.txt"
  grep -q 'OK (1 test)' "dist/android-offline/$stage.txt"
  adb exec-out screencap -p > "dist/android-offline/$stage.png"
  adb shell am force-stop app.finanzas.personales.demo
done
