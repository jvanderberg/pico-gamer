' -- Starfield ----------------------------------------------------------
' 50/50 dithered background, scrolling stars, bouncing balls.
' All movement handled by the sprite engine — zero per-frame CPU.

' -- Graphics DATA -----------------------------------------------------
' Dither tile: 128x2 checkerboard (32 bytes)
DATA dither, $55,$55,$55,$55,$55,$55,$55,$55,$55,$55,$55,$55,$55,$55,$55,$55,$AA,$AA,$AA,$AA,$AA,$AA,$AA,$AA,$AA,$AA,$AA,$AA,$AA,$AA,$AA,$AA

' 1x1 star pixel
DATA star_gfx, $80

' Filled circle 8x8
DATA ball8, $3C,$7E,$FF,$FF,$FF,$FF,$7E,$3C

' Filled circle 12x12 (row-aligned: 2 bytes/row, 24 bytes total)
DATA ball12, $0F,$00,$3F,$C0,$7F,$E0,$7F,$E0,$FF,$F0,$FF,$F0,$FF,$F0,$FF,$F0,$7F,$E0,$7F,$E0,$3F,$C0,$0F,$00

' -- Sprite layout: 0-4 = balls, 5-31 = stars (27 stars) ---------------

' -- Initialize balls (slots 0-4) --------------------------------------
' Velocity unit: 64 = 1 px/frame. Firmware uses 1-3 dx, 1-2 dy.
FOR i = 0 TO 4
  bw = 8
  gfx = ball8
  IF RAND() AND 1 THEN
    bw = 12
    gfx = ball12
  END IF

  bx = bw + RAND() MOD (128 - 2 * bw)
  by = bw + RAND() MOD (64 - 2 * bw)

  vx = 64 + RAND() MOD 192
  IF RAND() AND 1 THEN vx = 0 - vx
  vy = 64 + RAND() MOD 128
  IF RAND() AND 1 THEN vy = 0 - vy

  SPRITE i, gfx, bw, bw, bx, by, 0, vx, vy, EDGE_BOUNCE
NEXT

' -- Initialize stars (slots 5-31) -------------------------------------
' Stars scroll left at varying speeds and wrap around.
FOR i = 5 TO 31
  sx = RAND() MOD 128
  sy = RAND() MOD 64
  speed = 0 - (64 + RAND() MOD 192)
  SPRITE i, star_gfx, 1, 1, sx, sy, 0, speed, 0, EDGE_WRAP
NEXT

' ====================================================================
' Main loop — just draw the dither background each frame.
' Sprite engine handles all star and ball movement + drawing.
' ====================================================================
DO
  FOR y = 0 TO 62 STEP 2
    BLIT dither, 0, y, 128, 2
  NEXT
  YIELD
LOOP
