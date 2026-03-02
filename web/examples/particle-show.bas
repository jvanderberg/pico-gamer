' Particle Effects Showcase
' Automatically cycles through 5 effects, each lasting 4 seconds.
' No input required — just watch!

CONST DUR = 240        ' frames per effect (4 sec at 60fps)
CONST EFFECTS = 5

frame = 0

DO
  effect = (frame DIV DUR) MOD EFFECTS
  t = frame MOD DUR

  ' Reset emitters on effect transition
  IF t = 0 THEN PFX_CLEAR PFX_ALL

  ' -------------------------------------------------------
  IF effect = 0 THEN
    ' FIREWORKS — random bursts with gravity
    IF t MOD 20 = 0 THEN
      PFX_SET 0, 70, 25, 128, 0, 1, PFX_SPEED_VAR OR PFX_LIFE_VAR
      PFX_POS 0, 15 + RAND() MOD 98, 8 + RAND() MOD 28
      PFX_BURST 0, 25
    END IF
    IF t MOD 20 = 10 THEN
      PFX_SET 1, 45, 18, 128, 0, 2, PFX_SPEED_VAR OR PFX_LIFE_VAR OR PFX_2X2
      PFX_POS 1, 15 + RAND() MOD 98, 8 + RAND() MOD 28
      PFX_BURST 1, 18
    END IF
    TEXT_LG "FIREWORKS", 34, 54

  ' -------------------------------------------------------
  ELSEIF effect = 1 THEN
    ' FOUNTAIN — upward jet that arcs back down
    IF t = 0 THEN
      ' dir=192 is straight up, spread=18 for a narrow cone
      PFX_SET 0, 90, 45, 18, 192, 2, PFX_SPEED_VAR OR PFX_LIFE_VAR
      PFX_POS 0, 64, 60
      PFX_ON 0, 3
      ' Secondary mist at base
      PFX_SET 1, 20, 8, 60, 192, 0, PFX_SPEED_VAR OR PFX_LIFE_VAR
      PFX_POS 1, 64, 60
      PFX_ON 1, 1
    END IF
    ' Draw basin
    RECT 48, 61, 33, 3
    TEXT_LG "FOUNTAIN", 37, 0

  ' -------------------------------------------------------
  ELSEIF effect = 2 THEN
    ' SNOW — gentle fall with slight drift
    IF t = 0 THEN
      ' dir ~72 = slightly right of straight down, slow speed
      PFX_SET 0, 12, 90, 12, 72, 0, PFX_SPEED_VAR OR PFX_LIFE_VAR
      PFX_SET 1, 8, 120, 8, 68, 0, PFX_LIFE_VAR
      ' Larger flakes
      PFX_SET 2, 6, 100, 10, 70, 0, PFX_LIFE_VAR OR PFX_2X2
    END IF
    ' Scatter spawn points across the top
    PFX_POS 0, RAND() MOD 128, 0
    PFX_POS 1, RAND() MOD 128, 0
    PFX_POS 2, RAND() MOD 128, 0
    PFX_ON 0, 1
    PFX_ON 1, 1
    PFX_ON 2, 1
    ' Ground
    RECT 0, 62, 128, 2
    ' Trees (simple triangles)
    RECT 18, 50, 1, 12
    RECT 14, 50, 9, 1
    RECT 15, 48, 7, 1
    RECT 16, 46, 5, 1
    RECT 17, 44, 3, 1
    RECT 100, 48, 1, 14
    RECT 96, 48, 9, 1
    RECT 97, 46, 7, 1
    RECT 98, 44, 5, 1
    RECT 99, 42, 3, 1
    TEXT_LG "SNOW", 49, 0

  ' -------------------------------------------------------
  ELSEIF effect = 3 THEN
    ' SPARKLER — emitter orbits center, leaves glowing trail
    IF t = 0 THEN
      PFX_SET 0, 25, 12, 128, 0, 0, PFX_SPEED_VAR OR PFX_LIFE_VAR
      PFX_ON 0, 4
      ' Second emitter orbits opposite side
      PFX_SET 1, 20, 10, 128, 0, 0, PFX_SPEED_VAR OR PFX_LIFE_VAR OR PFX_2X2
      PFX_ON 1, 3
    END IF
    ' Orbit emitter 0: radius 25x18
    angle = (t * 3) AND 255
    sv = SIN(angle)
    cv = COS(angle)
    IF sv >= 128 THEN sv = sv OR $FF00
    IF cv >= 128 THEN cv = cv OR $FF00
    ox = FX_MUL(cv, 25, 7)
    oy = FX_MUL(sv, 18, 7)
    PFX_POS 0, 64 + ox, 30 + oy
    ' Orbit emitter 1: opposite phase, smaller radius
    angle2 = (angle + 128) AND 255
    sv2 = SIN(angle2)
    cv2 = COS(angle2)
    IF sv2 >= 128 THEN sv2 = sv2 OR $FF00
    IF cv2 >= 128 THEN cv2 = cv2 OR $FF00
    ox2 = FX_MUL(cv2, 18, 7)
    oy2 = FX_MUL(sv2, 13, 7)
    PFX_POS 1, 64 + ox2, 30 + oy2
    ' Center crosshair
    PIXEL 64, 30, 1
    PIXEL 63, 30, 1
    PIXEL 65, 30, 1
    PIXEL 64, 29, 1
    PIXEL 64, 31, 1
    TEXT_LG "SPARKLER", 37, 54

  ' -------------------------------------------------------
  ELSEIF effect = 4 THEN
    ' CHAIN BLAST — sequential explosions marching across
    phase = t DIV 40
    IF t MOD 40 = 0 THEN
      slot = phase MOD 4
      PFX_SET slot, 100, 18, 128, 0, 1, PFX_SPEED_VAR OR PFX_LIFE_VAR OR PFX_2X2
      bx = 16 + (phase MOD 6) * 19
      PFX_POS slot, bx, 32
      PFX_BURST slot, 30
    END IF
    ' Also small secondary pops between main blasts
    IF t MOD 40 = 20 THEN
      slot = (phase + 2) MOD 4
      PFX_SET slot, 50, 12, 128, 0, 0, PFX_SPEED_VAR OR PFX_LIFE_VAR
      bx = 8 + (phase MOD 6) * 19 + 10
      PFX_POS slot, bx, 32 + RAND() MOD 10 - 5
      PFX_BURST slot, 15
    END IF
    TEXT_LG "CHAIN BLAST", 25, 54
  END IF

  frame = frame + 1
  IF frame >= DUR * EFFECTS THEN frame = 0

  YIELD
LOOP
