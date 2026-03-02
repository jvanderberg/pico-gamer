' -- Asteroids -------------------------------------------------------
' Ship rotates with encoder, thrusts with BTN, wraps at screen edges.
' Fire bullets with ENC_BTN; bullets destroy asteroids.
' Large->2 medium, medium->2 small, small->gone.

' -- Graphics DATA ---------------------------------------------------
' Ship vector data (triangle outline, 3 segments in 4.4 signed fixed-point)
DATA ship_vecs, 3, $00,$C0,$D0,$30, $D0,$30,$30,$30, $30,$30,$00,$C0

' Bullet bitmap (2x2 filled square)
DATA bullet_bmp, $C0, $C0

' Asteroid vector data
' Large (5 segments, ~15x15)
DATA ast_large, 5, $00,$90,$60,$E0, $60,$E0,$50,$50, $50,$50,$B0,$50, $B0,$50,$A0,$E0, $A0,$E0,$00,$90
' Medium (5 segments, ~9x9)
DATA ast_med, 5, $00,$C0,$40,$F0, $40,$F0,$30,$30, $30,$30,$D0,$30, $D0,$30,$C0,$F0, $C0,$F0,$00,$C0
' Small (4 segments, ~5x5)
DATA ast_small, 4, $00,$E0,$20,$00, $20,$00,$00,$20, $00,$20,$E0,$00, $E0,$00,$00,$E0

' Ship icon for lives HUD (5x5 row-aligned)
DATA ship_icon, $20, $50, $50, $88, $F8

' -- Array for asteroid sizes (slots 5-31 = 27 entries) ---------------
DIM sizes(27)

' ====================================================================
' Subroutines
' ====================================================================

SUB init_game()
  VOLUME 200
  ship_vx = 0
  ship_vy = 0
  cooldown = 0
  game_state = 0
  ast_count = 0
  invincible = 0
  next_bullet = 1
  lives = 3
  score = 0
  wave = 0
  was_thrust = 0

  ' Thrust sound: voice 0 = low rumble, voice 1 = high hiss
  ENVELOPE 0, 8, 0, 100, 20
  ENVELOPE 1, 5, 0, 50, 15

  SPRITE 0, ship_vecs, 9, 9, 60, 28, SPR_VECTOR, 0, 0, EDGE_WRAP
  SPR_GROUP 0, 1, 2
  SPR_COLL 0, COLL_DETECT

  ' Emitter 0: thrust exhaust (focused cone, short life)
  PFX_SET 0, 25, 8, 5, 0, 0, PFX_LIFE_VAR
  ' Emitter 1: asteroid/ship explosion (1x1, omnidirectional)
  PFX_SET 1, 50, 12, 128, 0, 0, PFX_SPEED_VAR OR PFX_LIFE_VAR

  FOR i = 0 TO 26
    sizes(i) = 0
  NEXT
  spawn_wave
END SUB

SUB check_collisions()
  ' Check if ship was hit by asteroid (skip if invincible)
  IF invincible = 0 THEN
    hit_result = SPR_HIT(0)
    IF hit_result AND 4 THEN
      ' Explosion at ship position
      hx, hy = SPR_GET(0)
      PFX_POS 1, hx + 4, hy + 4
      PFX_BURST 1, 20
      SFX SFX_DEATH
      ' Kill thrust sound
      NOTEOFF 0
      NOTEOFF 1
      was_thrust = 0

      lives = lives - 1
      IF lives = 0 THEN
        game_state = 1
      ELSE
        ' Respawn ship
        SPR_POS 0, 60, 28
        SPR_VEL 0, 0, 0
        ship_vx = 0
        ship_vy = 0
        SPR_ROT 0, 0, 0
        invincible = 240
      END IF
    END IF
  END IF

  ' Scan asteroid slots 5-31 for bullet hits
  FOR slot = 5 TO 31
    IF sizes(slot - 5) <> 0 THEN
      hit_result = SPR_HIT(slot)
      IF hit_result AND 4 THEN
        ' Verify collider is a bullet (slot 1-4)
        hit_index = hit_result SHR 8
        IF hit_index >= 1 THEN
          IF hit_index < 5 THEN
            ' Hit! Get position before destroying
            ax, ay = SPR_GET(slot)
            old_size = sizes(slot - 5)

            ' Explosion at asteroid position
            PFX_POS 1, ax, ay
            PFX_BURST 1, 12

            ' Clear size and destroy sprite
            sizes(slot - 5) = 0
            SPR_OFF slot
            ast_count = ast_count - 1

            ' Add score + sound by size
            IF old_size = 1 THEN
              score = score + 100
              SFX SFX_EXPLODE
            ELSEIF old_size = 2 THEN
              score = score + 50
              SFX SFX_HIT
            ELSE
              score = score + 25
              SFX SFX_BLIP
            END IF

            ' Split if not small (size < 3)
            IF old_size < 3 THEN
              spawn_child old_size + 1, ax - 3, ay
              spawn_child old_size + 1, ax + 3, ay
            END IF
          END IF
        END IF
      END IF
    END IF
  NEXT
END SUB

SUB spawn_child(sc_size, sc_x, sc_y)
  ' Find free slot 5-31
  FOR fslot = 5 TO 31
    IF sizes(fslot - 5) = 0 THEN
      ' Pick vector addr + bbox by size
      IF sc_size = 1 THEN
        sc_addr = ast_large
        sc_bbox = 15
      ELSEIF sc_size = 2 THEN
        sc_addr = ast_med
        sc_bbox = 9
      ELSE
        sc_addr = ast_small
        sc_bbox = 5
      END IF

      ' Random velocity -18..18
      rvx = (RAND() MOD 37) - 18
      rvy = (RAND() MOD 37) - 18

      SPRITE fslot, sc_addr, sc_bbox, sc_bbox, sc_x, sc_y, SPR_VECTOR, rvx, rvy, EDGE_WRAP
      SPR_GROUP fslot, 2, 4
      SPR_COLL fslot, COLL_DETECT

      ' Random angle + random rotSpeed
      rangle = RAND() AND 255
      rspeed = (RAND() MOD 81) - 40
      SPR_ROT fslot, rangle, rspeed

      sizes(fslot - 5) = sc_size
      ast_count = ast_count + 1
      EXIT FOR
    END IF
  NEXT
END SUB

SUB spawn_wave()
  wave = wave + 1
  IF wave > 1 THEN SFX SFX_POWERUP
  wcount = wave + 3
  IF wcount > 27 THEN wcount = 27

  FOR wi = 0 TO wcount - 1
    ' Random x: edge (5 or 110)
    IF RAND() MOD 2 = 0 THEN
      wx = 110
    ELSE
      wx = 5
    END IF

    spawn_child 1, wx, (RAND() MOD 50) + 5
  NEXT
END SUB

SUB draw_hud()
  ' Draw score at top-left
  TEXT_NUM score, 1, 1

  ' Draw lives icons at top-right
  FOR li = 0 TO lives - 1
    lx = 122 - li * 6
    BLIT ship_icon, lx, 1, 5, 5
  NEXT
END SUB

' -- Main program -----------------------------------------------------
DO
  init_game

  ' -- Game loop -------------------------------------------------------
  DO WHILE game_state = 0
    check_collisions

    ' Check if all asteroids destroyed -> next wave
    IF ast_count = 0 THEN spawn_wave

    ' -- Invincibility flash -------------------------------------------
    IF invincible > 0 THEN
      invincible = invincible - 1
      SPR_COLL 0, COLL_NONE

      ' Flash: hide ship when (timer AND 4) <> 0
      IF invincible AND 8 THEN
        SPR_VIS 0, 0
      ELSE
        SPR_VIS 0, 1
      END IF
    ELSE
      ' Ensure ship visible + collision on
      SPR_VIS 0, 1
      SPR_COLL 0, COLL_DETECT
    END IF

    inp = INPUT()

    ' -- Handle rotation (use signed encoder delta from INPUT high byte) --
    enc_delta = ASHR(inp, INPUT_ENC_DELTA_SHIFT)
    IF enc_delta <> 0 THEN
      angle = SPR_GETROT(0)
      angle = (angle + enc_delta * 9) AND 255
      SPR_ROT 0, angle, 0
    END IF

    ' -- Handle thrust (BTN) -------------------------------------------
    IF inp AND INPUT_BTN THEN
      thrust_angle = (SPR_GETROT(0) + 192) AND 255

      cos_val = COS(thrust_angle)
      IF cos_val >= 128 THEN cos_val = cos_val - 256
      ship_vx = ship_vx + FX_MUL(cos_val, 2, 5)

      sin_val = SIN(thrust_angle)
      IF sin_val >= 128 THEN sin_val = sin_val - 256
      ship_vy = ship_vy + FX_MUL(sin_val, 2, 5)

      ' Exhaust particles behind ship
      exhaust_dir = (thrust_angle + 128) AND 255
      PFX_SET 0, 25, 8, 5, exhaust_dir, 0, PFX_LIFE_VAR
      tx, ty = SPR_GET(0)
      ' Offset emitter 5px behind ship center using exhaust direction
      ex_cos = COS(exhaust_dir)
      IF ex_cos >= 128 THEN ex_cos = ex_cos - 256
      ex_sin = SIN(exhaust_dir)
      IF ex_sin >= 128 THEN ex_sin = ex_sin - 256
      PFX_POS 0, tx + 4 + FX_MUL(ex_cos, 5, 7), ty + 4 + FX_MUL(ex_sin, 5, 7)
      PFX_ON 0, 2

      ' Start thrust sound on transition
      IF was_thrust = 0 THEN
        was_thrust = 1
        VOICE 0, WAVE_NOISE, 150, 0
        VOICE 1, WAVE_NOISE, 5000, 0
      END IF
    ELSE
      PFX_ON 0, 0

      ' Release thrust sound on transition
      IF was_thrust = 1 THEN
        was_thrust = 0
        NOTEOFF 0
        NOTEOFF 1
      END IF
    END IF

    ' -- Handle fire (ENC_BTN) -----------------------------------------
    IF inp AND INPUT_ENC_BTN THEN
      IF cooldown = 0 THEN
        sx, sy = SPR_GET(0)
        sx = sx + 3
        sy = sy + 3

        thrust_angle = (SPR_GETROT(0) + 192) AND 255

        ' Bullet vx
        cos_val = COS(thrust_angle)
        IF cos_val < 128 THEN
          bvx = cos_val SHR 1
        ELSE
          bvx = -((256 - cos_val) SHR 1)
        END IF

        ' Bullet vy
        sin_val = SIN(thrust_angle)
        IF sin_val < 128 THEN
          bvy = sin_val SHR 1
        ELSE
          bvy = -((256 - sin_val) SHR 1)
        END IF

        bslot = next_bullet
        next_bullet = (next_bullet MOD 4) + 1

        SPRITE bslot, bullet_bmp, 2, 2, sx, sy, 0, bvx, bvy, EDGE_DESTROY
        SPR_GROUP bslot, 4, 2
        SPR_COLL bslot, COLL_DESTROY
        SFX SFX_LASER

        cooldown = 16
      END IF
    END IF

    ' -- Apply drag: velocity *= 250/256 --------------------------------
    ship_vx = FX_MUL(ship_vx, 253, 8)
    ship_vy = FX_MUL(ship_vy, 253, 8)

    ' -- Convert 8.8 velocity to sprite velocity (/4) -------------------
    SPR_VEL 0, ASHR(ship_vx, 2), ASHR(ship_vy, 2)

    ' -- Decrement fire cooldown ----------------------------------------
    IF cooldown > 0 THEN cooldown = cooldown - 1

    draw_hud
    YIELD
  LOOP

  ' -- Game over screen ------------------------------------------------
  NOTEOFF 0
  NOTEOFF 1
  FOR gs = 0 TO 31
    SPR_OFF gs
  NEXT
  PFX_CLEAR PFX_ALL

  DO
    TEXT_LG "GAME OVER", 37, 20
    TEXT_NUM score, 52, 35

    IF INPUT() AND INPUT_ENC_BTN THEN EXIT DO

    YIELD
  LOOP
LOOP
