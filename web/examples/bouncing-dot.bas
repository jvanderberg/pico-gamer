' Bouncing dot in BASIC
' A single 1x1 pixel sprite with bounce edge mode

DATA dot_gfx, $80

SPRITE 0, dot_gfx, 1, 1, 10, 5, 0, 64, 64, EDGE_BOUNCE

DO
  YIELD
LOOP
