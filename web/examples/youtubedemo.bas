  DATA ball, $BD, $7E, $FF, $FF, $FF, $FF, $7E, $BD
  DATA paddle, $F0, $F0, $F0, $70, $70, $30, $30, $30, $30, $30, $30, $70, $70, $F0, $F0, $F0

  ' When the ball hits the paddle, play a hit sound
  ' Different sounds for edge bounce vs paddle hit
  CALLBACK on_hit(slot)
    ' SPR_HIT returns what the sprite collided with:
    '   bit 0 (1) = screen edge
    '   bit 1 (2) = wall
    '   bit 2 (4) = another sprite
    h = SPR_HIT(slot)
    IF h AND 4 THEN
      SFX SFX_BOUNCE, 5
    ELSE
      SFX SFX_HIT, 5
    END IF
  END CALLBACK

  ' SPRITE slot, addr, width, height, x, y, flags, vx, vy, edge
  '   slot   = sprite index (0-31)
  '   addr   = DATA label for bitmap graphics
  '   width  = sprite width in pixels
  '   height = sprite height in pixels
  '   x, y   = starting position
  '   flags  = 0=normal, SPR_FLIPX, SPR_FLIPY, SPR_VECTOR
  '   vx, vy = velocity (64 = 1 pixel/frame)
  '   edge   = EDGE_NONE/WRAP/BOUNCE/DESTROY/STOP
  SPRITE 0, ball, 8, 8, 60, 28, 0, 80, 50, EDGE_BOUNCE
  ' Bounce off other sprites when colliding
  SPR_COLL 0, COLL_BOUNCE
  ' Put ball in group 1. It only checks for collisions with group 2 (the paddle).
  ' If we used mask $FF it would collide with everything — we only want the paddle.
  SPR_GROUP 0, 1, 2
  SPR_ON_HIT 0, on_hit

  SPRITE 1, paddle, 4, 16, 120, 24, 0, 0, 0, EDGE_STOP
  ' Paddle doesn't need a collision response — the ball does the bouncing.
  SPR_COLL 1, COLL_NONE
  ' Put paddle in group 2 so the ball's mask matches it.
  ' Mask=1 means the paddle "sees" group 1 (the ball) for hit detection,
  ' but COLL_NONE means it doesn't react — it just sits there.
  SPR_GROUP 1, 2, 1

  py = 24

  DO
    inp = INPUT()
    ' The encoder delta is packed into the upper 8 bits of INPUT().
    ' ASHR (arithmetic shift right) extracts it as a signed value:
    ' positive = clockwise, negative = counter-clockwise.
    ' In the web emulator, Q/E keys simulate encoder turns.
    enc = ASHR(inp, INPUT_ENC_DELTA_SHIFT)
    IF enc > 0 THEN py = py + 2
    IF enc < 0 THEN py = py - 2
    IF py < 0 THEN py = 0
    IF py > 48 THEN py = 48
    SPR_POS 1, 120, py
    YIELD
  LOOP
