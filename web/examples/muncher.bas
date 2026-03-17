' -- MUNCHER ----------------------------------------------------------
' Pac-Man style maze game for Pico-Gamer (128x64, 1-bit)
' Uses sprite engine + tilemap system + viewport camera.
' 16x17 tile map (128x136 world), camera follows pacman.

' -- Sprite bitmaps (8x8) -------------------------------------------
DATA pac_r, $3C, $7E, $FF, $F0, $F0, $FF, $7E, $3C
DATA pac_l, $3C, $7E, $FF, $0F, $0F, $FF, $7E, $3C
DATA pac_u, $24, $66, $E7, $E7, $FF, $FF, $7E, $3C
DATA pac_d, $3C, $7E, $FF, $FF, $E7, $E7, $66, $24
DATA pac_c, $3C, $7E, $FF, $FF, $FF, $FF, $7E, $3C
DATA ghost_bmp, $3C, $7E, $FF, $DB, $FF, $FF, $FF, $A5
DATA ghost_fright, $3C, $42, $81, $A5, $81, $81, $A5, $FF
DATA life_icon, $70,$F8,$F0,$F8,$70,$00,$00,$00

' -- Tile bitmaps (8x8, 7 types) ------------------------------------
' 0=empty, 1=wall, 2=dot, 3=power, 4=power_alt(blank), 5=gate, 6=tunnel
DATA tile_gfx,  $00,$00,$00,$00,$00,$00,$00,$00
DATA tile_gfx1, $3C,$7E,$7E,$7E,$7E,$7E,$7E,$3C
DATA tile_gfx2, $00,$00,$00,$18,$18,$00,$00,$00
DATA tile_gfx3, $00,$18,$3C,$7E,$7E,$3C,$18,$00
DATA tile_gfx4, $00,$00,$00,$00,$00,$00,$00,$00
DATA tile_gfx5, $00,$00,$00,$00,$FF,$00,$00,$00
DATA tile_gfx6, $00,$00,$00,$00,$00,$00,$00,$00

' -- Map data (16 wide x 17 tall, row 0 is empty for HUD) -----------
DATA mdata,  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
DATA mdata1, 1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1
DATA mdata2, 1,0,0,0,0,0,0,1,1,0,0,0,0,0,0,1
DATA mdata3, 1,0,1,1,0,1,0,0,0,0,1,0,1,1,0,1
DATA mdata4, 1,0,1,0,0,0,1,1,1,1,0,0,0,1,0,1
DATA mdata5, 1,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1
DATA mdata6, 1,0,1,0,1,0,1,0,0,1,0,1,0,1,0,1
DATA mdata7, 6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6
DATA mdata8, 1,0,1,1,0,1,5,5,5,5,1,0,1,1,0,1
DATA mdata9, 1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,1
DATA mdataA, 1,0,1,0,0,0,1,1,1,1,0,0,0,1,0,1
DATA mdataB, 1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1
DATA mdataC, 1,0,1,0,1,1,1,0,0,1,1,1,0,1,0,1
DATA mdataD, 1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,1
DATA mdataE, 1,0,1,1,0,1,0,0,0,0,1,0,1,1,0,1
DATA mdataF, 1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1
DATA mdataG, 1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1

' -- Arrays -----------------------------------------------------------
DIM gtx(4)
DIM gty(4)
DIM gdir(4)
DIM gmode(4)
DIM ghome(4)

' -- Constants --------------------------------------------------------
CONST TILE_EMPTY = 0
CONST TILE_WALL = 1
CONST TILE_DOT = 2
CONST TILE_POWER = 3
CONST TILE_GATE = 5
CONST TILE_TUNNEL = 6

CONST DIR_RIGHT = 0
CONST DIR_DOWN = 1
CONST DIR_LEFT = 2
CONST DIR_UP = 3

CONST MAP_W = 16
CONST MAP_H = 17
CONST MAZE_ROW = 1

CONST PAC_SPD = 32
CONST GHOST_SPD = 32
CONST FRIGHT_SPD = 16
CONST EATEN_SPD = 64

' ====================================================================
' Maze initialization — uses engine tilemap
' ====================================================================
SUB init_maze()
  ' Register tile graphics and properties
  TILESET tile_gfx, 7
  TILE_PROP 1, TILE_SOLID
  TILE_PROP 5, TILE_SOLID

  ' Power pellet animates (alternates tile 3 <-> tile 4)
  TILE_PROP 3, TILE_ANIM

  ' Load map — also sets world size to 128x136
  TILEMAP mdata, MAP_W, MAP_H

  ' Convert empty tiles (0) to dots in maze area (rows 1-16)
  dot_count = 0
  FOR mr = MAZE_ROW TO MAP_H - 1
    FOR mc = 0 TO MAP_W - 1
      t = TILE_GET(mc, mr)
      IF t = 0 THEN
        TILE_SET mc, mr, TILE_DOT
        dot_count = dot_count + 1
      END IF
    NEXT
  NEXT

  ' Power pellets at corners of playable area
  TILE_SET 1, 2, TILE_POWER
  TILE_SET 14, 2, TILE_POWER
  TILE_SET 1, 15, TILE_POWER
  TILE_SET 14, 15, TILE_POWER

  ' Clear ghost house interior (row 9 in map = maze row 8, cols 7-8)
  TILE_SET 7, 9, TILE_EMPTY
  TILE_SET 8, 9, TILE_EMPTY
  dot_count = dot_count - 2

  ' Clear player start area (row 11 in map = maze row 10, cols 7-8)
  TILE_SET 7, 11, TILE_EMPTY
  TILE_SET 8, 11, TILE_EMPTY
  dot_count = dot_count - 2
END SUB

' ====================================================================
' Sprite setup
' ====================================================================
SUB init_sprites()
  ' Pacman = slot 0
  SPRITE 0, pac_r, 8, 8, 56, 88, 0, 0, 0, EDGE_NONE
  SPR_WALL 0, COLL_STOP
  SPR_COLL 0, COLL_DETECT
  SPR_GROUP 0, 1, 2

  ' Ghosts = slots 1-4 (no engine wall collision — BASIC handles it)
  FOR gi = 0 TO 3
    gslot = gi + 1
    SPRITE gslot, ghost_bmp, 8, 8, 56, 72, 0, 0, 0, EDGE_NONE
    SPR_COLL gslot, COLL_DETECT
    SPR_GROUP gslot, 2, 1
  NEXT
END SUB

' ====================================================================
' Tile helpers — map coords (col, row including the empty HUD row)
' ====================================================================
SUB can_walk(cw_tx, cw_ty)
  can_walk_r = 0
  ' Wrap x for tunnel check
  IF cw_tx < 0 THEN
    cw_tx = MAP_W - 1
  ELSEIF cw_tx >= MAP_W THEN
    cw_tx = 0
  END IF
  IF cw_ty >= 0 THEN
    IF cw_ty < MAP_H THEN
      tile = TILE_GET(cw_tx, cw_ty)
      IF tile <> TILE_WALL THEN
        IF tile <> TILE_GATE THEN
          can_walk_r = 1
        END IF
      END IF
    END IF
  END IF
END SUB

SUB can_ghost_walk(cw_tx, cw_ty, cw_gi)
  can_walk_r = 0
  IF cw_tx >= 0 THEN
    IF cw_tx < MAP_W THEN
      IF cw_ty >= 0 THEN
        IF cw_ty < MAP_H THEN
          tile = TILE_GET(cw_tx, cw_ty)
          IF tile = TILE_GATE THEN
            IF gmode(cw_gi) = 3 THEN
              can_walk_r = 1
            ELSEIF gmode(cw_gi) = 4 THEN
              can_walk_r = 1
            END IF
          ELSEIF tile = TILE_TUNNEL THEN
            can_walk_r = 0
          ELSEIF tile <> TILE_WALL THEN
            can_walk_r = 1
          END IF
        END IF
      END IF
    END IF
  END IF
END SUB

' ====================================================================
' Drawing helpers
' ====================================================================
SUB update_sprite_imgs()
  ' Animate pacman mouth
  IF frame_count AND 8 THEN
    SPR_IMG 0, pac_c
  ELSE
    IF pdir = DIR_RIGHT THEN
      SPR_IMG 0, pac_r
    ELSEIF pdir = DIR_LEFT THEN
      SPR_IMG 0, pac_l
    ELSEIF pdir = DIR_UP THEN
      SPR_IMG 0, pac_u
    ELSE
      SPR_IMG 0, pac_d
    END IF
  END IF

  ' Animate ghosts
  FOR gi = 0 TO 3
    gslot = gi + 1
    IF gmode(gi) = 2 THEN
      ' Frightened: flash near end
      IF fright_timer < 120 THEN
        IF frame_count AND 8 THEN
          SPR_IMG gslot, ghost_bmp
        ELSE
          SPR_IMG gslot, ghost_fright
        END IF
      ELSE
        SPR_IMG gslot, ghost_fright
      END IF
    ELSEIF gmode(gi) = 3 THEN
      ' Eaten: hide sprite, draw eyes manually
      SPR_VIS gslot, 0
    ELSE
      SPR_IMG gslot, ghost_bmp
      SPR_VIS gslot, 1
    END IF
  NEXT
END SUB

SUB draw_eaten_ghosts()
  ' Draw eyes for eaten ghosts in world coords
  FOR gi = 0 TO 3
    IF gmode(gi) = 3 THEN
      gslot = gi + 1
      gsx, gsy = SPR_GET(gslot)
      PIXEL gsx + 2, gsy + 3, 1
      PIXEL gsx + 5, gsy + 3, 1
    END IF
  NEXT
END SUB

SUB draw_hud()
  CAM_HUD 1
  TEXT_NUM score, 1, 1
  FOR li = 0 TO lives - 1
    lx = 123 - li * 6
    BLIT life_icon, lx, 1, 5, 5
  NEXT
  CAM_HUD 0
END SUB

' ====================================================================
' Ghost AI - target selection
' ====================================================================
SUB update_ghost_targets()
  ptx = pwx SHR 3
  pty = pwy SHR 3
  FOR gi = 0 TO 3
    IF gmode(gi) = 2 THEN
      gtx(gi) = RAND() MOD 14 + 1
      gty(gi) = RAND() MOD 14 + MAZE_ROW
    ELSEIF gmode(gi) = 3 THEN
      gtx(gi) = 7
      gty(gi) = 7 + MAZE_ROW
    ELSEIF gmode(gi) = 4 THEN
      gtx(gi) = 7
      gty(gi) = 7 + MAZE_ROW
    ELSEIF scatter_mode = 1 THEN
      IF gi = 0 THEN
        gtx(gi) = 14 : gty(gi) = 1 + MAZE_ROW
      ELSEIF gi = 1 THEN
        gtx(gi) = 1 : gty(gi) = 1 + MAZE_ROW
      ELSEIF gi = 2 THEN
        gtx(gi) = 14 : gty(gi) = 14 + MAZE_ROW
      ELSE
        gtx(gi) = 1 : gty(gi) = 14 + MAZE_ROW
      END IF
    ELSE
      IF gi = 0 THEN
        gtx(gi) = ptx
        gty(gi) = pty
      ELSEIF gi = 1 THEN
        IF pdir = DIR_RIGHT THEN
          gtx(gi) = ptx + 4 : gty(gi) = pty
        ELSEIF pdir = DIR_LEFT THEN
          gtx(gi) = ptx - 4 : gty(gi) = pty
        ELSEIF pdir = DIR_UP THEN
          gtx(gi) = ptx : gty(gi) = pty - 4
        ELSE
          gtx(gi) = ptx : gty(gi) = pty + 4
        END IF
      ELSEIF gi = 2 THEN
        gsx2, gsy2 = SPR_GET(1)
        bx = gsx2 SHR 3
        by = gsy2 SHR 3
        IF pdir = DIR_RIGHT THEN
          ax = ptx + 2 : ay = pty
        ELSEIF pdir = DIR_LEFT THEN
          ax = ptx - 2 : ay = pty
        ELSEIF pdir = DIR_UP THEN
          ax = ptx : ay = pty - 2
        ELSE
          ax = ptx : ay = pty + 2
        END IF
        gtx(gi) = ax + (ax - bx)
        gty(gi) = ay + (ay - by)
      ELSE
        clx, cly = SPR_GET(4)
        dx = ptx - (clx SHR 3)
        dy = pty - (cly SHR 3)
        IF dx < 0 THEN dx = 0 - dx
        IF dy < 0 THEN dy = 0 - dy
        IF dx + dy > 8 THEN
          gtx(gi) = ptx
          gty(gi) = pty
        ELSE
          gtx(gi) = 1
          gty(gi) = 14 + MAZE_ROW
        END IF
      END IF
    END IF
  NEXT
END SUB

' ====================================================================
' Ghost movement - direction picking at tile centers
' ====================================================================
SUB pick_ghost_dir(mg_i)
  gslot = mg_i + 1
  gsx, gsy = SPR_GET(gslot)
  gcx = gsx SHR 3
  gcy = gsy SHR 3

  best_dist = 9999
  best_dir = gdir(mg_i)
  rev_dir = (gdir(mg_i) + 2) AND 3

  ' Check directions in UP, LEFT, DOWN, RIGHT priority (matching Pac-Man)
  ' On ties, earlier direction wins — UP bias helps ghosts route to gate
  FOR ti = 0 TO 3
    IF ti = 0 THEN
      try_dir = DIR_UP
    ELSEIF ti = 1 THEN
      try_dir = DIR_LEFT
    ELSEIF ti = 2 THEN
      try_dir = DIR_DOWN
    ELSE
      try_dir = DIR_RIGHT
    END IF

    IF try_dir <> rev_dir THEN
      IF try_dir = DIR_RIGHT THEN
        nx = gcx + 1 : ny = gcy
      ELSEIF try_dir = DIR_DOWN THEN
        nx = gcx : ny = gcy + 1
      ELSEIF try_dir = DIR_LEFT THEN
        nx = gcx - 1 : ny = gcy
      ELSE
        nx = gcx : ny = gcy - 1
      END IF

      can_ghost_walk nx, ny, mg_i
      IF can_walk_r = 1 THEN
        dx = gtx(mg_i) - nx
        dy = gty(mg_i) - ny
        IF dx < 0 THEN dx = 0 - dx
        IF dy < 0 THEN dy = 0 - dy
        d = dx + dy
        IF d < best_dist THEN
          best_dist = d
          best_dir = try_dir
        END IF
      END IF
    END IF
  NEXT

  IF best_dist = 9999 THEN best_dir = rev_dir
  gdir(mg_i) = best_dir
END SUB

SUB update_ghost(mg_i)
  gslot = mg_i + 1
  gsx, gsy = SPR_GET(gslot)

  ' Check if at tile center
  at_center = 0
  IF (gsx AND 7) = 0 THEN
    IF (gsy AND 7) = 0 THEN
      at_center = 1
    END IF
  END IF

  ' Check wall hit from last frame
  ghit = SPR_HIT(gslot)
  wall_hit = ghit AND 2

  ' Eaten ghost reached home? (gate row = maze row 7 + MAZE_ROW = map row 8)
  IF gmode(mg_i) = 3 THEN
    IF at_center = 1 THEN
      gcx = gsx SHR 3
      gcy = gsy SHR 3
      IF gcx >= 6 THEN
        IF gcx <= 9 THEN
          IF gcy = 7 + MAZE_ROW THEN
            gmode(mg_i) = 4
            ghome(mg_i) = 60
            SPR_DIR gslot, DIR_DOWN, 32
          END IF
        END IF
      END IF
    END IF
  END IF

  ' Home ghost exit timer
  IF gmode(mg_i) = 4 THEN
    ghome(mg_i) = ghome(mg_i) - 1
    IF ghome(mg_i) <= 0 THEN
      IF fright_timer > 0 THEN
        gmode(mg_i) = 2
      ELSE
        gmode(mg_i) = 0
      END IF
      gdir(mg_i) = DIR_UP
      ' Teleport ghost above gate
      SPR_POS gslot, 7 * 8, (6 + MAZE_ROW) * 8
      SPR_DIR gslot, DIR_UP, 32
      at_center = 0
    END IF
  END IF

  ' Pick direction at tile center or on wall hit
  IF at_center = 1 THEN
    pick_ghost_dir mg_i
  ELSEIF wall_hit <> 0 THEN
    pick_ghost_dir mg_i
  END IF

  ' Set velocity at tile center or wall hit only
  IF at_center = 1 THEN
    set_vel = 1
  ELSEIF wall_hit <> 0 THEN
    set_vel = 1
  ELSE
    set_vel = 0
  END IF

  IF set_vel = 1 THEN
    IF gmode(mg_i) = 2 THEN
      gspd = FRIGHT_SPD
    ELSEIF gmode(mg_i) = 3 THEN
      gspd = EATEN_SPD
    ELSE
      gspd = GHOST_SPD
    END IF

    SPR_DIR gslot, gdir(mg_i), gspd
  END IF
END SUB

' ====================================================================
' Player movement
' ====================================================================
SUB move_player()
  inp = INPUT()

  IF inp AND INPUT_RIGHT THEN
    want_dir = DIR_RIGHT
  ELSEIF inp AND INPUT_LEFT THEN
    want_dir = DIR_LEFT
  ELSEIF inp AND INPUT_UP THEN
    want_dir = DIR_UP
  ELSEIF inp AND INPUT_DOWN THEN
    want_dir = DIR_DOWN
  END IF

  ' Read current world position from sprite engine
  psx, psy = SPR_GET(0)
  pwx = psx
  pwy = psy

  ' Check if at tile center
  at_center = 0
  IF (pwx AND 7) = 0 THEN
    IF (pwy AND 7) = 0 THEN
      at_center = 1
    END IF
  END IF

  IF at_center = 1 THEN
    ptx = pwx SHR 3
    pty = pwy SHR 3

    ' Tunnel wrap — appear in the door on the other side
    IF ptx = 0 THEN
      IF pdir = DIR_LEFT THEN
        t = TILE_GET(0, pty)
        IF t = TILE_TUNNEL THEN
          ptx = MAP_W - 1
          pwx = ptx * 8
          SPR_POS 0, pwx, pwy
        END IF
      END IF
    ELSEIF ptx = MAP_W - 1 THEN
      IF pdir = DIR_RIGHT THEN
        t = TILE_GET(MAP_W - 1, pty)
        IF t = TILE_TUNNEL THEN
          ptx = 0
          pwx = 0
          SPR_POS 0, pwx, pwy
        END IF
      END IF
    END IF

    ' Eat dot/power pellet
    t = TILE_GET(ptx, pty)
    IF t = TILE_DOT THEN
      TILE_SET ptx, pty, TILE_EMPTY
      score = score + 10
      dot_count = dot_count - 1
      chomp_toggle = 1 - chomp_toggle
      IF chomp_toggle = 1 THEN
        SFX SFX_CHOMP_A, 4
      ELSE
        SFX SFX_CHOMP_B, 4
      END IF
    ELSEIF t = TILE_POWER THEN
      TILE_SET ptx, pty, TILE_EMPTY
      score = score + 50
      dot_count = dot_count - 1
      fright_timer = 480
      ghost_chain = 0
      FOR fi = 0 TO 3
        IF gmode(fi) = 0 THEN
          gmode(fi) = 2
          gdir(fi) = (gdir(fi) + 2) AND 3
        ELSEIF gmode(fi) = 1 THEN
          gmode(fi) = 2
          gdir(fi) = (gdir(fi) + 2) AND 3
        ELSEIF gmode(fi) = 2 THEN
          ' Already frightened — just reverse direction
          gdir(fi) = (gdir(fi) + 2) AND 3
        END IF
      NEXT
      SFX SFX_POWERUP, 4
    END IF

    ' Try desired direction first
    IF want_dir = DIR_RIGHT THEN
      can_walk ptx + 1, pty
    ELSEIF want_dir = DIR_LEFT THEN
      can_walk ptx - 1, pty
    ELSEIF want_dir = DIR_UP THEN
      can_walk ptx, pty - 1
    ELSE
      can_walk ptx, pty + 1
    END IF

    IF can_walk_r = 1 THEN
      pdir = want_dir
    ELSE
      ' Try continuing current direction
      IF pdir = DIR_RIGHT THEN
        can_walk ptx + 1, pty
      ELSEIF pdir = DIR_LEFT THEN
        can_walk ptx - 1, pty
      ELSEIF pdir = DIR_UP THEN
        can_walk ptx, pty - 1
      ELSE
        can_walk ptx, pty + 1
      END IF
    END IF

    ' Set velocity: move in pdir if walkable, else stop
    IF pdir = DIR_RIGHT THEN
      can_walk ptx + 1, pty
    ELSEIF pdir = DIR_LEFT THEN
      can_walk ptx - 1, pty
    ELSEIF pdir = DIR_UP THEN
      can_walk ptx, pty - 1
    ELSE
      can_walk ptx, pty + 1
    END IF

    IF can_walk_r = 1 THEN
      SPR_DIR 0, pdir, PAC_SPD
    ELSE
      SPR_VEL 0, 0, 0
    END IF
  END IF
END SUB

' ====================================================================
' Ghost-player collision
' ====================================================================
SUB check_ghost_collision()
  FOR gi = 0 TO 3
    gslot = gi + 1
    gsx, gsy = SPR_GET(gslot)
    dx = pwx - gsx
    dy = pwy - gsy
    IF dx < 0 THEN dx = 0 - dx
    IF dy < 0 THEN dy = 0 - dy

    IF dx < 6 THEN
      IF dy < 6 THEN
        IF gmode(gi) = 2 THEN
          gmode(gi) = 3
          ghost_chain = ghost_chain + 1
          IF ghost_chain = 1 THEN score = score + 200
          IF ghost_chain = 2 THEN score = score + 400
          IF ghost_chain = 3 THEN score = score + 800
          IF ghost_chain >= 4 THEN score = score + 1600
          SFX SFX_POWERUP, 5
        ELSEIF gmode(gi) <> 3 THEN
          IF gmode(gi) <> 4 THEN
            player_dead = 1
          END IF
        END IF
      END IF
    END IF
  NEXT
END SUB

' ====================================================================
' Mode switching (scatter/chase cycle, fright timer)
' ====================================================================
SUB update_modes()
  mode_timer = mode_timer + 1

  IF scatter_mode = 1 THEN
    IF mode_timer >= 420 THEN
      scatter_mode = 0
      mode_timer = 0
      FOR mi = 0 TO 3
        IF gmode(mi) = 0 THEN gdir(mi) = (gdir(mi) + 2) AND 3
      NEXT
    END IF
  ELSE
    IF mode_timer >= 1200 THEN
      scatter_mode = 1
      mode_timer = 0
      FOR mi = 0 TO 3
        IF gmode(mi) = 0 THEN gdir(mi) = (gdir(mi) + 2) AND 3
      NEXT
    END IF
  END IF

  IF fright_timer > 0 THEN
    fright_timer = fright_timer - 1
    IF fright_timer = 0 THEN
      FOR fi = 0 TO 3
        IF gmode(fi) = 2 THEN gmode(fi) = 0
      NEXT
    END IF
  END IF
END SUB

' ====================================================================
' Reset positions for new life / new level
' ====================================================================
SUB reset_positions()
  pwx = 56
  pwy = (10 + MAZE_ROW) * 8
  pdir = DIR_RIGHT
  want_dir = DIR_RIGHT
  player_dead = 0

  SPR_POS 0, 56, (10 + MAZE_ROW) * 8
  SPR_VEL 0, 0, 0

  ' Blinky: maze row 6, col 7 - free roaming
  SPR_POS 1, 56, (6 + MAZE_ROW) * 8
  SPR_VEL 1, 0, 0
  gdir(0) = DIR_LEFT
  gmode(0) = 0
  ghome(0) = 0

  ' Pinky: maze row 8, col 7 - penned
  SPR_POS 2, 56, (8 + MAZE_ROW) * 8
  SPR_VEL 2, 0, 0
  gdir(1) = DIR_UP
  gmode(1) = 4
  ghome(1) = 60

  ' Inky: maze row 8, col 8 - penned
  SPR_POS 3, 64, (8 + MAZE_ROW) * 8
  SPR_VEL 3, 0, 0
  gdir(2) = DIR_UP
  gmode(2) = 4
  ghome(2) = 180

  ' Clyde: maze row 8, col 7 - penned
  SPR_POS 4, 56, (8 + MAZE_ROW) * 8
  SPR_VEL 4, 0, 0
  gdir(3) = DIR_UP
  gmode(3) = 4
  ghome(3) = 300

  fright_timer = 0
  ghost_chain = 0
END SUB

' ====================================================================
' Level init
' ====================================================================
SUB init_level()
  init_maze
  init_sprites
  reset_positions
  scatter_mode = 1
  mode_timer = 0
  frame_count = 0
  chomp_toggle = 0
END SUB

' ====================================================================
' Main game loop
' ====================================================================
VOLUME 200

' Set up viewport: camera follows pacman (slot 0)
CAM_MODE SCROLL_FOLLOW, 0

DO
  score = 0
  lives = 3
  level = 1
  game_over = 0
  init_level

  DO WHILE game_over = 0
    frame_count = frame_count + 1

    move_player
    update_ghost_targets
    update_ghost 0
    update_ghost 1
    update_ghost 2
    update_ghost 3
    check_ghost_collision
    update_modes

    ' Player death
    IF player_dead = 1 THEN
      SFX SFX_DEATH, 5
      SPR_VEL 0, 0, 0
      SPR_VEL 1, 0, 0
      SPR_VEL 2, 0, 0
      SPR_VEL 3, 0, 0
      SPR_VEL 4, 0, 0
      FOR di = 0 TO 90
        draw_hud
        YIELD
      NEXT

      lives = lives - 1
      IF lives = 0 THEN
        game_over = 1
      ELSE
        reset_positions
      END IF
    END IF

    ' Level complete
    IF dot_count <= 0 THEN
      SFX SFX_POWERUP, 5
      SPR_VEL 0, 0, 0
      SPR_VEL 1, 0, 0
      SPR_VEL 2, 0, 0
      SPR_VEL 3, 0, 0
      SPR_VEL 4, 0, 0
      FOR di = 0 TO 120
        draw_hud
        IF di AND 8 THEN
          CAM_HUD 1
          TEXT_LG "CLEAR!", 40, 28
          CAM_HUD 0
        END IF
        YIELD
      NEXT
      level = level + 1
      init_level
    END IF

    ' Animate sprite images (pacman mouth, ghost flashing)
    update_sprite_imgs
    ' Draw eyes for eaten ghosts (sprites hidden, so draw manually)
    draw_eaten_ghosts
    draw_hud
    YIELD
  LOOP

  ' Game over screen
  FOR si = 0 TO 4
    SPR_VEL si, 0, 0
  NEXT
  DO
    CAM_HUD 1
    TEXT_LG "GAME", 30, 20
    TEXT_LG "OVER", 68, 20
    TEXT_NUM score, 48, 35
    TEXT_SM "PRESS START", 28, 50
    CAM_HUD 0

    IF INPUT() AND INPUT_ENC_BTN THEN EXIT DO
    YIELD
  LOOP
LOOP
