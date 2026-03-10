' -- MUNCHER ----------------------------------------------------------
' Pac-Man style maze game for Pico-Gamer (128x64, 1-bit)
' Uses sprite engine + hardware walls + viewport scrolling.
' 16x16 tile maze (128x128 world), camera follows pacman.

' -- Sprite bitmaps (8x8) -------------------------------------------
DATA pac_r, $3C, $7E, $FF, $F0, $F0, $FF, $7E, $3C
DATA pac_l, $3C, $7E, $FF, $0F, $0F, $FF, $7E, $3C
DATA pac_u, $24, $66, $E7, $E7, $FF, $FF, $7E, $3C
DATA pac_d, $3C, $7E, $FF, $FF, $E7, $E7, $66, $24
DATA pac_c, $3C, $7E, $FF, $FF, $FF, $FF, $7E, $3C
DATA ghost_bmp, $3C, $7E, $FF, $DB, $FF, $FF, $FF, $A5
DATA ghost_fright, $3C, $42, $81, $A5, $81, $81, $A5, $FF
DATA life_icon, $70,$F8,$F0,$F8,$70,$00,$00,$00

' -- Wall geometry DATA (x, y, w, h per wall, 41 walls) -------------
' All y values offset by MAZE_Y=8
DATA wdata, 0,8,128,8, 0,128,128,8, 0,16,8,40, 0,64,8,72, 120,16,8,40, 120,64,8,72
DATA wdata2, 56,16,16,8
DATA wdata3, 16,24,16,8, 40,24,8,8, 80,24,8,8, 96,24,16,8
DATA wdata4, 16,32,8,8, 48,32,32,8, 104,32,8,8
DATA wdata5, 32,40,8,8, 88,40,8,8
DATA wdata6, 16,48,8,8, 32,48,8,8, 48,48,8,8, 72,48,8,8, 88,48,8,8, 104,48,8,8
DATA wdata7, 16,64,16,8, 40,64,8,8, 80,64,8,8, 96,64,16,8
DATA wdata8, 48,72,8,8, 72,72,8,8
DATA wdata9, 16,80,8,8, 48,80,32,8, 104,80,8,8
DATA wdata10, 16,96,8,8, 32,96,24,8, 72,96,24,8, 104,96,8,8
DATA wdata11, 48,104,8,8, 72,104,8,8
DATA wdata12, 16,112,16,8, 40,112,8,8, 80,112,8,8, 96,112,16,8

CONST NUM_WALLS = 41

' -- Arrays -----------------------------------------------------------
DIM maze(256)
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

CONST MAZE_Y = 8
CONST PAC_SPD = 32
CONST GHOST_SPD = 32
CONST FRIGHT_SPD = 16
CONST EATEN_SPD = 64

' ====================================================================
' Maze initialization
' ====================================================================
SUB set_row(sr_row, a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p)
  sr_base = sr_row * 16
  maze(sr_base) = a
  maze(sr_base + 1) = b
  maze(sr_base + 2) = c
  maze(sr_base + 3) = d
  maze(sr_base + 4) = e
  maze(sr_base + 5) = f
  maze(sr_base + 6) = g
  maze(sr_base + 7) = h
  maze(sr_base + 8) = i
  maze(sr_base + 9) = j
  maze(sr_base + 10) = k
  maze(sr_base + 11) = l
  maze(sr_base + 12) = m
  maze(sr_base + 13) = n
  maze(sr_base + 14) = o
  maze(sr_base + 15) = p
END SUB

SUB init_maze()
  set_row  0, 1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1
  set_row  1, 1,0,0,0,0,0,0,1,1,0,0,0,0,0,0,1
  set_row  2, 1,0,1,1,0,1,0,0,0,0,1,0,1,1,0,1
  set_row  3, 1,0,1,0,0,0,1,1,1,1,0,0,0,1,0,1
  set_row  4, 1,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1
  set_row  5, 1,0,1,0,1,0,1,0,0,1,0,1,0,1,0,1
  set_row  6, 6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6
  set_row  7, 1,0,1,1,0,1,5,5,5,5,1,0,1,1,0,1
  set_row  8, 1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,1
  set_row  9, 1,0,1,0,0,0,1,1,1,1,0,0,0,1,0,1
  set_row 10, 1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1
  set_row 11, 1,0,1,0,1,1,1,0,0,1,1,1,0,1,0,1
  set_row 12, 1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,1
  set_row 13, 1,0,1,1,0,1,0,0,0,0,1,0,1,1,0,1
  set_row 14, 1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1
  set_row 15, 1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1

  dot_count = 0
  FOR i = 0 TO 255
    IF maze(i) = 0 THEN
      maze(i) = TILE_DOT
      dot_count = dot_count + 1
    END IF
  NEXT

  ' Power pellets at corners of playable area
  maze(17) = TILE_POWER
  maze(30) = TILE_POWER
  maze(225) = TILE_POWER
  maze(238) = TILE_POWER

  ' Clear ghost house interior (row 8, cols 7-8)
  maze(135) = TILE_EMPTY
  maze(136) = TILE_EMPTY
  dot_count = dot_count - 2

  ' Clear player start area (row 10, cols 7-8)
  maze(167) = TILE_EMPTY
  maze(168) = TILE_EMPTY
  dot_count = dot_count - 2
END SUB

' ====================================================================
' Wall setup (called once per level)
' ====================================================================
SUB init_walls()
  FOR wi = 0 TO NUM_WALLS - 1
    base = wdata + wi * 4
    wx = PEEK(base)
    wy = PEEK(base + 1)
    ww = PEEK(base + 2)
    wh = PEEK(base + 3)
    WALL_SET wi, wx, wy, ww, wh
  NEXT
END SUB

' ====================================================================
' Sprite setup
' ====================================================================
SUB init_sprites()
  ' Pacman = slot 0 (visible — engine draws with camera offset)
  SPRITE 0, pac_r, 8, 8, 56, 80 + MAZE_Y, 0, 0, 0, EDGE_NONE
  SPR_WALL 0, COLL_STOP
  SPR_COLL 0, COLL_DETECT
  SPR_GROUP 0, 1, 2

  ' Ghosts = slots 1-4
  FOR gi = 0 TO 3
    gslot = gi + 1
    SPRITE gslot, ghost_bmp, 8, 8, 56, 64 + MAZE_Y, 0, 0, 0, EDGE_NONE
    SPR_WALL gslot, COLL_STOP
    SPR_COLL gslot, COLL_DETECT
    SPR_GROUP gslot, 2, 1
  NEXT
END SUB

' ====================================================================
' Tile helpers
' ====================================================================
SUB can_walk(cw_tx, cw_ty)
  can_walk_r = 0
  ' Wrap x for tunnel check
  IF cw_tx < 0 THEN
    cw_tx = 15
  ELSEIF cw_tx >= 16 THEN
    cw_tx = 0
  END IF
  IF cw_ty >= 0 THEN
    IF cw_ty < 16 THEN
      tile = maze(cw_ty * 16 + cw_tx)
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
    IF cw_tx < 16 THEN
      IF cw_ty >= 0 THEN
        IF cw_ty < 16 THEN
          tile = maze(cw_ty * 16 + cw_tx)
          IF tile = TILE_GATE THEN
            IF gmode(cw_gi) = 3 THEN
              can_walk_r = 1
            ELSEIF gmode(cw_gi) = 4 THEN
              can_walk_r = 1
            END IF
          ELSEIF tile = TILE_TUNNEL THEN
            ' Ghosts cannot use tunnels
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
' Drawing — all in world coordinates, engine applies camera offset
' ====================================================================
SUB draw_maze()
  ' Draw all 16x16 tiles in world space (engine clips via camera)
  FOR row = 0 TO 15
    FOR col = 0 TO 15
      idx = row * 16 + col
      tile = maze(idx)
      sx = col * 8
      sy = row * 8 + MAZE_Y

      IF tile = TILE_WALL THEN
        RECT sx + 1, sy + 1, 6, 6
      ELSEIF tile = TILE_DOT THEN
        PIXEL sx + 3, sy + 3, 1
        PIXEL sx + 4, sy + 4, 1
      ELSEIF tile = TILE_POWER THEN
        IF frame_count AND 16 THEN
          RECT sx + 2, sy + 2, 4, 4
        ELSE
          RECT sx + 1, sy + 1, 6, 6
        END IF
      ELSEIF tile = TILE_GATE THEN
        LINE sx, sy + 4, sx + 7, sy + 4
      END IF
    NEXT
  NEXT
END SUB

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
  pty = (pwy - MAZE_Y) SHR 3
  FOR gi = 0 TO 3
    IF gmode(gi) = 2 THEN
      gtx(gi) = RAND() MOD 14 + 1
      gty(gi) = RAND() MOD 14 + 1
    ELSEIF gmode(gi) = 3 THEN
      gtx(gi) = 7
      gty(gi) = 7
    ELSEIF gmode(gi) = 4 THEN
      gtx(gi) = 7
      gty(gi) = 7
    ELSEIF scatter_mode = 1 THEN
      IF gi = 0 THEN
        gtx(gi) = 14 : gty(gi) = 1
      ELSEIF gi = 1 THEN
        gtx(gi) = 1 : gty(gi) = 1
      ELSEIF gi = 2 THEN
        gtx(gi) = 14 : gty(gi) = 14
      ELSE
        gtx(gi) = 1 : gty(gi) = 14
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
        by = (gsy2 - MAZE_Y) SHR 3
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
        dy = pty - ((cly - MAZE_Y) SHR 3)
        IF dx < 0 THEN dx = 0 - dx
        IF dy < 0 THEN dy = 0 - dy
        IF dx + dy > 8 THEN
          gtx(gi) = ptx
          gty(gi) = pty
        ELSE
          gtx(gi) = 1
          gty(gi) = 14
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
  gcy = (gsy - MAZE_Y) SHR 3

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
    IF ((gsy - MAZE_Y) AND 7) = 0 THEN
      at_center = 1
    END IF
  END IF

  ' Check wall hit from last frame
  ghit = SPR_HIT(gslot)
  wall_hit = ghit AND 2

  ' Eaten ghost reached home?
  IF gmode(mg_i) = 3 THEN
    IF at_center = 1 THEN
      gcx = gsx SHR 3
      gcy = (gsy - MAZE_Y) SHR 3
      IF gcx >= 6 THEN
        IF gcx <= 9 THEN
          IF gcy = 7 THEN
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
      ' Teleport ghost above gate so it's not trapped inside box
      SPR_POS gslot, 7 * 8, 6 * 8 + MAZE_Y
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

    IF gdir(mg_i) = DIR_RIGHT THEN
      SPR_VEL gslot, gspd, 0
    ELSEIF gdir(mg_i) = DIR_DOWN THEN
      SPR_VEL gslot, 0, gspd
    ELSEIF gdir(mg_i) = DIR_LEFT THEN
      SPR_VEL gslot, 0 - gspd, 0
    ELSE
      SPR_VEL gslot, 0, 0 - gspd
    END IF
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
    IF ((pwy - MAZE_Y) AND 7) = 0 THEN
      at_center = 1
    END IF
  END IF

  IF at_center = 1 THEN
    ptx = pwx SHR 3
    pty = (pwy - MAZE_Y) SHR 3

    ' Tunnel wrap — appear in the door on the other side
    IF ptx = 0 THEN
      IF pdir = DIR_LEFT THEN
        IF maze(pty * 16) = TILE_TUNNEL THEN
          ptx = 15
          pwx = 15 * 8
          SPR_POS 0, pwx, pwy
        END IF
      END IF
    ELSEIF ptx = 15 THEN
      IF pdir = DIR_RIGHT THEN
        IF maze(pty * 16 + 15) = TILE_TUNNEL THEN
          ptx = 0
          pwx = 0
          SPR_POS 0, pwx, pwy
        END IF
      END IF
    END IF

    ' Eat dot/power pellet
    idx = pty * 16 + ptx
    IF maze(idx) = TILE_DOT THEN
      maze(idx) = TILE_EMPTY
      score = score + 10
      dot_count = dot_count - 1
      chomp_toggle = 1 - chomp_toggle
      IF chomp_toggle = 1 THEN
        TONE 4, 800, 50
      ELSE
        TONE 4, 600, 50
      END IF
    ELSEIF maze(idx) = TILE_POWER THEN
      maze(idx) = TILE_EMPTY
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
      IF pdir = DIR_RIGHT THEN
        SPR_VEL 0, PAC_SPD, 0
      ELSEIF pdir = DIR_LEFT THEN
        SPR_VEL 0, 0 - PAC_SPD, 0
      ELSEIF pdir = DIR_UP THEN
        SPR_VEL 0, 0, 0 - PAC_SPD
      ELSE
        SPR_VEL 0, 0, PAC_SPD
      END IF
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
  pwy = 80
  pdir = DIR_RIGHT
  want_dir = DIR_RIGHT
  player_dead = 0

  SPR_POS 0, 56, 80 + MAZE_Y
  SPR_VEL 0, 0, 0

  ' Blinky: row 6, col 7 - free roaming
  SPR_POS 1, 56, 48 + MAZE_Y
  SPR_VEL 1, 0, 0
  gdir(0) = DIR_LEFT
  gmode(0) = 0
  ghome(0) = 0

  ' Pinky: row 8, col 7 - penned
  SPR_POS 2, 56, 64 + MAZE_Y
  SPR_VEL 2, 0, 0
  gdir(1) = DIR_UP
  gmode(1) = 4
  ghome(1) = 60

  ' Inky: row 8, col 8 - penned
  SPR_POS 3, 64, 64 + MAZE_Y
  SPR_VEL 3, 0, 0
  gdir(2) = DIR_UP
  gmode(2) = 4
  ghome(2) = 180

  ' Clyde: row 8, col 7 - penned
  SPR_POS 4, 56, 64 + MAZE_Y
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
  init_walls
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

' Set up viewport: 128x128 world, camera follows pacman (slot 0)
CAM_WORLD 128, 136
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
        draw_maze
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
        draw_maze
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
    ' Draw world (maze tiles in world coords — engine offsets via camera)
    draw_maze
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
