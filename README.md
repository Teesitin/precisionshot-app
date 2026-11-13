# PrecisionShot app

This is the phone app for our ESP32-S3 target. It uses Expo, React Native, and
Bluetooth. The board keeps the scores and settings, and the app shows its updates.

- **Rapid (default):** start or cancel a ten-hit round from the phone. The
  board sends the countdown, current cue, hit count, response time, round
  average, and best average. The 4 × 4 grid highlights the cued sensor.
- **Freestyle:** show the latest score and highlight the sensor that registered
  the hit on the same 16-circle grid.
- **Simulate shot / Reset:** test Freestyle scoring or clear the current round.
- **Settings:** connect Bluetooth, change distance, units, sensitivity, and theme.
- **Debug Zone:** live readings, Session Debug, packet views, and a shortcut to
  the onboard GRID.

The Settings switch **Enable debug information** shows diagnostics at the bottom
of the training screen. It starts off. Simulated Freestyle shots cycle through
10, 9, 8, and 7 and leave the zones unmarked.

## Run it

```powershell
pnpm install
pnpm android
```

Use an installed Android or iOS build for Bluetooth. Expo Go and the web preview
cannot connect to the board. Open Settings, tap **Find board**, and select
**PrecisionShot**. Controls become available after its state arrives.

```powershell
pnpm exec tsc --noEmit
node --test tests/protocol.test.cjs
pnpm web
```

For a standalone Android test APK, use the Android SDK and Java 17 or newer:

```powershell
Set-Location android
.\gradlew.bat assembleRelease '-Dorg.gradle.jvmargs=-Xmx6g -XX:MaxMetaspaceSize=1024m' --max-workers=2
adb install -r app\build\outputs\apk\release\app-release.apk
```

This local APK uses the existing development signing key. A store release needs
its own signing key.

## Files

| File | What it does |
|---|---|
| `src/app/index.tsx` | Training screen and settings panels |
| `src/components/` | Target drawing and shared buttons |
| `src/hooks/usePrecisionShotBle.ts` | Scan, connect, send commands, and read updates |
| `src/lib/protocol.ts` | Check incoming packets and complete board states |
| `scripts/generate-icons.py` | Draw the target app icons with Python and Pillow |

TX ends in `0002` and RX ends in `0003` in our shared Bluetooth UUIDs. Each app
request has a number, and the board replies with the matching confirmation. The
app waits for a complete state, so partial Bluetooth updates do not change scores.
After a connection problem, reconnect or use **Sync board** in Settings.

Use four spaces and simple comments. `.prettierrc.json` keeps the style consistent.
Debug Zone shows regulator temperatures, sensor voltage, raw ADC, and detection.
Live readings are requested only while this panel is visible and the app is active.
Closing it or backgrounding the app stops the readings; other controls still sync.
