' NOTE demo — define instruments with EFFECT, then play them as notes.

EFFECT drone
  STEP 0,   WAVE_TRI,   0, 255, 210, 0
  STEP 90,  WAVE_TRI,   0, 255, 150, 0
  STEP 200, OFF
END EFFECT

EFFECT vibrato_lead
  STEP 0,   WAVE_PULSE,  0, 92, 255, 0
  STEP 20,  WAVE_PULSE,  0, 92, 200, 0
  STEP 70,  WAVE_PULSE,  0, 92, 176, 0
  STEP 120, WAVE_PULSE,  0, 92, 162, 0
  STEP 170, OFF
END EFFECT

VOLUME 180
VFILTER 0, 96, 40, FILTER_LP
VFILTER 1, 180, 24, FILTER_LP
VDRIVE 0, 72
VDRIVE 1, 96
FILTER 220, 12, FILTER_LP
running = 1
btn_held = 0
tick = 0
next_tick = 1
note_step = 0

SUB play_step()
  n = note_step MOD 8

  IF n = 0 THEN
    NOTE drone, 0, C2
    NOTE vibrato_lead, 1, C4, 320, 8
  ELSEIF n = 1 THEN
    NOTE vibrato_lead, 1, DS4, 320, 8
  ELSEIF n = 2 THEN
    NOTE drone, 0, GS1
    NOTE vibrato_lead, 1, G4, 320, 8
  ELSEIF n = 3 THEN
    NOTE vibrato_lead, 1, DS4, 320, 8
  ELSEIF n = 4 THEN
    NOTE drone, 0, AS1
    NOTE vibrato_lead, 1, F4, 320, 8
  ELSEIF n = 5 THEN
    NOTE vibrato_lead, 1, C4, 320, 8
  ELSEIF n = 6 THEN
    NOTE drone, 0, GS1
    NOTE vibrato_lead, 1, DS4, 320, 8
  ELSE
    NOTEOFF 0
    NOTEOFF 1
  END IF

  note_step = note_step + 1
  next_tick = tick + 18
END SUB

DO
  inp = INPUT()

  IF inp AND INPUT_BTN THEN
    IF btn_held = 0 THEN
      btn_held = 1
      IF running = 0 THEN
        running = 1
        next_tick = tick
      ELSE
        running = 0
        NOTEOFF 0
        NOTEOFF 1
      END IF
    END IF
  ELSE
    btn_held = 0
  END IF

  IF running = 1 THEN
    tick = tick + 1
    IF tick >= next_tick THEN
      play_step
    END IF
  END IF

  CLEAR
  TEXT_LG "NOTE DEMO", 20, 6
  TEXT_SM "BTN TOGGLE", 28, 24
  TEXT_SM "EFFECT+NOTE", 22, 36
  YIELD
LOOP
