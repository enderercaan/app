# Device Matrix

| Family | Required cases | Automated/source evidence | Human/device-farm evidence |
|---|---|---|---|
| iPhone compact | SE 3rd gen, mini-class, portrait/landscape where supported | safe-area/a11y/layout checks | VERIFY real device goldens |
| iPhone standard/large | 13–16, Plus/Max, Pro/Pro Max, notch + Dynamic Island | edge-to-edge/source checks | VERIFY 60/120 Hz, Display Zoom, gesture bar |
| iPad | mini, standard, Air, Pro 11/13 | responsive source checks | VERIFY split view, Stage Manager, keyboard |
| Android compact | ≤360dp, gesture + 3-button nav | RN responsive/a11y checks | VERIFY low-RAM and IME |
| Android medium | 360–411dp, 18:9–21:9 | source checks | VERIFY representative physical devices |
| Android large | ≥412dp, cutout/waterfall cases | source checks | VERIFY edge/cutout physical behavior |
| Android tablet/Chromebook | medium/expanded windows | responsive source checks | VERIFY resizable-window behavior |
| Foldable | fold/unfold, tabletop, hinge-aware | test plan + navigation state contract | VERIFY physical/device-farm continuity |
| Accessibility matrix | text scale 0.85–2.0, VoiceOver/TalkBack, reduced motion, switch/voice control | static semantics and 48dp checks | VERIFY real assistive-tech run |
| Locale matrix | all 19 runtime locales; priority visual goldens en/tr/de/ar + pseudo-locale | i18n parity/RTL checks | native-speaker review recommended |
