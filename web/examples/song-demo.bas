' SONG demo — autonomous music sequencer on top of EFFECT/NOTE.

EFFECT bass
  STEP 0,   WAVE_SAW,   0, 255, 210, 0
  STEP 90,  WAVE_SAW,   0, 255, 150, 0
  STEP 180, OFF
END EFFECT

EFFECT lead
  STEP 0,   WAVE_PULSE, 0, 92, 255, 0
  STEP 20,  WAVE_PULSE, 0, 92, 210, 0
  STEP 70,  WAVE_PULSE, 0, 92, 176, 0
  STEP 150, OFF
END EFFECT

SONG spacey, 92, 1
  TRACK 0, bass, 0,   0, "C2:8 R:4 GS1:8 R:4 AS1:8 R:4 GS1:8 R:4"
  TRACK 1, lead, 320, 8, "R:8 C4:4 DS4:4 G4:8 R:8 DS4:4 F4:4 C4:8"
END SONG

VOLUME 176
VFILTER 0, 96, 40, FILTER_LP
VFILTER 1, 180, 24, FILTER_LP
VDRIVE 0, 72
VDRIVE 1, 96
FILTER 220, 12, FILTER_LP

running = 1
btn_held = 0
started = 0

SUB start_music()
  MPLAY spacey
  running = 1
  started = 1
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
  TEXT_LG "SONG DEMO", 18, 6
  TEXT_SM "BTN TOGGLE", 28, 24
  TEXT_SM "AUTONOMOUS", 26, 36
  YIELD
LOOP
