' Asteroids Encoder Test
' Ship only (no asteroids) for high-speed encoder rotation testing.

' Ship vector data (larger triangle, 3 segments in 4.4 signed fixed-point)
DATA ship_vecs, 3, $00,$A0,$C0,$40, $C0,$40,$40,$40, $40,$40,$00,$A0

' Large HUD labels
DATA lbl_ang, $41,$4E,$47,$00
DATA lbl_cw, $43,$57,$00
DATA lbl_ccw, $43,$43,$57,$00

ship_vx = 0
ship_vy = 0
cw_ticks = 0
ccw_ticks = 0

SPRITE 0, ship_vecs, 13, 13, 62, 30, SPR_VECTOR, 0, 0, EDGE_WRAP
SPR_COLL 0, COLL_NONE

SUB draw_num_big(v, x, y)
  ' Draw up to 3 digits using crisp 7-segment block numerals.
  IF v < 0 THEN v = 0
  IF v > 999 THEN v = 999

  h = v DIV 100
  t = (v DIV 10) MOD 10
  o = v MOD 10

  ' Draw hundreds only when needed
  IF h > 0 THEN draw_digit h, x, y

  ' Draw tens when hundreds exists or tens non-zero
  IF h > 0 OR t > 0 THEN
    draw_digit t, x + 12, y
    draw_digit o, x + 24, y
  ELSE
    draw_digit o, x + 12, y
  END IF
END SUB

SUB draw_digit(d, x, y)
  ' 7-segment layout (digit box: 10x16)
  ' a: top, b: upper-right, c: lower-right, d: bottom
  ' e: lower-left, f: upper-left, g: middle

  ' a
  IF d <> 1 AND d <> 4 THEN RECT x + 2, y + 0, 6, 2
  ' b
  IF d <> 5 AND d <> 6 THEN RECT x + 8, y + 2, 2, 5
  ' c
  IF d <> 2 THEN RECT x + 8, y + 9, 2, 5
  ' d
  IF d <> 1 AND d <> 4 AND d <> 7 THEN RECT x + 2, y + 14, 6, 2
  ' e
  IF d = 0 OR d = 2 OR d = 6 OR d = 8 THEN RECT x + 0, y + 9, 2, 5
  ' f
  IF d = 0 OR d = 4 OR d = 5 OR d = 6 OR d = 8 OR d = 9 THEN RECT x + 0, y + 2, 2, 5
  ' g
  IF d <> 0 AND d <> 1 AND d <> 7 THEN RECT x + 2, y + 7, 6, 2
END SUB

DO
  inp = INPUT()
  enc_delta = ASHR(inp, INPUT_ENC_DELTA_SHIFT)

  ' Rotate using signed accumulated encoder delta.
  IF enc_delta <> 0 THEN
    angle = SPR_GETROT(0)
    angle = (angle + enc_delta * 9) AND 255
    SPR_ROT 0, angle, 0
  END IF

  ' Count total encoder ticks by direction (for fast-spin visibility).
  IF enc_delta > 0 THEN cw_ticks = cw_ticks + enc_delta
  IF enc_delta < 0 THEN ccw_ticks = ccw_ticks - enc_delta

  ' Optional thrust (same feel as Asteroids).
  IF inp AND INPUT_BTN THEN
    thrust_angle = (SPR_GETROT(0) + 192) AND 255

    cos_val = COS(thrust_angle)
    IF cos_val >= 128 THEN cos_val = cos_val - 256
    ship_vx = ship_vx + FX_MUL(cos_val, 2, 5)

    sin_val = SIN(thrust_angle)
    IF sin_val >= 128 THEN sin_val = sin_val - 256
    ship_vy = ship_vy + FX_MUL(sin_val, 2, 5)
  END IF

  ' Drag
  ship_vx = ship_vx - FX_MUL(ship_vx, 6, 8)
  ship_vy = ship_vy - FX_MUL(ship_vy, 6, 8)

  ' Clamp
  IF ship_vx > 384 THEN ship_vx = 384
  IF ship_vx < -384 THEN ship_vx = -384
  IF ship_vy > 384 THEN ship_vy = 384
  IF ship_vy < -384 THEN ship_vy = -384

  SPR_VEL 0, ship_vx SHR 2, ship_vy SHR 2

  ' ENC_BTN clears counters and velocity.
  IF inp AND INPUT_ENC_BTN THEN
    cw_ticks = 0
    ccw_ticks = 0
    ship_vx = 0
    ship_vy = 0
    SPR_VEL 0, 0, 0
  END IF

  ' HUD: larger labels + thicker numbers
  TEXT_LG lbl_ang, 1, 1
  ang = SPR_GETROT(0)
  draw_num_big ang, 30, 1

  TEXT_LG lbl_cw, 1, 21
  draw_num_big cw_ticks, 26, 21

  TEXT_LG lbl_ccw, 1, 41
  draw_num_big ccw_ticks, 32, 41

  YIELD
LOOP
