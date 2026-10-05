# Checks — October 5, 2026

- TypeScript checking and six protocol test groups passed. These cover Base64,
  complete snapshots, missing/invalid fields, reconnect reset, interleaved shot
  packets, empty sessions, and full 32-bit counters.
- The final firmware's actual STATE records passed through the app parser,
  including the stored Session Debug packet and its example-only status.
- The web preview loaded without browser errors. Checked the training screen,
  Settings, Debug Zone, Session Debug, and the debug-information switch at a
  phone-sized viewport. Rapid stays disabled and debug information starts off.
- Reviewed shared components, hook cleanup, command serialization, disconnect
  handling, accessibility labels, and four-space formatting.
- Android release build passed for the connected Samsung's arm64 architecture.
  The first build exhausted the default Java heap during DEX merging; the build
  passed with a 6 GB heap and two workers. APK signature verification passed.
- The local test APK uses the existing development signing key and includes
  its JavaScript bundle, so Metro is not required. Copy:
  C:/Workspace/precisionshot/output/PrecisionShot-connected-2026-10-05.apk.
- Installed successfully on Samsung SM-S908U1 (R5CT11BRQHJ) and launched the
  standalone app. Its real Bluetooth scan found PrecisionShot; connect and
  initial state confirmation passed. The main screen showed 10.0 m, ten shots
  left, total zero, and enabled controls, with Rapid disabled and debug hidden.
  This final connection check sent STATE only and played no sound.

Board UI testing was stopped at the user's request because of the loud beeper.
The firmware's command checks passed before that stop; no further sound or
animation tests are needed to install this app.

Target icon update:
- Generated target-only standard, adaptive, monochrome, and favicon assets.
- Regenerated Android resources and built the arm64 release successfully.
- Verified the APK signature matches the previous app and installed the update
  successfully on the Samsung phone. Its lock screen prevented a visual launcher
  check; no board commands were sent.
- APK: C:/Workspace/precisionshot/output/PrecisionShot-target-icon-2026-10-05.apk.
# Regulator and sensor input update — 2026-10-05

- TypeScript checks and seven protocol tests passed, including negative
  temperatures, unavailable readings, and invalid sensor values.
- Android arm64 release build passed; installed on the connected Samsung.
- The real app parser accepted three live firmware snapshots with both
  temperatures, ADC voltage/count, and detection state.
- The phone was locked, so the new Debug Zone layout was not visually checked
  on the phone. No firmware sound or animation tests were run.
- APK: C:/Workspace/precisionshot/output/PrecisionShot-sensors-2026-10-05.apk.
# Debug Zone layout and refresh update — 2026-10-05

- Added a live-readings panel above the existing animation/music buttons and
  removed the standalone beep button. Stop Sound remains available.
- TypeScript and seven protocol tests passed. Android release build passed
  and the update installed successfully on the Samsung phone.
- Layout was reviewed in source; no phone visual check or board UI tests ran.
- APK: C:/Workspace/precisionshot/output/PrecisionShot-debug-layout-2026-10-05.apk.
# Phone sensor watch and command sync — 2026-10-05

- The hook requests readings only while Debug Zone is visible and AppState is
  active. Background/panel close sends WATCH:0; reconnect waits for initial sync.
- Navigation confirmations override stale states already in flight. Old write
  failures are guarded so they cannot reject a new connection's command.
- TypeScript and eight protocol tests passed, including stopped/partial readings.
- Android release build and Samsung install passed.
- Quiet firmware transport checks passed 30 confirmations under live telemetry,
  stop/expiry/reconnect, with maximum observed confirmation latency 0.391 s.
- No phone visual or board touchscreen/audio tests ran in this update.
- APK: C:/Workspace/precisionshot/output/PrecisionShot-watch-sync-2026-10-05.apk.
# Temperature unit text correction — 2026-10-05

- Found Unicode replacement characters in the live-readings panel text.
- Replaced the degree character with a JavaScript Unicode escape and used
  simple placeholders/separators. No font change was needed.
- TypeScript and Android release build passed; updated Samsung installation.
- Reconnected the phone and visually checked Debug Zone with live readings:
  31.4 degrees Celsius and 40.4 degrees Celsius displayed correctly as °C.
  Sensor voltage, separators, and range text rendered correctly too.
- Returned to the main screen after inspection. No shots, resets, or music
  were triggered. Screenshot: .expo/temperature-fixed.png.
- APK: C:/Workspace/precisionshot/output/PrecisionShot-temperature-text-2026-10-05.apk.
