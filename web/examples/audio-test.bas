' Audio test — exercises TONE, SFX, and direct voice control
' Press button to cycle through sounds

VOLUME 200
state = 0

DO
  inp = INPUT()

  IF inp AND INPUT_BTN THEN
    IF state = 0 THEN
      ' Simple tone
      TONE 440, 500
      state = 1
    ELSEIF state = 1 THEN
      ' Laser SFX
      SFX SFX_LASER
      state = 2
    ELSEIF state = 2 THEN
      ' Explosion SFX
      SFX SFX_EXPLODE
      state = 3
    ELSEIF state = 3 THEN
      ' Pickup SFX
      SFX SFX_PICKUP
      state = 4
    ELSEIF state = 4 THEN
      ' Coin SFX
      SFX SFX_COIN
      state = 5
    ELSEIF state = 5 THEN
      ' Direct voice: saw wave with ADSR
      ENVELOPE 0, 10, 50, 180, 100
      VOICE 0, WAVE_SAW, 440, 0
      state = 6
    ELSEIF state = 6 THEN
      ' Release the voice
      NOTEOFF 0
      state = 7
    ELSEIF state = 7 THEN
      ' Filtered pulse
      FILTER 100, 200, FILTER_LP, 1
      ENVELOPE 0, 5, 30, 200, 80
      VOICE 0, WAVE_PULSE, 220, 128
      state = 8
    ELSEIF state = 8 THEN
      NOTEOFF 0
      FILTER 255, 0, FILTER_LP, 0
      state = 0
    END IF

    ' Debounce: wait for release
    DO WHILE INPUT() AND INPUT_BTN
      YIELD
    LOOP
  END IF

  ' Draw state indicator
  CLEAR
  TEXT_SM "AUDIO TEST", 20, 5
  TEXT_SM "BTN=NEXT", 30, 20
  TEXT_NUM state, 60, 40
  YIELD
LOOP
