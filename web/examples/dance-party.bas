' Dance-party-inspired sequencer demo.
' This is an approximation built for the new SONG/TRACK runtime,
' not a note-perfect transcription of the original C64 tune.

EFFECT bass
  STEP 0,   WAVE_SAW,   0, 255, 220, 0
  STEP 50,  WAVE_SAW,   0, 255, 184, 0
  STEP 110, WAVE_SAW,   0, 255, 150, 0
  STEP 180, OFF
END EFFECT

EFFECT stab
  STEP 0,   WAVE_PULSE, 0, 80, 255, 0
  STEP 18,  WAVE_PULSE, 0, 80, 172, 0
  STEP 50,  WAVE_PULSE, 0, 80, 110, 0
  STEP 90,  OFF
END EFFECT

EFFECT lead
  STEP 0,   WAVE_PULSE, 0, 100, 255, 0
  STEP 24,  WAVE_PULSE, 0, 100, 220, 0
  STEP 70,  WAVE_PULSE, 0, 100, 176, 0
  STEP 150, OFF
END EFFECT

EFFECT kick
  STEP 0,   WAVE_NOISE, 0, 255, 255, 64
  STEP 12,  WAVE_NOISE, 0, 255, 180, 56
  STEP 28,  WAVE_NOISE, 0, 255, 96,  40
  STEP 52,  OFF
END EFFECT

SONG danceparty, 120, 1
  TRACK 0, bass, 0,   0, "C2:2 R:2 C2:2 R:2 GS1:2 R:2 AS1:2 R:2 C2:2 R:2 C2:2 R:2 DS2:2 R:2 F2:2 R:2"
  TRACK 1, stab, 0,   0, "R:2 C4:2 R:2 C4:2 R:2 DS4:2 R:2 F4:2 R:2 C4:2 R:2 C4:2 R:2 GS3:2 R:2 AS3:2"
  TRACK 2, lead, 320, 8, "R:8 G4:2 AS4:2 C5:4 R:4 AS4:2 G4:2 F4:4 R:4 G4:2 AS4:2 C5:2 AS4:2 G4:4"
  TRACK 3, kick, 0,   0, "C1:1 R:3 C1:1 R:3 C1:1 R:3 C1:1 R:3 C1:1 R:3 C1:1 R:3 C1:1 R:3 C1:1 R:3"
END SONG

VOLUME 168
VFILTER 0, 80, 48, FILTER_LP
VFILTER 1, 168, 84, FILTER_NOTCH
VFILTER 2, 196, 28, FILTER_LP
VFILTER 3, 64,  100, FILTER_LP
VDRIVE 0, 88
VDRIVE 1, 36
VDRIVE 2, 96
VDRIVE 3, 110
FILTER 228, 10, FILTER_LP

running = 0
btn_held = 0

SUB start_music()
  MPLAY danceparty
  running = 1
END SUB

SUB stop_music()
  MSTOP
  running = 0
END SUB

start_music

DO
  inp = INPUT()

  IF inp AND INPUT_BTN THEN
    IF btn_held = 0 THEN
      btn_held = 1
      IF running = 1 THEN
        stop_music
      ELSE
        start_music
      END IF
    END IF
  ELSE
    btn_held = 0
  END IF

  CLEAR
  TEXT_LG "DANCE PARTY", 10, 6
  TEXT_SM "BTN TOGGLE", 28, 24
  TEXT_SM "SONG+TRACK", 24, 36
  YIELD
LOOP
