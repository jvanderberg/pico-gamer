' SFX Demo — browse and play all 16 effects + TONE
' Encoder turn to select, Space (ENC_BTN) to play

VOLUME 200
fx = 0
btnHeld = 0

DO
  inp = INPUT()
  enc_delta = ASHR(inp, INPUT_ENC_DELTA_SHIFT)

  ' Encoder turn = change selection
  IF enc_delta > 0 THEN
    fx = fx + 1
    IF fx > 16 THEN
      fx = 0
    END IF
  ELSEIF enc_delta < 0 THEN
    IF fx = 0 THEN
      fx = 16
    ELSE
      fx = fx - 1
    END IF
  END IF

  ' Space / encoder button = play current effect
  IF inp AND INPUT_ENC_BTN THEN
    IF btnHeld = 0 THEN
      btnHeld = 1
      IF fx = 0 THEN
        SFX SFX_LASER, 5
      ELSEIF fx = 1 THEN
        SFX SFX_EXPLODE, 5
      ELSEIF fx = 2 THEN
        SFX SFX_PICKUP, 5
      ELSEIF fx = 3 THEN
        SFX SFX_JUMP, 5
      ELSEIF fx = 4 THEN
        SFX SFX_HIT, 5
      ELSEIF fx = 5 THEN
        SFX SFX_BOUNCE, 5
      ELSEIF fx = 6 THEN
        SFX SFX_POWERUP, 5
      ELSEIF fx = 7 THEN
        SFX SFX_DEATH, 5
      ELSEIF fx = 8 THEN
        SFX SFX_COIN, 5
      ELSEIF fx = 9 THEN
        SFX SFX_BEEP, 5
      ELSEIF fx = 10 THEN
        SFX SFX_THUD, 5
      ELSEIF fx = 11 THEN
        SFX SFX_ZAP, 5
      ELSEIF fx = 12 THEN
        SFX SFX_ALARM, 5
      ELSEIF fx = 13 THEN
        SFX SFX_CLICK, 5
      ELSEIF fx = 14 THEN
        SFX SFX_WHOOSH, 5
      ELSEIF fx = 15 THEN
        SFX SFX_BLIP, 5
      ELSEIF fx = 16 THEN
        TONE 0, 440, 300
      END IF
    END IF
  ELSE
    btnHeld = 0
  END IF

  ' Draw
  CLEAR

  TEXT_LG "SFX DEMO", 22, 2

  LINE 0, 14, 127, 14

  ' Show effect name (large, centered)
  IF fx = 0 THEN
    TEXT_LG "LASER", 34, 24
  ELSEIF fx = 1 THEN
    TEXT_LG "EXPLODE", 22, 24
  ELSEIF fx = 2 THEN
    TEXT_LG "PICKUP", 28, 24
  ELSEIF fx = 3 THEN
    TEXT_LG "JUMP", 40, 24
  ELSEIF fx = 4 THEN
    TEXT_LG "HIT", 46, 24
  ELSEIF fx = 5 THEN
    TEXT_LG "BOUNCE", 28, 24
  ELSEIF fx = 6 THEN
    TEXT_LG "POWERUP", 22, 24
  ELSEIF fx = 7 THEN
    TEXT_LG "DEATH", 34, 24
  ELSEIF fx = 8 THEN
    TEXT_LG "COIN", 40, 24
  ELSEIF fx = 9 THEN
    TEXT_LG "BEEP", 40, 24
  ELSEIF fx = 10 THEN
    TEXT_LG "THUD", 40, 24
  ELSEIF fx = 11 THEN
    TEXT_LG "ZAP", 46, 24
  ELSEIF fx = 12 THEN
    TEXT_LG "ALARM", 34, 24
  ELSEIF fx = 13 THEN
    TEXT_LG "CLICK", 34, 24
  ELSEIF fx = 14 THEN
    TEXT_LG "WHOOSH", 28, 24
  ELSEIF fx = 15 THEN
    TEXT_LG "BLIP", 40, 24
  ELSEIF fx = 16 THEN
    TEXT_LG "TONE", 40, 24
  END IF

  ' Effect number
  TEXT_SM "<", 10, 38
  TEXT_NUM fx, 58, 38
  TEXT_SM "/16", 68, 38
  TEXT_SM ">", 108, 38

  ' Progress bar
  RECT 4, 48, fx * 7, 2

  ' Controls hint
  TEXT_SM "Q/E=SEL SPACE=PLAY", 4, 56

  YIELD
LOOP
