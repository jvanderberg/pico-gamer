' -- Space Invaders --------------------------------------------------
' Faithful 1-bit reproduction of the 1978 classic.
' Encoder (J/L) to move, encoder button (K) to fire.

' -- Alien sprites (6 wide x 4 tall, 1 byte per row) ---------------
' Type A "Squid" (top row, 30 pts)
DATA squid1, $30, $78, $CC, $78
DATA squid2, $30, $78, $CC, $48

' Type B "Crab" (middle rows, 20 pts)
DATA crab1, $48, $FC, $B4, $48
DATA crab2, $48, $FC, $B4, $84

' Type C "Octopus" (bottom rows, 10 pts)
DATA octo1, $78, $FC, $B4, $FC
DATA octo2, $78, $FC, $B4, $48

' Player cannon (9 wide x 5 tall, 2 bytes per row)
DATA cannon, $08,$00, $1C,$00, $1C,$00, $FF,$80, $FF,$80

' UFO saucer (10 wide x 4 tall, 2 bytes per row)
DATA ufo_bmp, $1E,$00, $7F,$80, $DB,$00, $3C,$00

' Player bullet (1 wide x 3 tall)
DATA pbullet, $80, $80, $80

' Alien bullet "zigzag" frames
DATA abull1, $40, $80, $40, $80
DATA abull2, $80, $40, $80, $40

' Lives icon (small cannon, 5 wide x 3 tall)
DATA life_icon, $20, $70, $F8

' -- Arrays ----------------------------------------------------------
DIM aliens(55)

' Shield pixel data: 4 shields x 8 rows = 32 entries
' Each entry is a u16 bitmask (bit 10 = leftmost of 11 pixels)
DIM shield_rows(32)

' -- Constants -------------------------------------------------------
CONST ALIEN_ROWS = 5
CONST ALIEN_COLS = 11
CONST ALIEN_W = 6
CONST ALIEN_H = 4
CONST ALIEN_SPACING_X = 9
CONST ALIEN_SPACING_Y = 6
CONST PLAYER_Y = 56
CONST SHIELD_Y = 47
CONST SHIELD_W = 11
CONST SHIELD_H = 8
CONST UFO_Y = 9
CONST SCORE_Y = 1

' Shield shape constants (11 pixels wide, bit 10 = leftmost)
' ..#######.. = 508
' .#########. = 1022
' ########### = 2047
' ########### = 2047
' ########### = 2047
' ########### = 2047
' ####...#### = 1935
' ###.....### = 1799
CONST SH_R0 = 508
CONST SH_R1 = 1022
CONST SH_R2 = 2047
CONST SH_R3 = 2047
CONST SH_R4 = 2047
CONST SH_R5 = 2047
CONST SH_R6 = 1935
CONST SH_R7 = 1799

' -- State arrays for alien bullets ----------------------------------
DIM abull_active(3)
DIM abull_x(3)
DIM abull_y(3)
DIM abull_frame(3)
DIM abull_cx(3)

' -- Sound effects ---------------------------------------------------
' Player laser: low thump sweep
EFFECT inv_shoot
  STEP 0,   WAVE_PULSE, 400, 180, 220, 0
  STEP 20,  WAVE_PULSE, 250, 160, 180, 0
  STEP 45,  WAVE_PULSE, 150, 140, 120, 0
  STEP 80,  WAVE_PULSE, 80, 128, 60, 0
  STEP 120, OFF
END EFFECT

EFFECT inv_explode
  STEP 0,   WAVE_NOISE, 2000, 128, 255, 0
  STEP 40,  WAVE_NOISE, 1000, 128, 180, 0
  STEP 80,  WAVE_NOISE, 500, 128, 100, 0
  STEP 150, OFF
END EFFECT

' UFO high voice: eerie warbling saw
EFFECT inv_ufo_hi
  STEP 0,   WAVE_SAW, 0, 128, 90, 60
  STEP 80,  WAVE_SAW, 0, 128, 100, 180
  STEP 160, WAVE_SAW, 0, 128, 90, 60
  STEP 240, WAVE_SAW, 0, 128, 100, 180
  STEP 320, WAVE_SAW, 0, 128, 90, 60
  STEP 400, WAVE_SAW, 0, 128, 80, 180
  STEP 500, OFF
END EFFECT

' UFO low voice: deep modulating drone
EFFECT inv_ufo_lo
  STEP 0,   WAVE_TRI, 0, 128, 80, 40
  STEP 60,  WAVE_TRI, 0, 128, 100, 120
  STEP 120, WAVE_TRI, 0, 128, 80, 40
  STEP 180, WAVE_TRI, 0, 128, 100, 120
  STEP 240, WAVE_TRI, 0, 128, 80, 40
  STEP 300, WAVE_TRI, 0, 128, 100, 120
  STEP 360, WAVE_TRI, 0, 128, 80, 40
  STEP 420, WAVE_TRI, 0, 128, 100, 120
  STEP 500, OFF
END EFFECT

EFFECT inv_step
  STEP 0,   WAVE_PULSE, 0, 200, 120, 0
  STEP 40,  OFF
END EFFECT

EFFECT inv_death
  STEP 0,   WAVE_NOISE, 3000, 128, 255, 0
  STEP 50,  WAVE_NOISE, 1500, 128, 200, 0
  STEP 100, WAVE_NOISE, 800, 128, 140, 0
  STEP 200, WAVE_NOISE, 400, 128, 60, 0
  STEP 300, OFF
END EFFECT

' ====================================================================
' Subroutines
' ====================================================================

SUB init_game()
  VOLUME 200

  ' Voice 5: player laser — no filter, raw pulse wave

  ' Voice 3: UFO high — bandpass for alien warble
  VFILTER 3, 100, 80, FILTER_BP

  ' Voice 1: UFO low — lowpass for deep rumble
  VFILTER 1, 120, 30, FILTER_LP
  VDRIVE 3, 40
  score = 0
  lives = 3
  level = 0
  game_over = 0
  player_x = 60
  bullet_active = 0
  ufo_active = 0
  ufo_timer = 0
  ufo_dir = 1
  fire_cooldown = 0
  dying = 0
  die_timer = 0
  ufo_score_timer = 0

  ' Particle emitter 0: alien explosion (tight pop)
  PFX_SET 0, 30, 10, 128, 0, 1, PFX_SPEED_VAR OR PFX_LIFE_VAR
  ' Particle emitter 1: player death (slightly bigger)
  PFX_SET 1, 40, 16, 128, 0, 2, PFX_SPEED_VAR OR PFX_LIFE_VAR

  FOR i = 0 TO 2
    abull_active(i) = 0
  NEXT

  ' Initialize shield pixel data (4 shields, 8 rows each)
  FOR s = 0 TO 3
    base = s * 8
    shield_rows(base) = SH_R0
    shield_rows(base + 1) = SH_R1
    shield_rows(base + 2) = SH_R2
    shield_rows(base + 3) = SH_R3
    shield_rows(base + 4) = SH_R4
    shield_rows(base + 5) = SH_R5
    shield_rows(base + 6) = SH_R6
    shield_rows(base + 7) = SH_R7
  NEXT

  init_aliens
END SUB

SUB init_aliens()
  FOR i = 0 TO 54
    aliens(i) = 1
  NEXT
  alien_count = 55
  grid_x = 8
  grid_y = 8
  grid_dir = 1
  anim_frame = 0
  move_timer = 0
  move_delay = 40 - level * 3
  IF move_delay < 10 THEN move_delay = 10
  step_note = 0
END SUB

SUB draw_aliens()
  FOR row = 0 TO ALIEN_ROWS - 1
    FOR col = 0 TO ALIEN_COLS - 1
      idx = row * ALIEN_COLS + col
      IF aliens(idx) = 1 THEN
        ax = grid_x + col * ALIEN_SPACING_X
        ay = grid_y + row * ALIEN_SPACING_Y

        IF row = 0 THEN
          IF anim_frame = 0 THEN
            BLIT squid1, ax, ay, ALIEN_W, ALIEN_H
          ELSE
            BLIT squid2, ax, ay, ALIEN_W, ALIEN_H
          END IF
        ELSEIF row <= 2 THEN
          IF anim_frame = 0 THEN
            BLIT crab1, ax, ay, ALIEN_W, ALIEN_H
          ELSE
            BLIT crab2, ax, ay, ALIEN_W, ALIEN_H
          END IF
        ELSE
          IF anim_frame = 0 THEN
            BLIT octo1, ax, ay, ALIEN_W, ALIEN_H
          ELSE
            BLIT octo2, ax, ay, ALIEN_W, ALIEN_H
          END IF
        END IF
      END IF
    NEXT
  NEXT
END SUB

SUB move_aliens()
  move_timer = move_timer + 1
  IF move_timer >= move_delay THEN
  move_timer = 0

  IF anim_frame = 0 THEN
    anim_frame = 1
  ELSE
    anim_frame = 0
  END IF

  ' March sound
  IF step_note = 0 THEN
    NOTE inv_step, 4, A3
  ELSEIF step_note = 1 THEN
    NOTE inv_step, 4, G3
  ELSEIF step_note = 2 THEN
    NOTE inv_step, 4, F3
  ELSE
    NOTE inv_step, 4, E3
  END IF
  step_note = (step_note + 1) AND 3

  ' Find extents of living aliens
  left_col = 11
  right_col = 0
  bottom_row = 0
  FOR row = 0 TO ALIEN_ROWS - 1
    FOR col = 0 TO ALIEN_COLS - 1
      IF aliens(row * ALIEN_COLS + col) = 1 THEN
        IF col < left_col THEN left_col = col
        IF col > right_col THEN right_col = col
        IF row > bottom_row THEN bottom_row = row
      END IF
    NEXT
  NEXT

  ' Drop and reverse at edges
  drop = 0
  IF grid_dir = 1 THEN
    right_edge = grid_x + right_col * ALIEN_SPACING_X + ALIEN_W
    IF right_edge >= 126 THEN drop = 1
  ELSE
    left_edge = grid_x + left_col * ALIEN_SPACING_X
    IF left_edge <= 2 THEN drop = 1
  END IF

  IF drop = 1 THEN
    grid_y = grid_y + 2
    IF grid_dir = 1 THEN
      grid_dir = 65535
    ELSE
      grid_dir = 1
    END IF
  ELSE
    grid_x = grid_x + grid_dir
  END IF

  ' Speed up as aliens die (gradual ramp)
  IF alien_count > 45 THEN
    move_delay = 40 - level * 3
  ELSEIF alien_count > 35 THEN
    move_delay = 36 - level * 2
  ELSEIF alien_count > 25 THEN
    move_delay = 30 - level * 2
  ELSEIF alien_count > 15 THEN
    move_delay = 22 - level
  ELSEIF alien_count > 8 THEN
    move_delay = 15 - level
  ELSEIF alien_count > 3 THEN
    move_delay = 10
  ELSE
    move_delay = 5
  END IF
  IF move_delay < 3 THEN move_delay = 3

  ' Aliens reached shields = game over
  lowest_y = grid_y + bottom_row * ALIEN_SPACING_Y + ALIEN_H
  IF lowest_y >= SHIELD_Y THEN
    game_over = 1
  END IF

  END IF
END SUB

SUB fire_alien_bullet()
  free_slot = 255
  FOR i = 0 TO 2
    IF abull_active(i) = 0 THEN
      free_slot = i
      EXIT FOR
    END IF
  NEXT

  IF free_slot <> 255 THEN
    tries = 0
    found_row = 255
    DO
      rcol = RAND() MOD ALIEN_COLS
      found_row = 255
      ' Scan bottom to top (forward loop, reverse index)
      FOR ri = 0 TO ALIEN_ROWS - 1
        check_row = 4 - ri
        IF aliens(check_row * ALIEN_COLS + rcol) = 1 THEN
          found_row = check_row
          EXIT FOR
        END IF
      NEXT
      tries = tries + 1
      IF tries > 20 THEN found_row = 254
    LOOP WHILE found_row = 255

    IF found_row < 254 THEN
      abull_active(free_slot) = 1
      abull_cx(free_slot) = grid_x + rcol * ALIEN_SPACING_X + 2
      abull_x(free_slot) = abull_cx(free_slot)
      abull_y(free_slot) = grid_y + found_row * ALIEN_SPACING_Y + ALIEN_H
      abull_frame(free_slot) = 0
    END IF
  END IF
END SUB

' Erode shield pixels around an impact point
SUB damage_shield(ds, dlx, dly)
  ' Clear a 3-wide cross pattern at the impact
  ' Center pixel
  IF dly >= 0 THEN
    IF dly < SHIELD_H THEN
      IF dlx >= 0 THEN
        IF dlx < SHIELD_W THEN
          bit = 10 - dlx
          mask = 2047 XOR (1 SHL bit)
          shield_rows(ds * 8 + dly) = shield_rows(ds * 8 + dly) AND mask
        END IF
      END IF
    END IF
  END IF
  ' Left
  nlx = dlx - 1
  IF dly >= 0 THEN
    IF dly < SHIELD_H THEN
      IF nlx >= 0 THEN
        IF nlx < SHIELD_W THEN
          bit = 10 - nlx
          mask = 2047 XOR (1 SHL bit)
          shield_rows(ds * 8 + dly) = shield_rows(ds * 8 + dly) AND mask
        END IF
      END IF
    END IF
  END IF
  ' Right
  nrx = dlx + 1
  IF dly >= 0 THEN
    IF dly < SHIELD_H THEN
      IF nrx >= 0 THEN
        IF nrx < SHIELD_W THEN
          bit = 10 - nrx
          mask = 2047 XOR (1 SHL bit)
          shield_rows(ds * 8 + dly) = shield_rows(ds * 8 + dly) AND mask
        END IF
      END IF
    END IF
  END IF
  ' Up
  nuy = dly - 1
  IF nuy >= 0 THEN
    IF nuy < SHIELD_H THEN
      IF dlx >= 0 THEN
        IF dlx < SHIELD_W THEN
          bit = 10 - dlx
          mask = 2047 XOR (1 SHL bit)
          shield_rows(ds * 8 + nuy) = shield_rows(ds * 8 + nuy) AND mask
        END IF
      END IF
    END IF
  END IF
  ' Down
  ndy = dly + 1
  IF ndy >= 0 THEN
    IF ndy < SHIELD_H THEN
      IF dlx >= 0 THEN
        IF dlx < SHIELD_W THEN
          bit = 10 - dlx
          mask = 2047 XOR (1 SHL bit)
          shield_rows(ds * 8 + ndy) = shield_rows(ds * 8 + ndy) AND mask
        END IF
      END IF
    END IF
  END IF
END SUB

' Check if a bullet at (bx, by) hits any shield. Returns 1 if hit.
SUB check_shield_hit(bx, by)
  sh_hit = 0
  FOR s = 0 TO 3
    IF sh_hit = 0 THEN
      sx = 8 + s * 30
      IF bx >= sx THEN
        IF bx < sx + SHIELD_W THEN
          IF by >= SHIELD_Y THEN
            IF by < SHIELD_Y + SHIELD_H THEN
              ' Local coords within shield
              lx = bx - sx
              ly = by - SHIELD_Y
              bit = 10 - lx
              IF shield_rows(s * 8 + ly) AND (1 SHL bit) THEN
                ' Pixel is set — hit!
                damage_shield s, lx, ly
                sh_hit = 1
                sh_hit_idx = s
              END IF
            END IF
          END IF
        END IF
      END IF
    END IF
  NEXT
END SUB

SUB update_alien_bullets()
  FOR i = 0 TO 2
    IF abull_active(i) = 1 THEN
      ' Advance phase (0-7 cycle)
      abull_frame(i) = (abull_frame(i) + 1) AND 7
      ' Drop every other frame (half speed)
      IF abull_frame(i) AND 1 THEN
        abull_y(i) = abull_y(i) + 1
      END IF
      ' Corkscrew: wobble x by phase (0,1,0,-1 pattern over 8 steps)
      phase = abull_frame(i) SHR 1
      IF phase = 0 THEN
        abull_x(i) = abull_cx(i)
      ELSEIF phase = 1 THEN
        abull_x(i) = abull_cx(i) + 1
      ELSEIF phase = 2 THEN
        abull_x(i) = abull_cx(i)
      ELSE
        abull_x(i) = abull_cx(i) - 1
      END IF

      ' Off screen?
      IF abull_y(i) > 63 THEN
        abull_active(i) = 0
      END IF

      ' Hit player?
      IF dying = 0 THEN
        IF abull_active(i) = 1 THEN
          IF abull_y(i) >= PLAYER_Y THEN
            IF abull_y(i) <= PLAYER_Y + 4 THEN
              IF abull_x(i) >= player_x THEN
                IF abull_x(i) <= player_x + 8 THEN
                  abull_active(i) = 0
                  player_hit
                END IF
              END IF
            END IF
          END IF
        END IF
      END IF

      ' Hit shield?
      IF abull_active(i) = 1 THEN
        check_shield_hit abull_x(i), abull_y(i)
        IF sh_hit = 1 THEN
          abull_active(i) = 0
        END IF
      END IF
    END IF
  NEXT
END SUB

SUB draw_alien_bullets()
  FOR i = 0 TO 2
    IF abull_active(i) = 1 THEN
      IF abull_frame(i) < 4 THEN
        BLIT abull1, abull_x(i), abull_y(i), 2, 4
      ELSE
        BLIT abull2, abull_x(i), abull_y(i), 2, 4
      END IF
    END IF
  NEXT
END SUB

SUB player_hit()
  dying = 1
  die_timer = 60
  NOTE inv_death, 2, C3
  PFX_POS 1, player_x + 4, PLAYER_Y + 2
  PFX_BURST 1, 18
END SUB

SUB update_player_bullet()
  IF bullet_active = 1 THEN
    bullet_y = bullet_y - 2
    bull_hit = 0

    ' Off screen?
    IF bullet_y < 2 THEN
      bullet_active = 0
      bull_hit = 1
    END IF

    ' Hit aliens
    IF bull_hit = 0 THEN
      FOR row = 0 TO ALIEN_ROWS - 1
        FOR col = 0 TO ALIEN_COLS - 1
          IF bull_hit = 0 THEN
            idx = row * ALIEN_COLS + col
            IF aliens(idx) = 1 THEN
              ax = grid_x + col * ALIEN_SPACING_X
              ay = grid_y + row * ALIEN_SPACING_Y

              IF bullet_x >= ax THEN
                IF bullet_x <= ax + ALIEN_W THEN
                  IF bullet_y >= ay THEN
                    IF bullet_y <= ay + ALIEN_H THEN
                      aliens(idx) = 0
                      alien_count = alien_count - 1
                      bullet_active = 0
                      bull_hit = 1

                      IF row = 0 THEN
                        score = score + 30
                      ELSEIF row <= 2 THEN
                        score = score + 20
                      ELSE
                        score = score + 10
                      END IF

                      NOTE inv_explode, 2, C4
                      PFX_POS 0, ax + 3, ay + 2
                      PFX_BURST 0, 14
                    END IF
                  END IF
                END IF
              END IF
            END IF
          END IF
        NEXT
      NEXT
    END IF

    ' Hit shields (pixel-perfect)
    IF bull_hit = 0 THEN
      check_shield_hit bullet_x, bullet_y
      IF sh_hit = 1 THEN
        bullet_active = 0
        bull_hit = 1
      END IF
    END IF

    ' Hit UFO
    IF bull_hit = 0 THEN
      IF ufo_active = 1 THEN
        IF bullet_x >= ufo_x THEN
          IF bullet_x <= ufo_x + 9 THEN
            IF bullet_y >= UFO_Y THEN
              IF bullet_y <= UFO_Y + 3 THEN
                bullet_active = 0
                ufo_active = 0
                score = score + 100
                ufo_score_x = ufo_x
                ufo_score_timer = 40
                SFX SFX_COIN, 2
              END IF
            END IF
          END IF
        END IF
      END IF
    END IF
  END IF
END SUB

SUB update_ufo()
  IF ufo_active = 0 THEN
    ufo_timer = ufo_timer + 1
    IF ufo_timer > 600 THEN
      ufo_active = 1
      ufo_timer = 0
      IF RAND() MOD 2 = 0 THEN
        ufo_x = 0
        ufo_dir = 1
      ELSE
        ufo_x = 120
        ufo_dir = 65535
      END IF
      NOTE inv_ufo_hi, 3, AS4, 320, 12
      NOTE inv_ufo_lo, 1, AS2, 160, 6
    END IF
  ELSE
    ufo_x = ufo_x + ufo_dir
    IF ufo_x > 130 THEN
      ufo_active = 0
    END IF
    IF ufo_x < 65530 THEN
      ufo_active = 0
    END IF
  END IF
END SUB

SUB draw_shields()
  FOR s = 0 TO 3
    sx = 8 + s * 30
    base = s * 8
    FOR r = 0 TO SHIELD_H - 1
      row_bits = shield_rows(base + r)
      IF row_bits <> 0 THEN
        FOR c = 0 TO SHIELD_W - 1
          bit = 10 - c
          IF row_bits AND (1 SHL bit) THEN
            PIXEL sx + c, SHIELD_Y + r, 1
          END IF
        NEXT
      END IF
    NEXT
  NEXT
END SUB

SUB draw_hud()
  TEXT_SM "SCORE", 1, SCORE_Y
  TEXT_NUM score, 30, SCORE_Y
  TEXT_SM "HI", 68, SCORE_Y
  TEXT_NUM hi_score, 80, SCORE_Y

  ' Lives at bottom
  TEXT_NUM lives, 1, 60
  FOR li = 0 TO lives - 2
    BLIT life_icon, 10 + li * 7, 60, 5, 3
  NEXT

  ' Bottom separator
  LINE 0, 58, 127, 58

  ' UFO score popup
  IF ufo_score_timer > 0 THEN
    TEXT_NUM 100, ufo_score_x, UFO_Y
    ufo_score_timer = ufo_score_timer - 1
  END IF
END SUB

SUB draw_player()
  IF dying = 0 THEN
    BLIT cannon, player_x, PLAYER_Y, 9, 5
  END IF
  ' When dying, the cannon disappears and particles handle the explosion
END SUB

' ====================================================================
' Main Program
' ====================================================================
hi_score = 0

DO
  init_game
  fire_timer = 0
  shoot_delay = 90

  ' -- Game loop -----------------------------------------------------
  DO WHILE game_over = 0
    inp = INPUT()

    IF dying = 0 THEN
      ' Move with encoder
      enc_delta = ASHR(inp, INPUT_ENC_DELTA_SHIFT)
      IF enc_delta <> 0 THEN
        player_x = player_x + enc_delta * 2
        IF player_x < 1 THEN player_x = 1
        IF player_x > 118 THEN player_x = 118
      END IF

      ' Fire
      IF inp AND INPUT_ENC_BTN THEN
        IF bullet_active = 0 THEN
          IF fire_cooldown = 0 THEN
            bullet_active = 1
            bullet_x = player_x + 4
            bullet_y = PLAYER_Y - 2
            NOTE inv_shoot, 5, C5
            fire_cooldown = 15
          END IF
        END IF
      END IF
    ELSE
      die_timer = die_timer - 1
      IF die_timer = 0 THEN
        dying = 0
        lives = lives - 1
        IF lives = 0 THEN
          game_over = 1
        ELSE
          player_x = 60
        END IF
      END IF
    END IF

    IF fire_cooldown > 0 THEN fire_cooldown = fire_cooldown - 1

    update_player_bullet
    move_aliens
    update_alien_bullets
    update_ufo

    ' Alien firing (less aggressive)
    fire_timer = fire_timer + 1
    IF fire_timer >= shoot_delay THEN
      fire_timer = 0
      fire_alien_bullet
      IF alien_count > 30 THEN
        shoot_delay = 90 - level * 5
      ELSEIF alien_count > 15 THEN
        shoot_delay = 60 - level * 3
      ELSE
        shoot_delay = 40 - level * 2
      END IF
      IF shoot_delay < 25 THEN shoot_delay = 25
    END IF

    IF alien_count = 0 THEN
      level = level + 1
      init_aliens
    END IF

    ' -- Draw -------------------------------------------------------
    draw_hud
    draw_shields
    draw_aliens

    draw_player
    draw_alien_bullets

    IF bullet_active = 1 THEN
      BLIT pbullet, bullet_x, bullet_y, 1, 3
    END IF

    IF ufo_active = 1 THEN
      BLIT ufo_bmp, ufo_x, UFO_Y, 10, 4
    END IF

    YIELD
  LOOP

  ' -- Game over ----------------------------------------------------
  IF score > hi_score THEN hi_score = score

  DO
    draw_hud
    TEXT_LG "GAME OVER", 28, 24
    TEXT_SM "FIRE TO PLAY", 30, 40

    IF INPUT() AND INPUT_ENC_BTN THEN EXIT DO
    YIELD
  LOOP
LOOP
