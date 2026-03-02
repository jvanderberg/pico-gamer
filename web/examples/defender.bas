' -- Defender ----------------------------------------------------------
' Horizontal scroller. Protect humanoids from landers.
' Joystick: move (with momentum). BTN/ENC_BTN: fire.
' World is 512px wide and wraps. Ship moves on screen; camera
' scrolls when ship reaches the deadzone edges.

' Slots: 0=ship, 1-4=bullets, 5-12=aliens, 13-17=humans

' -- Graphics ----------------------------------------------------------
DATA ship_gfx, $20, $F8, $FE, $F8, $20
DATA bullet_gfx, $C0, $C0
DATA lander_gfx, $24, $18, $7E, $DB, $FF, $7E, $24
DATA human_gfx, $60, $60, $F0, $60, $F0

' -- Arrays ------------------------------------------------------------
CONST MAX_ALIENS = 8
CONST MAX_HUMANS = 5
DIM awx(8) : DIM awy(8) : DIM ast(8)
DIM avx(8) : DIM avy(8) : DIM acr(8)
DIM hwx(5) : DIM hwy(5) : DIM hst(5)

CONST WORLD_W = 512
CONST GROUND_Y = 55
CONST ALIEN0 = 5
CONST HUMAN0 = 13

' =====================================================================
SUB init_game()
  score = 0 : lives = 3 : game_state = 0
  cooldown = 0 : invincible = 0
  next_bullet = 1 : spawn_timer = 0 : wave = 0
  ship_wx = 256 : ship_wy = 28 : facing = 0
  ship_spd = 0 : ship_sx = 60 : alien_tick = 0
  humans_left = MAX_HUMANS : aliens_alive = 0

  SPRITE 0, ship_gfx, 8, 5, 60, 28, 0, 0, 0, EDGE_NONE
  SPR_GROUP 0, 1, 2 : SPR_COLL 0, COLL_DETECT

  PFX_SET 0, 60, 15, 128, 0, 1, PFX_SPEED_VAR OR PFX_LIFE_VAR

  FOR i = 0 TO MAX_ALIENS - 1
    ast(i) = 0
  NEXT

  FOR i = 0 TO MAX_HUMANS - 1
    hst(i) = 1
    hwx(i) = 180 + i * 40
    hwy(i) = GROUND_Y
    SPRITE HUMAN0 + i, human_gfx, 4, 5, 250, 250, 0, 0, 0, EDGE_NONE
    SPR_GROUP HUMAN0 + i, 8, 0
    SPR_VIS HUMAN0 + i, 0
  NEXT

  spawn_wave
END SUB

SUB spawn_wave()
  wave = wave + 1
  wc = wave + 2
  IF wc > MAX_ALIENS THEN wc = MAX_ALIENS
  FOR wi = 0 TO wc - 1
    spawn_alien
  NEXT
END SUB

SUB spawn_alien()
  FOR fa = 0 TO MAX_ALIENS - 1
    IF ast(fa) = 0 THEN
      ast(fa) = 1 : acr(fa) = 255
      awx(fa) = (ship_wx + 200 + RAND() MOD 120) AND 511
      awy(fa) = 4 + RAND() MOD 40
      avx(fa) = 0 : avy(fa) = 0
      SPRITE ALIEN0 + fa, lander_gfx, 8, 7, 250, 250, 0, 0, 0, EDGE_NONE
      SPR_GROUP ALIEN0 + fa, 2, 5
      SPR_COLL ALIEN0 + fa, COLL_NONE
      SPR_VIS ALIEN0 + fa, 0
      aliens_alive = aliens_alive + 1
      EXIT FOR
    END IF
  NEXT
END SUB

SUB update_aliens()
  FOR i = 0 TO MAX_ALIENS - 1
    IF ast(i) <> 0 THEN
      IF ast(i) = 1 THEN
        best_d = 9999 : best_h = 255
        FOR h = 0 TO MAX_HUMANS - 1
          IF hst(h) = 1 THEN
            ddx = (hwx(h) + WORLD_W - awx(i)) AND 511
            IF ddx > 256 THEN ddx = WORLD_W - ddx
            ddy = ABS(GROUND_Y - awy(i))
            dist = ddx + ddy
            IF dist < best_d THEN
              best_d = dist : best_h = h
            END IF
          END IF
        NEXT

        IF best_h < 255 THEN
          ddx = (hwx(best_h) + WORLD_W - awx(i)) AND 511
          IF ddx > 0 THEN
            IF ddx < 256 THEN avx(i) = 1 ELSE avx(i) = -1
          END IF
          IF awy(i) < GROUND_Y THEN
            avy(i) = 1
          ELSEIF awy(i) > GROUND_Y THEN
            avy(i) = -1
          ELSE
            avy(i) = 0
          END IF
          grab_dx = ddx
          IF grab_dx > 256 THEN grab_dx = WORLD_W - grab_dx
          IF grab_dx < 6 THEN
            IF awy(i) >= GROUND_Y - 2 THEN
              ast(i) = 2 : acr(i) = best_h
              hst(best_h) = 2
              avy(i) = -1 : avx(i) = 0
            END IF
          END IF
        ELSE
          ddx = (ship_wx + WORLD_W - awx(i)) AND 511
          IF ddx < 256 THEN avx(i) = 1 ELSE avx(i) = -1
          IF awy(i) < ship_wy THEN avy(i) = 1 ELSE avy(i) = -1
        END IF
      END IF

      IF ast(i) = 2 THEN
        avy(i) = -1 : avx(i) = 0
        h = acr(i)
        IF h < MAX_HUMANS THEN
          hwx(h) = awx(i)
          hwy(h) = awy(i) + 7
        END IF
        IF awy(i) < 3 THEN
          IF h < MAX_HUMANS THEN
            hst(h) = 0
            SPR_VIS HUMAN0 + h, 0
            humans_left = humans_left - 1
          END IF
          ast(i) = 1 : acr(i) = 255 : awy(i) = 4
        END IF
      END IF

      ' Move aliens at half speed (every other frame)
      IF alien_tick = 0 THEN
        awx(i) = (awx(i) + avx(i) + WORLD_W) AND 511
        nwy = awy(i) + avy(i)
        IF nwy < 2 THEN nwy = 2
        IF nwy > GROUND_Y THEN nwy = GROUND_Y
        awy(i) = nwy
      END IF
    END IF
  NEXT
END SUB

SUB update_humans()
  FOR i = 0 TO MAX_HUMANS - 1
    IF hst(i) = 3 THEN
      hwy(i) = hwy(i) + 2
      IF hwy(i) >= GROUND_Y THEN
        hwy(i) = GROUND_Y : hst(i) = 1
      END IF
    END IF
  NEXT
END SUB

SUB position_sprites()
  cam_x = (ship_wx + WORLD_W - ship_sx) AND 511

  FOR i = 0 TO MAX_ALIENS - 1
    IF ast(i) = 0 THEN
      SPR_COLL ALIEN0 + i, COLL_NONE
      SPR_POS ALIEN0 + i, 250, 250
      SPR_VIS ALIEN0 + i, 0
    ELSE
      dx = (awx(i) + WORLD_W - cam_x) AND 511
      IF dx < 136 THEN
        SPR_POS ALIEN0 + i, dx, awy(i)
        SPR_COLL ALIEN0 + i, COLL_DETECT
        SPR_VIS ALIEN0 + i, 1
      ELSE
        SPR_COLL ALIEN0 + i, COLL_NONE
        SPR_POS ALIEN0 + i, 250, 250
        SPR_VIS ALIEN0 + i, 0
      END IF
    END IF
  NEXT

  FOR i = 0 TO MAX_HUMANS - 1
    IF hst(i) = 0 THEN
      SPR_POS HUMAN0 + i, 250, 250
      SPR_VIS HUMAN0 + i, 0
    ELSE
      dx = (hwx(i) + WORLD_W - cam_x) AND 511
      hy = hwy(i) - 5
      IF hst(i) = 2 THEN hy = hwy(i)
      IF dx < 136 THEN
        SPR_POS HUMAN0 + i, dx, hy
        SPR_VIS HUMAN0 + i, 1
      ELSE
        SPR_POS HUMAN0 + i, 250, 250
        SPR_VIS HUMAN0 + i, 0
      END IF
    END IF
  NEXT

  SPR_POS 0, ship_sx, ship_wy
END SUB

SUB check_collisions()
  IF invincible = 0 THEN
    sh = SPR_HIT(0)
    IF sh AND 4 THEN
      hitter = sh SHR 8
      IF hitter >= ALIEN0 THEN
        ai = hitter - ALIEN0
        IF ai < MAX_ALIENS THEN
          PFX_POS 0, ship_sx + 4, ship_wy + 2
          PFX_BURST 0, 25
          SFX SFX_DEATH, 5
          IF ast(ai) = 2 THEN
            h = acr(ai)
            IF h < MAX_HUMANS THEN hst(h) = 3
          END IF
          ast(ai) = 0 : SPR_OFF hitter
          aliens_alive = aliens_alive - 1
          lives = lives - 1
          IF lives = 0 THEN
            game_state = 1
          ELSE
            ship_wx = 256 : ship_wy = 28
            ship_spd = 0 : ship_sx = 60
            invincible = 180
          END IF
        END IF
      END IF
    END IF
  END IF

  FOR i = 0 TO MAX_ALIENS - 1
    IF ast(i) <> 0 THEN
      ah = SPR_HIT(ALIEN0 + i)
      IF ah AND 4 THEN
        hitter = ah SHR 8
        IF hitter >= 1 THEN
          IF hitter <= 4 THEN
            ex, ey = SPR_GET(ALIEN0 + i)
            PFX_POS 0, ex + 4, ey + 3
            PFX_BURST 0, 15
            SFX SFX_EXPLODE, 5
            IF ast(i) = 2 THEN
              h = acr(i)
              IF h < MAX_HUMANS THEN hst(h) = 3
            END IF
            ast(i) = 0 : SPR_OFF ALIEN0 + i : SPR_OFF hitter
            aliens_alive = aliens_alive - 1
            score = score + 100
          END IF
        END IF
      END IF
    END IF
  NEXT
END SUB

SUB fire_bullet()
  IF cooldown = 0 THEN
    bslot = next_bullet
    next_bullet = next_bullet + 1
    IF next_bullet > 4 THEN next_bullet = 1
    IF facing = 0 THEN
      bvx = 256 : bx = ship_sx + 8
    ELSE
      bvx = -256 : bx = ship_sx - 2
    END IF
    SPRITE bslot, bullet_gfx, 2, 2, bx, ship_wy + 1, 0, bvx, 0, EDGE_DESTROY
    SPR_GROUP bslot, 4, 2
    SPR_COLL bslot, COLL_DESTROY
    SFX SFX_LASER, 3
    cooldown = 8
  END IF
END SUB

SUB draw_hud()
  TEXT_NUM score, 1, 1
  FOR li = 0 TO lives - 1
    BLIT ship_gfx, 120 - li * 9, 1, 8, 5
  NEXT
  LINE GROUND_Y, 0, GROUND_Y, 127

  ' Radar (y=8, x=30..98)
  LINE 8, 30, 8, 98
  rsx = 30 + (ship_wx * 68) DIV WORLD_W
  RECT rsx, 7, 2, 3
  FOR i = 0 TO MAX_ALIENS - 1
    IF ast(i) <> 0 THEN
      PIXEL 30 + (awx(i) * 68) DIV WORLD_W, 8, 1
    END IF
  NEXT
  FOR i = 0 TO MAX_HUMANS - 1
    IF hst(i) <> 0 THEN
      PIXEL 30 + (hwx(i) * 68) DIV WORLD_W, 9, 1
    END IF
  NEXT
END SUB

' -- Main program ------------------------------------------------------
DO
  init_game

  DO WHILE game_state = 0
    check_collisions

    inp = INPUT()

    ' Horizontal momentum
    old_facing = facing
    IF inp AND INPUT_RIGHT THEN
      IF ship_spd < 5 THEN ship_spd = ship_spd + 1
      facing = 0
    ELSEIF inp AND INPUT_LEFT THEN
      IF ship_spd > -5 THEN ship_spd = ship_spd - 1
      facing = 1
    ELSE
      IF ship_spd > 0 THEN ship_spd = ship_spd - 1
      IF ship_spd < 0 THEN ship_spd = ship_spd + 1
    END IF

    ' Apply speed to ship screen position
    IF ship_spd > 0 THEN ship_sx = ship_sx + ship_spd
    IF ship_spd < 0 THEN
      sub_spd = 0 - ship_spd
      IF ship_sx >= sub_spd THEN
        ship_sx = ship_sx - sub_spd
      ELSE
        ship_sx = 0
      END IF
    END IF

    ' Deadzone camera: scroll world when ship reaches edges
    IF ship_sx > 100 THEN
      scroll = ship_sx - 100
      ship_wx = (ship_wx + scroll) AND 511
      ship_sx = 100
    END IF
    IF ship_sx < 20 THEN
      scroll = 20 - ship_sx
      ship_wx = (ship_wx + WORLD_W - scroll) AND 511
      ship_sx = 20
    END IF

    ' Vertical movement
    IF inp AND INPUT_UP THEN
      IF ship_wy > 12 THEN ship_wy = ship_wy - 2
    END IF
    IF inp AND INPUT_DOWN THEN
      IF ship_wy < GROUND_Y - 7 THEN ship_wy = ship_wy + 2
    END IF

    ' Flip ship sprite when direction changes
    IF facing <> old_facing THEN
      IF facing = 0 THEN
        SPRITE 0, ship_gfx, 8, 5, ship_sx, ship_wy, 0, 0, 0, EDGE_NONE
      ELSE
        SPRITE 0, ship_gfx, 8, 5, ship_sx, ship_wy, SPR_FLIPX, 0, 0, EDGE_NONE
      END IF
      SPR_GROUP 0, 1, 2
    END IF

    ' Fire (both buttons)
    IF inp AND INPUT_BTN THEN fire_bullet
    IF inp AND INPUT_ENC_BTN THEN fire_bullet
    IF cooldown > 0 THEN cooldown = cooldown - 1

    ' Invincibility
    IF invincible > 0 THEN
      invincible = invincible - 1
      SPR_COLL 0, COLL_NONE
      IF invincible AND 8 THEN SPR_VIS 0, 0 ELSE SPR_VIS 0, 1
    ELSE
      SPR_VIS 0, 1
      SPR_COLL 0, COLL_DETECT
    END IF

    alien_tick = 1 - alien_tick
    update_aliens
    update_humans
    position_sprites

    IF aliens_alive <= 0 THEN
      aliens_alive = 0
      spawn_wave
    END IF

    spawn_timer = spawn_timer + 1
    IF spawn_timer > 180 THEN
      spawn_timer = 0
      IF aliens_alive < MAX_ALIENS THEN spawn_alien
    END IF

    IF humans_left <= 0 THEN game_state = 1

    draw_hud
    YIELD
  LOOP

  ' Game over
  FOR gs = 0 TO 31
    SPR_OFF gs
  NEXT
  PFX_CLEAR PFX_ALL

  DO
    TEXT_LG "GAME OVER", 37, 16
    TEXT_SM "SCORE", 50, 30
    TEXT_NUM score, 50, 38
    IF humans_left <= 0 THEN TEXT_SM "CITY LOST", 42, 48
    IF INPUT() AND INPUT_ENC_BTN THEN EXIT DO
    YIELD
  LOOP
LOOP
