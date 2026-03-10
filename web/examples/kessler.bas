' -- Kessler Syndrome ------------------------------------------------
' The field starts clear. Asteroids appear periodically, faster over time.
' Large->medium->small->tiny. Asteroid-asteroid collisions break them too.
' Tiny asteroids (2px dots) don't break further but can still kill you.

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
' Tiny (2x2 bitmap dot)
DATA ast_tiny, $C0, $C0

' Ship icon for lives HUD (5x5 row-aligned)
DATA ship_icon, $20, $50, $50, $88, $F8

' -- Array for asteroid sizes (slots 5-31 = 27 entries) ---------------
' sizes: 0=empty, 1=large, 2=medium, 3=small (terminal)
DIM sizes(27)
' invincibility countdown per asteroid slot (0 = vulnerable)
DIM ast_inv(27)

' -- Background Music (all 6 voices) -----------------------------------
EFFECT bg_bass
  STEP 0,   WAVE_TRI, 0, 255, 45, 0
  STEP 40,  WAVE_TRI, 0, 255, 30, 0
  STEP 100, WAVE_TRI, 0, 255, 20, 0
  STEP 250, OFF
END EFFECT

EFFECT bg_lead
  STEP 0,   WAVE_PULSE, 0, 128, 30, 0
  STEP 15,  WAVE_PULSE, 0, 128, 42, 0
  STEP 60,  WAVE_PULSE, 0, 128, 35, 0
  STEP 150, WAVE_PULSE, 0, 128, 25, 0
  STEP 300, OFF
END EFFECT

EFFECT bg_arp
  STEP 0,   WAVE_PULSE, 0, 64, 18, 0
  STEP 500, OFF
END EFFECT

EFFECT bg_pad
  STEP 0,   WAVE_SAW, 0, 128, 10, 0
  STEP 80,  WAVE_SAW, 0, 128, 28, 0
  STEP 300, WAVE_SAW, 0, 128, 20, 0
  STEP 600, OFF
END EFFECT

EFFECT bg_perc
  STEP 0,   WAVE_NOISE, 8000, 128, 80, 200
  STEP 20,  WAVE_NOISE, 8000, 128, 40, 180
  STEP 40,  WAVE_NOISE, 8000, 128, 10, 160
  STEP 60,  OFF
END EFFECT

' Main(x2) -> Tense(x2) -> Main(x2) -> Ease(x2), looping (~64 sec cycle)
SONG bg_music, 120, 1
  TRACK 0, bg_pad, 0, 0, "C3:16 G2:16 GS2:16 G2:16 C3:16 G2:16 GS2:16 G2:16 F2:16 GS2:16 AS2:16 G2:16 F2:16 GS2:16 AS2:16 G2:16 C3:16 G2:16 GS2:16 G2:16 C3:16 G2:16 GS2:16 G2:16 C3:16 DS3:16 GS2:16 C3:16 C3:16 DS3:16 GS2:16 C3:16"
  TRACK 1, bg_pad, 0, 0, "G3:16 D3:16 DS3:16 D3:16 G3:16 D3:16 DS3:16 D3:16 C3:16 DS3:16 F3:16 D3:16 C3:16 DS3:16 F3:16 D3:16 G3:16 D3:16 DS3:16 D3:16 G3:16 D3:16 DS3:16 D3:16 G3:16 AS3:16 DS3:16 G3:16 G3:16 AS3:16 DS3:16 G3:16"
  TRACK 2, bg_bass, 0, 0, "C2:2 R:2 G1:2 R:2 GS1:2 R:2 AS1:2 R:2 C2:2 R:2 DS2:2 R:2 F2:2 R:2 G1:2 R:2 C2:2 R:2 GS1:2 R:2 AS1:2 R:2 G1:2 R:2 C2:2 R:2 DS2:2 R:2 F2:2 R:2 G2:2 R:2 C2:2 R:2 G1:2 R:2 GS1:2 R:2 AS1:2 R:2 C2:2 R:2 DS2:2 R:2 F2:2 R:2 G1:2 R:2 C2:2 R:2 GS1:2 R:2 AS1:2 R:2 G1:2 R:2 C2:2 R:2 DS2:2 R:2 F2:2 R:2 G2:2 R:2 F1:2 R:2 F1:2 F2:2 R:2 F1:2 R:2 F2:2 GS1:2 R:2 GS1:2 GS2:2 R:2 GS1:2 R:2 GS2:2 AS1:2 R:2 AS1:2 AS2:2 R:2 AS1:1 R:1 AS1:1 R:1 AS2:2 G1:1 R:1 G1:1 R:1 G1:1 R:1 G1:1 R:1 G1:1 R:1 G1:1 R:1 G1:1 R:1 G1:1 R:1 F1:2 R:2 F1:2 F2:2 R:2 F1:2 R:2 F2:2 GS1:2 R:2 GS1:2 GS2:2 R:2 GS1:2 R:2 GS2:2 AS1:2 R:2 AS1:2 AS2:2 R:2 AS1:1 R:1 AS1:1 R:1 AS2:2 G1:1 R:1 G1:1 R:1 G1:1 R:1 G1:1 R:1 G1:1 R:1 G1:1 R:1 G1:1 R:1 G1:1 R:1 C2:2 R:2 G1:2 R:2 GS1:2 R:2 AS1:2 R:2 C2:2 R:2 DS2:2 R:2 F2:2 R:2 G1:2 R:2 C2:2 R:2 GS1:2 R:2 AS1:2 R:2 G1:2 R:2 C2:2 R:2 DS2:2 R:2 F2:2 R:2 G2:2 R:2 C2:2 R:2 G1:2 R:2 GS1:2 R:2 AS1:2 R:2 C2:2 R:2 DS2:2 R:2 F2:2 R:2 G1:2 R:2 C2:2 R:2 GS1:2 R:2 AS1:2 R:2 G1:2 R:2 C2:2 R:2 DS2:2 R:2 F2:2 R:2 G2:2 R:2 C2:8 R:8 DS2:8 R:8 GS1:8 R:8 C2:8 R:8 C2:8 R:8 DS2:8 R:8 GS1:8 R:8 C2:8 R:8"
  TRACK 3, bg_lead, 0, 0, "G4:1 R:1 DS4:1 R:1 C4:1 DS4:1 G4:1 R:1 GS4:1 R:1 G4:1 R:1 F4:1 R:1 DS4:1 R:1 D4:1 R:1 DS4:1 R:1 F4:1 R:1 G4:1 GS4:1 G4:1 R:1 F4:1 R:1 DS4:1 R:1 D4:1 R:1 C4:1 R:3 DS4:1 R:1 C4:1 R:1 G3:1 R:3 AS3:1 R:3 C4:1 R:1 D4:1 R:1 DS4:1 R:3 C4:1 R:3 G3:1 R:3 G4:1 R:1 DS4:1 R:1 C4:1 DS4:1 G4:1 R:1 GS4:1 R:1 G4:1 R:1 F4:1 R:1 DS4:1 R:1 D4:1 R:1 DS4:1 R:1 F4:1 R:1 G4:1 GS4:1 G4:1 R:1 F4:1 R:1 DS4:1 R:1 D4:1 R:1 C4:1 R:3 DS4:1 R:1 C4:1 R:1 G3:1 R:3 AS3:1 R:3 C4:1 R:1 D4:1 R:1 DS4:1 R:3 C4:1 R:3 G3:1 R:3 F4:1 GS4:1 F4:1 R:1 F4:1 C5:1 GS4:1 R:1 F4:1 GS4:1 F4:1 R:1 C5:1 GS4:1 F4:1 R:1 GS4:1 C5:1 GS4:1 R:1 GS4:1 DS5:1 C5:1 R:1 GS4:1 C5:1 DS5:1 C5:1 GS4:1 R:1 C5:1 R:1 AS4:1 D5:1 F5:1 D5:1 AS4:1 D5:1 F5:1 D5:1 AS4:1 D5:1 F5:1 D5:1 AS4:1 F5:1 D5:1 AS4:1 G4:1 B4:1 D5:1 G5:1 D5:1 B4:1 G4:1 R:1 G4:2 R:2 G4:1 R:1 G4:1 R:1 F4:1 GS4:1 F4:1 R:1 F4:1 C5:1 GS4:1 R:1 F4:1 GS4:1 F4:1 R:1 C5:1 GS4:1 F4:1 R:1 GS4:1 C5:1 GS4:1 R:1 GS4:1 DS5:1 C5:1 R:1 GS4:1 C5:1 DS5:1 C5:1 GS4:1 R:1 C5:1 R:1 AS4:1 D5:1 F5:1 D5:1 AS4:1 D5:1 F5:1 D5:1 AS4:1 D5:1 F5:1 D5:1 AS4:1 F5:1 D5:1 AS4:1 G4:1 B4:1 D5:1 G5:1 D5:1 B4:1 G4:1 R:1 G4:2 R:2 G4:1 R:1 G4:1 R:1 G4:1 R:1 DS4:1 R:1 C4:1 DS4:1 G4:1 R:1 GS4:1 R:1 G4:1 R:1 F4:1 R:1 DS4:1 R:1 D4:1 R:1 DS4:1 R:1 F4:1 R:1 G4:1 GS4:1 G4:1 R:1 F4:1 R:1 DS4:1 R:1 D4:1 R:1 C4:1 R:3 DS4:1 R:1 C4:1 R:1 G3:1 R:3 AS3:1 R:3 C4:1 R:1 D4:1 R:1 DS4:1 R:3 C4:1 R:3 G3:1 R:3 G4:1 R:1 DS4:1 R:1 C4:1 DS4:1 G4:1 R:1 GS4:1 R:1 G4:1 R:1 F4:1 R:1 DS4:1 R:1 D4:1 R:1 DS4:1 R:1 F4:1 R:1 G4:1 GS4:1 G4:1 R:1 F4:1 R:1 DS4:1 R:1 D4:1 R:1 C4:1 R:3 DS4:1 R:1 C4:1 R:1 G3:1 R:3 AS3:1 R:3 C4:1 R:1 D4:1 R:1 DS4:1 R:3 C4:1 R:3 G3:1 R:3 G4:4 R:4 DS4:4 C4:4 DS4:8 C4:8 AS3:4 R:4 GS3:4 R:4 C4:8 R:8 G4:4 R:4 DS4:4 C4:4 DS4:8 C4:8 AS3:4 R:4 GS3:4 R:4 C4:8 R:8"
  TRACK 4, bg_arp, 0, 0, "C4:1 DS4:1 G4:1 C5:1 C4:1 DS4:1 G4:1 C5:1 GS3:1 C4:1 DS4:1 GS4:1 GS3:1 C4:1 DS4:1 GS4:1 AS3:1 D4:1 F4:1 AS4:1 AS3:1 D4:1 F4:1 AS4:1 G3:1 B3:1 D4:1 G4:1 G3:1 B3:1 D4:1 G4:1 C4:2 DS4:2 G4:2 C5:2 C4:2 DS4:2 G4:2 C5:2 GS3:2 C4:2 DS4:2 GS4:2 GS3:2 C4:2 DS4:2 GS4:2 C4:1 DS4:1 G4:1 C5:1 C4:1 DS4:1 G4:1 C5:1 GS3:1 C4:1 DS4:1 GS4:1 GS3:1 C4:1 DS4:1 GS4:1 AS3:1 D4:1 F4:1 AS4:1 AS3:1 D4:1 F4:1 AS4:1 G3:1 B3:1 D4:1 G4:1 G3:1 B3:1 D4:1 G4:1 C4:2 DS4:2 G4:2 C5:2 C4:2 DS4:2 G4:2 C5:2 GS3:2 C4:2 DS4:2 GS4:2 GS3:2 C4:2 DS4:2 GS4:2 F3:1 GS3:1 C4:1 F4:1 F3:1 GS3:1 C4:1 F4:1 F3:1 GS3:1 C4:1 F4:1 F3:1 GS3:1 C4:1 F4:1 GS3:1 C4:1 DS4:1 GS4:1 GS3:1 C4:1 DS4:1 GS4:1 GS3:1 C4:1 DS4:1 GS4:1 GS3:1 C4:1 DS4:1 GS4:1 AS3:1 D4:1 F4:1 AS4:1 AS3:1 D4:1 F4:1 AS4:1 AS3:1 D4:1 F4:1 AS4:1 AS3:1 D4:1 F4:1 AS4:1 G3:1 B3:1 D4:1 F4:1 G3:1 B3:1 D4:1 F4:1 G3:1 B3:1 D4:1 F4:1 G3:1 B3:1 D4:1 F4:1 F3:1 GS3:1 C4:1 F4:1 F3:1 GS3:1 C4:1 F4:1 F3:1 GS3:1 C4:1 F4:1 F3:1 GS3:1 C4:1 F4:1 GS3:1 C4:1 DS4:1 GS4:1 GS3:1 C4:1 DS4:1 GS4:1 GS3:1 C4:1 DS4:1 GS4:1 GS3:1 C4:1 DS4:1 GS4:1 AS3:1 D4:1 F4:1 AS4:1 AS3:1 D4:1 F4:1 AS4:1 AS3:1 D4:1 F4:1 AS4:1 AS3:1 D4:1 F4:1 AS4:1 G3:1 B3:1 D4:1 F4:1 G3:1 B3:1 D4:1 F4:1 G3:1 B3:1 D4:1 F4:1 G3:1 B3:1 D4:1 F4:1 C4:1 DS4:1 G4:1 C5:1 C4:1 DS4:1 G4:1 C5:1 GS3:1 C4:1 DS4:1 GS4:1 GS3:1 C4:1 DS4:1 GS4:1 AS3:1 D4:1 F4:1 AS4:1 AS3:1 D4:1 F4:1 AS4:1 G3:1 B3:1 D4:1 G4:1 G3:1 B3:1 D4:1 G4:1 C4:2 DS4:2 G4:2 C5:2 C4:2 DS4:2 G4:2 C5:2 GS3:2 C4:2 DS4:2 GS4:2 GS3:2 C4:2 DS4:2 GS4:2 C4:1 DS4:1 G4:1 C5:1 C4:1 DS4:1 G4:1 C5:1 GS3:1 C4:1 DS4:1 GS4:1 GS3:1 C4:1 DS4:1 GS4:1 AS3:1 D4:1 F4:1 AS4:1 AS3:1 D4:1 F4:1 AS4:1 G3:1 B3:1 D4:1 G4:1 G3:1 B3:1 D4:1 G4:1 C4:2 DS4:2 G4:2 C5:2 C4:2 DS4:2 G4:2 C5:2 GS3:2 C4:2 DS4:2 GS4:2 GS3:2 C4:2 DS4:2 GS4:2 C4:2 DS4:2 G4:2 C5:2 C4:2 DS4:2 G4:2 C5:2 DS4:2 G4:2 AS4:2 DS5:2 DS4:2 G4:2 AS4:2 DS5:2 GS3:2 C4:2 DS4:2 GS4:2 GS3:2 C4:2 DS4:2 GS4:2 C4:2 DS4:2 G4:2 C5:2 C4:2 DS4:2 G4:2 C5:2 C4:2 DS4:2 G4:2 C5:2 C4:2 DS4:2 G4:2 C5:2 DS4:2 G4:2 AS4:2 DS5:2 DS4:2 G4:2 AS4:2 DS5:2 GS3:2 C4:2 DS4:2 GS4:2 GS3:2 C4:2 DS4:2 GS4:2 C4:2 DS4:2 G4:2 C5:2 C4:2 DS4:2 G4:2 C5:2"
  TRACK 5, bg_perc, 0, 0, "C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:1 R:1 C2:1 R:1 C2:1 R:1 C2:1 R:1 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:2 R:2 C2:1 R:1 C2:1 R:1 C2:1 R:1 C2:1 R:1 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:2 R:6 C2:4 R:12 C2:4 R:12 C2:4 R:12 C2:4 R:12 C2:4 R:12 C2:4 R:12 C2:4 R:12 C2:4 R:12"
END SONG

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
  was_thrust = 0
  spawn_timer = 0
  spawn_rate = 480
  frame_count = 0

  ' Thrust sound: voice 0 = low rumble, voice 1 = high hiss
  ENVELOPE 0, 8, 0, 100, 20
  ENVELOPE 1, 5, 0, 50, 15

  ' Background music on all 6 voices
  VFILTER 0, 80, 20, FILTER_LP
  VFILTER 1, 80, 20, FILTER_LP
  VFILTER 2, 100, 30, FILTER_LP
  MPLAY bg_music

  SPRITE 0, ship_vecs, 9, 9, 60, 28, SPR_VECTOR, 0, 0, EDGE_WRAP
  SPR_GROUP 0, 1, 2
  SPR_COLL 0, COLL_DETECT

  ' Emitter 0: thrust exhaust (focused cone, short life)
  PFX_SET 0, 25, 8, 5, 0, 0, PFX_LIFE_VAR
  ' Emitter 1: asteroid/ship explosion (1x1, omnidirectional)
  PFX_SET 1, 50, 12, 128, 0, 0, PFX_SPEED_VAR OR PFX_LIFE_VAR

  FOR i = 0 TO 26
    sizes(i) = 0
    ast_inv(i) = 0
  NEXT

  ' Start with one large asteroid in a corner
  spawn_child 1, 110, 5
END SUB

SUB spawn_child(sc_size, sc_x, sc_y)
  ' Find free slot 5-31
  FOR fslot = 5 TO 31
    IF sizes(fslot - 5) = 0 THEN
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
      ' Asteroids: own group 2, collide with bullets(4) + asteroids(2) = mask 6
      SPR_GROUP fslot, 2, 6
      SPR_COLL fslot, COLL_DETECT
      ' Brief invincibility from asteroid-asteroid collision only
      ast_inv(fslot - 5) = 25

      rangle = RAND() AND 255
      rspeed = (RAND() MOD 81) - 40
      SPR_ROT fslot, rangle, rspeed

      sizes(fslot - 5) = sc_size
      ast_count = ast_count + 1
      EXIT FOR
    END IF
  NEXT
END SUB

SUB spawn_random_asteroid()
  ' Pick a random position away from the player
  px, py = SPR_GET(0)

  ' Try up to 5 times to find a spot >25px from player
  FOR attempt = 0 TO 4
    rx = RAND() MOD 128
    ry = RAND() MOD 64
    dx = rx - px
    dy = ry - py
    IF dx < 0 THEN dx = 0 - dx
    IF dy < 0 THEN dy = 0 - dy
    IF dx + dy > 25 THEN
      spawn_child 1, rx, ry
      EXIT FOR
    END IF
  NEXT
END SUB

SUB break_asteroid(slot)
  ax, ay = SPR_GET(slot)
  old_size = sizes(slot - 5)

  ' Explosion at asteroid position
  PFX_POS 1, ax, ay
  PFX_BURST 1, 12

  ' Clear size and destroy sprite
  sizes(slot - 5) = 0
  ast_inv(slot - 5) = 0
  SPR_OFF slot
  ast_count = ast_count - 1

  ' Score by size
  IF old_size = 1 THEN
    score = score + 100
  ELSEIF old_size = 2 THEN
    score = score + 50
  ELSE
    score = score + 25
  END IF

  ' Split if not small (size < 3)
  IF old_size < 3 THEN
    spawn_child old_size + 1, ax - 3, ay
    spawn_child old_size + 1, ax + 3, ay
  END IF
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
      SFX SFX_DEATH, 5
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

  ' Scan asteroid slots 5-31 for hits
  FOR slot = 5 TO 31
    IF sizes(slot - 5) <> 0 THEN
      hit_result = SPR_HIT(slot)
      IF hit_result AND 4 THEN
        hit_index = hit_result SHR 8

        ' Hit by bullet (slots 1-4)?
        IF hit_index >= 1 THEN
          IF hit_index < 5 THEN
            SFX SFX_EXPLODE, 5
            break_asteroid slot
          END IF
        END IF

        ' Hit by another asteroid (slots 5-31)?
        ' Asteroid-asteroid collision (skip if either is invincible or small)
        IF hit_index >= 5 THEN
          IF hit_index <= 31 THEN
            IF ast_inv(slot - 5) = 0 THEN
              IF ast_inv(hit_index - 5) = 0 THEN
                IF sizes(slot - 5) < 3 THEN
                  SFX SFX_HIT, 5
                  IF sizes(hit_index - 5) <> 0 THEN
                    IF sizes(hit_index - 5) < 3 THEN
                      break_asteroid hit_index
                    END IF
                  END IF
                  IF sizes(slot - 5) <> 0 THEN
                    break_asteroid slot
                  END IF
                END IF
              END IF
            END IF
          END IF
        END IF
      END IF
    END IF
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

    ' -- Periodic asteroid spawning (ramps up over time) ----------------
    spawn_timer = spawn_timer + 1
    IF spawn_timer >= spawn_rate THEN
      spawn_timer = 0
      IF ast_count < 27 THEN
        spawn_random_asteroid
      END IF
    END IF

    ' Gradually decrease spawn interval (faster spawning)
    frame_count = frame_count + 1
    IF frame_count MOD 600 = 0 THEN
      IF spawn_rate > 60 THEN
        spawn_rate = spawn_rate - 15
      END IF
    END IF

    ' -- Tick asteroid invincibility timers ------------------------------
    FOR ai = 5 TO 31
      IF ast_inv(ai - 5) > 0 THEN
        ast_inv(ai - 5) = ast_inv(ai - 5) - 1
      END IF
    NEXT

    ' -- Invincibility flash -------------------------------------------
    IF invincible > 0 THEN
      invincible = invincible - 1
      SPR_COLL 0, COLL_NONE

      IF invincible AND 8 THEN
        SPR_VIS 0, 0
      ELSE
        SPR_VIS 0, 1
      END IF
    ELSE
      SPR_VIS 0, 1
      SPR_COLL 0, COLL_DETECT
    END IF

    inp = INPUT()

    ' -- Handle rotation -----------------------------------------------
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
      ex_cos = COS(exhaust_dir)
      IF ex_cos >= 128 THEN ex_cos = ex_cos - 256
      ex_sin = SIN(exhaust_dir)
      IF ex_sin >= 128 THEN ex_sin = ex_sin - 256
      PFX_POS 0, tx + 4 + FX_MUL(ex_cos, 5, 7), ty + 4 + FX_MUL(ex_sin, 5, 7)
      PFX_ON 0, 2

      IF was_thrust = 0 THEN
        was_thrust = 1
        VOICE 0, WAVE_NOISE, 150, 0
        VOICE 1, WAVE_NOISE, 5000, 0
      END IF
    ELSE
      PFX_ON 0, 0

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

        cos_val = COS(thrust_angle)
        IF cos_val < 128 THEN
          bvx = cos_val SHR 1
        ELSE
          bvx = -((256 - cos_val) SHR 1)
        END IF

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
        SFX SFX_LASER, 5

        cooldown = 16
      END IF
    END IF

    ' -- Apply drag: velocity *= 253/256 --------------------------------
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
    TEXT_LG "KESSLER", 40, 15
    TEXT_LG "GAME OVER", 37, 25
    TEXT_NUM score, 52, 40

    IF INPUT() AND INPUT_ENC_BTN THEN EXIT DO

    YIELD
  LOOP
LOOP
