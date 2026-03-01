' Managed Sprites — collision groups, walls, bounce/wrap/destroy
' Two wall barriers; sprites with different collision groups.
'
' Sprite 0 (big circle 16x16): group=1, bounces off walls + edges
' Sprite 1 (diamond 8x8):      group=2, wraps at edges, no walls
' Sprite 2 (small diamond 4x4): group=1, mask=1 — stops at walls,
'                                bounces off circle, ignores diamond
' Sprite 3 (square 8x8):       group=1, detect-only + hit callback
'                                teleports to random position on collision
' Sprite 4 (tall bar 4x12):    group=2, destroys on wall contact

' --- Graphics data ---
DATA big_circle, $07,$E0,$1F,$F8,$3F,$FC,$7F,$FE,$7F,$FE,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$7F,$FE,$7F,$FE,$3F,$FC,$1F,$F8,$07,$E0
DATA diamond_gfx, $18,$3C,$7E,$FF,$FF,$7E,$3C,$18
DATA square_gfx, $FF,$81,$81,$81,$81,$81,$81,$FF
DATA sm_diamond, $60,$F0,$F0,$60
DATA tall_bar, $F0,$F0,$F0,$F0,$F0,$F0,$F0,$F0,$F0,$F0,$F0,$F0

' --- Hit callback: teleport square to random position ---
CALLBACK square_hit(slot)
  SPR_POS slot, RAND() MOD 112, RAND() MOD 48
END CALLBACK

' --- Walls ---
WALL_SET 0, 30, 0, 4, 64
WALL_SET 1, 94, 0, 4, 64

' --- Sprite 0: Big circle, bounce walls + edges, group 1 ---
SPRITE 0, big_circle, 16, 16, 50, 10, 0, 32, 48, EDGE_BOUNCE
SPR_WALL 0, COLL_BOUNCE
SPR_COLL 0, COLL_BOUNCE
SPR_GROUP 0, 1, $FF

' --- Sprite 1: Diamond, wraps at edges, group 2 ---
SPRITE 1, diamond_gfx, 8, 8, 60, 5, 0, 128, -64, EDGE_WRAP
SPR_COLL 1, COLL_BOUNCE
SPR_GROUP 1, 2, $FF

' --- Sprite 2: Small diamond, stops at walls, bounces off group 1 only ---
SPRITE 2, sm_diamond, 4, 4, 50, 5, 0, 96, 48, EDGE_BOUNCE
SPR_WALL 2, COLL_STOP
SPR_COLL 2, COLL_BOUNCE
SPR_GROUP 2, 1, 1

' --- Sprite 3: Square, detect-only + hit callback, group 1 ---
SPRITE 3, square_gfx, 8, 8, 60, 40, 0, -64, -64, EDGE_BOUNCE
SPR_COLL 3, COLL_DETECT
SPR_GROUP 3, 1, $FF
SPR_ON_HIT 3, square_hit

' --- Sprite 4: Tall bar, destroys on wall contact, group 2 ---
SPRITE 4, tall_bar, 4, 12, 40, 26, 0, 64, 0, EDGE_NONE
SPR_WALL 4, COLL_DESTROY
SPR_GROUP 4, 2, $FF

' --- Main loop: draw visible wall rectangles ---
DO
  RECT 30, 0, 4, 64
  RECT 94, 0, 4, 64
  YIELD
LOOP
