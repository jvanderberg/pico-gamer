; -- Asteroids -------------------------------------------------------
; Ship rotates with encoder, thrusts with BTN, wraps at screen edges.
; Fire bullets with ENC_BTN; bullets destroy asteroids.
; Large->2 medium, medium->2 small, small->gone.

  JMP start

; -- Ship vector data (triangle outline) ----------------------------
; 3 segments in 4.4 signed fixed-point, relative to center (0,0)
; nose=(0,-3), left=(-2,2), right=(2,2)
ship_vecs:
  .data 3
  .data 0x00, 0xD0, 0xE0, 0x20
  .data 0xE0, 0x20, 0x20, 0x20
  .data 0x20, 0x20, 0x00, 0xD0

; Bullet bitmap (2x2 filled square)
bullet_bmp:
  .data 0xC0, 0xC0

; -- Asteroid vector data -------------------------------------------
; Large (5 segments, ~15x15): (0,-7),(6,-2),(5,5),(-5,5),(-6,-2)
ast_large:
  .data 5
  .data 0x00, 0x90, 0x60, 0xE0
  .data 0x60, 0xE0, 0x50, 0x50
  .data 0x50, 0x50, 0xB0, 0x50
  .data 0xB0, 0x50, 0xA0, 0xE0
  .data 0xA0, 0xE0, 0x00, 0x90

; Medium (5 segments, ~9x9): (0,-4),(4,-1),(3,3),(-3,3),(-4,-1)
ast_med:
  .data 5
  .data 0x00, 0xC0, 0x40, 0xF0
  .data 0x40, 0xF0, 0x30, 0x30
  .data 0x30, 0x30, 0xD0, 0x30
  .data 0xD0, 0x30, 0xC0, 0xF0
  .data 0xC0, 0xF0, 0x00, 0xC0

; Small (4 segments, ~5x5): (0,-2),(2,0),(0,2),(-2,0)
ast_small:
  .data 4
  .data 0x00, 0xE0, 0x20, 0x00
  .data 0x20, 0x00, 0x00, 0x20
  .data 0x00, 0x20, 0xE0, 0x00
  .data 0xE0, 0x00, 0x00, 0xE0

; Ship icon for lives HUD (5x5 1-bit row-aligned, matching ship outline)
; ..#..  .#.#.  .#.#.  #...#  #####
ship_icon:
  .data 0x20, 0x50, 0x50, 0x88, 0xF8

; "GAME OVER" null-terminated
str_game_over:
  .data 0x47, 0x41, 0x4D, 0x45, 0x20, 0x4F, 0x56, 0x45, 0x52, 0x00

; -- Memory map -----------------------------------------------------
; 0xC000  2  ship_vx (8.8 signed fixed-point)
; 0xC002  2  ship_vy (8.8 signed fixed-point)
; 0xC004  1  fire cooldown
; 0xC005  1  game_state: 0=playing, 1=game_over
; 0xC007  1  asteroid count
; 0xC009  1  invincibility timer (frames remaining)
; 0xC010  27 asteroid sizes (slots 5-31): 0=off, 1=large, 2=med, 3=small
; 0xC020  1  next bullet slot (cycles 1-4)
; 0xC02B  1  lives (starts at 3)
; 0xC02C  2  score (u16)
; 0xC02E  1  wave (starts at 0)
; 0xC030  6  score_buf (null-terminated ASCII for itoa)
; 0xD050  1  spawn_child: size
; 0xD052  2  spawn_child: x
; 0xD054  2  spawn_child: y

; -- Constants -------------------------------------------------------
; Rotation step per encoder tick: 9 angle units (~12.6 deg)
; Thrust acceleration: 3 in 8.8 (~0.012 px/frame per press)
; Drag: multiply by 250/256 each frame
; Max speed: 384 in 8.8 (1.5 px/frame)
; VEL_DIVISOR=64 in engine, so sprite vx = ship_vx / 4

start:
  ; -- Initialize game state ----------------------------------------
  PUSH8 0
  STORE 0xC000          ; ship_vx = 0
  PUSH8 0
  STORE 0xC002          ; ship_vy = 0
  PUSH8 0
  STORE8 0xC005         ; game_state = 0
  PUSH8 3
  STORE8 0xC02B         ; lives = 3
  PUSH8 0
  STORE 0xC02C          ; score = 0
  PUSH8 0
  STORE8 0xC02E         ; wave = 0
  PUSH8 0
  STORE8 0xC004         ; fire cooldown = 0
  PUSH8 0
  STORE8 0xC009         ; invincibility = 0
  PUSH8 0
  STORE8 0xC020         ; next bullet slot = 0

  ; -- Set up ship sprite (slot 0, vector mode) ---------------------
  PUSH8 0               ; slot
  PUSH16 ship_vecs      ; addr (vector data)
  PUSH8 7               ; width (bounding box)
  PUSH8 7               ; height (bounding box)
  PUSH8 62              ; x (center-ish)
  PUSH8 30              ; y (center-ish)
  PUSH8 4               ; flags = vector mode (bit 2)
  PUSH8 0               ; vx (managed in memory)
  PUSH8 0               ; vy
  PUSH8 1               ; edge = wrap
  SYSCALL 0x40          ; SPR_SET

  ; Ship starts at angle=0 (bitmap tip points up, no rotation needed).
  ; Thrust uses (angle + 192) offset so angle=0 thrusts upward.

  ; -- Ship collision: group=1, mask=2 (hit by asteroids) -----------
  PUSH8 0
  PUSH8 1
  PUSH8 2
  SYSCALL 0x4b          ; SPR_GROUP
  PUSH8 0
  PUSH8 1               ; detect-only
  SYSCALL 0x47          ; SPR_COLL

  ; -- Clear asteroid sizes and spawn first wave --------------------
  PUSH8 0
  STORE8 0xC007         ; asteroid_count = 0
  PUSH8 0
  STORE 0xD000          ; i = 0
clear_sizes:
  LOAD 0xD000
  PUSH8 27
  LT
  JZ clear_done
  LOAD 0xD000
  PUSH16 0xC010
  ADD
  PUSH8 0
  SWAP
  STORE8_IDX
  LOAD 0xD000
  PUSH8 1
  ADD
  STORE 0xD000
  JMP clear_sizes
clear_done:
  CALL spawn_wave

; -- Main loop -------------------------------------------------------
main_loop:
  ; -- Check game state --
  LOAD8 0xC005
  PUSH8 1
  EQ
  JNZ game_over

  CALL check_collisions

  ; -- Check if all asteroids destroyed -> next wave --
  LOAD8 0xC007
  PUSH8 0
  EQ
  JZ no_new_wave
  CALL spawn_wave
no_new_wave:

  ; -- Invincibility flash -------------------------------------------
  LOAD8 0xC009
  PUSH8 0
  GT
  JZ not_invincible

  ; Decrement timer
  LOAD8 0xC009
  PUSH8 1
  SUB
  STORE8 0xC009

  ; Disable ship collision
  PUSH8 0
  PUSH8 0               ; spriteMode = none
  SYSCALL 0x47

  ; Flash: hide ship when (timer & 4) != 0
  LOAD8 0xC009
  PUSH8 4
  AND
  JZ flash_show
  ; Hide: set ship vector segment count to 0
  PUSH8 0
  PUSH16 ship_vecs
  STORE8_IDX
  JMP flash_done
flash_show:
  ; Show: restore segment count to 3
  PUSH8 3
  PUSH16 ship_vecs
  STORE8_IDX
  JMP flash_done

not_invincible:
  ; Ensure ship visible + collision on
  PUSH8 3
  PUSH16 ship_vecs
  STORE8_IDX
  PUSH8 0
  PUSH8 1               ; spriteMode = detect-only
  SYSCALL 0x47

flash_done:
  SYSCALL 0x10          ; INPUT -> bits on stack

  ; -- Handle rotation -----------------------------------------------
  ; Check ENC_CW (bit 5) -> rotate clockwise (+9)
  DUP
  PUSH8 32              ; 1 << 5
  AND
  JZ not_cw
  ; Get current angle
  PUSH8 0
  SYSCALL 0x4e          ; SPR_GETROT -> angle
  PUSH8 9
  ADD                   ; angle + 9
  PUSH16 255
  AND                   ; mask to 0-255
  STORE 0xD010          ; save new angle
  PUSH8 0               ; slot
  LOAD 0xD010           ; angle
  PUSH8 0               ; rotSpeed
  SYSCALL 0x4d          ; SPR_ROT
not_cw:

  ; Check ENC_CCW (bit 6) -> rotate counter-clockwise (-9)
  DUP
  PUSH8 64              ; 1 << 6
  AND
  JZ not_ccw
  PUSH8 0
  SYSCALL 0x4e          ; SPR_GETROT -> angle
  PUSH8 9
  SUB                   ; angle - 9
  PUSH16 255
  AND                   ; mask to 0-255
  STORE 0xD010
  PUSH8 0               ; slot
  LOAD 0xD010
  PUSH8 0
  SYSCALL 0x4d          ; SPR_ROT
not_ccw:

  ; -- Handle thrust (BTN = bit 4) -----------------------------------
  ; If BTN held: accelerate in facing direction
  DUP
  PUSH8 16              ; 1 << 4
  AND
  JZ not_thrust

  ; Get ship angle and offset by 192 so bitmap-up (angle=0) = math-up
  PUSH8 0
  SYSCALL 0x4e          ; SPR_GETROT -> angle (0-255)
  PUSH8 192
  ADD
  PUSH16 255
  AND                   ; thrust_angle = (angle + 192) & 255
  STORE 0xD010          ; save thrust_angle

  ; cos(thrust_angle)
  LOAD 0xD010
  SYSCALL 0x23          ; SYS_COS -> cos value (0-255)
  STORE 0xD012          ; save cos

  ; sin(thrust_angle)
  LOAD 0xD010
  SYSCALL 0x22          ; SYS_SIN -> sin value
  STORE 0xD014          ; save sin

  ; Thrust: accelerate ship in facing direction.
  ; sin/cos values are 0-127 (positive) or 128-255 (negative, magnitude = 256-val).
  ; delta = magnitude * 5 / 32 ~ max 20 in 8.8 (~ 0.08 px/frame).
  ; Negate delta if sin/cos was negative.

  ; -- Apply cos to ship_vx ----------
  LOAD 0xD012           ; cos (0-255 unsigned byte)
  DUP
  PUSH8 128
  LT                    ; cos < 128 -> positive
  JZ cos_neg
  ; Positive: delta = cos * 5 >> 5
  PUSH8 5
  MUL
  PUSH8 5
  SHR
  STORE 0xD016          ; delta_vx (positive)
  JMP cos_apply
cos_neg:
  ; Negative: magnitude = 256 - cos, delta = -(mag * 5 >> 5)
  PUSH16 256
  SWAP
  SUB                   ; 256 - cos = magnitude
  PUSH8 5
  MUL
  PUSH8 5
  SHR
  NEG                   ; negate -> u16 two's complement
  STORE 0xD016
cos_apply:
  LOAD 0xC000
  LOAD 0xD016
  ADD
  STORE 0xC000

  ; -- Apply sin to ship_vy ----------
  LOAD 0xD014           ; sin (0-255)
  DUP
  PUSH8 128
  LT
  JZ sin_neg
  PUSH8 5
  MUL
  PUSH8 5
  SHR
  STORE 0xD016
  JMP sin_apply
sin_neg:
  PUSH16 256
  SWAP
  SUB
  PUSH8 5
  MUL
  PUSH8 5
  SHR
  NEG
  STORE 0xD016
sin_apply:
  LOAD 0xC002
  LOAD 0xD016
  ADD
  STORE 0xC002

not_thrust:

  ; -- Handle fire (ENC_BTN = bit 7) ---------------------------------
  DUP
  PUSH8 128
  AND
  JZ not_fire

  ; Check cooldown
  LOAD8 0xC004
  PUSH8 0
  GT
  JNZ not_fire

  ; Get ship position
  PUSH8 0
  SYSCALL 0x43          ; SPR_GET -> x, y
  STORE 0xD032          ; y
  STORE 0xD030          ; x

  ; Center offset (ship 7x7 -> bullet starts at center)
  LOAD 0xD030
  PUSH8 2
  ADD
  STORE 0xD030
  LOAD 0xD032
  PUSH8 2
  ADD
  STORE 0xD032

  ; Get ship angle, offset for upward=0
  PUSH8 0
  SYSCALL 0x4e          ; SPR_GETROT -> angle
  PUSH8 192
  ADD
  PUSH16 255
  AND
  STORE 0xD010          ; thrust_angle

  ; Bullet vx = cos(angle) scaled to speed
  LOAD 0xD010
  SYSCALL 0x23          ; SYS_COS -> cos value
  DUP
  PUSH8 128
  LT
  JZ bvx_neg
  PUSH8 1
  SHR
  STORE 0xD034
  JMP bvx_done
bvx_neg:
  PUSH16 256
  SWAP
  SUB
  PUSH8 1
  SHR
  NEG
  STORE 0xD034
bvx_done:

  ; Bullet vy = sin(angle) scaled to speed
  LOAD 0xD010
  SYSCALL 0x22          ; SYS_SIN -> sin value
  DUP
  PUSH8 128
  LT
  JZ bvy_neg
  PUSH8 1
  SHR
  STORE 0xD036
  JMP bvy_done
bvy_neg:
  PUSH16 256
  SWAP
  SUB
  PUSH8 1
  SHR
  NEG
  STORE 0xD036
bvy_done:

  ; Cycle bullet slot 1->2->3->4->1
  LOAD8 0xC020
  DUP
  PUSH8 0
  EQ
  JZ bslot_ok
  POP
  PUSH8 1
bslot_ok:
  DUP
  STORE 0xD038          ; current slot
  PUSH8 4
  MOD
  PUSH8 1
  ADD
  STORE8 0xC020         ; next slot

  ; Create bullet sprite
  LOAD 0xD038           ; slot
  PUSH16 bullet_bmp     ; addr
  PUSH8 2               ; width
  PUSH8 2               ; height
  LOAD 0xD030           ; x
  LOAD 0xD032           ; y
  PUSH8 0               ; flags
  LOAD 0xD034           ; vx
  LOAD 0xD036           ; vy
  PUSH8 3               ; edge = destroy off-screen
  SYSCALL 0x40          ; SPR_SET

  ; Bullet collision: group=4, mask=2 (hits asteroids), destroy on hit
  LOAD 0xD038
  PUSH8 4
  PUSH8 2
  SYSCALL 0x4b          ; SPR_GROUP
  LOAD 0xD038
  PUSH8 3               ; destroy
  SYSCALL 0x47          ; SPR_COLL

  ; Set cooldown
  PUSH8 8
  STORE8 0xC004

not_fire:

  POP                   ; discard remaining input bits

  ; -- Apply drag: velocity *= 250/256 --------------------------------
  ; ship_vx -= ship_vx >> 5 (arithmetic shift for signed)

  LOAD 0xC000           ; ship_vx (signed as u16)
  DUP
  ; Arithmetic right shift by 5 for signed value
  DUP
  PUSH16 0x8000
  AND                   ; sign bit
  JZ vx_drag_pos
  ; Negative: shift and OR sign bits back
  PUSH8 5
  SHR                   ; logical shift right
  PUSH16 0xFFE0         ; top 11 bits set (sign extension for >>5)
  OR
  JMP vx_drag_done
vx_drag_pos:
  PUSH8 5
  SHR                   ; vx >> 5
  PUSH8 1
  OR                    ; ensure drag >= 1 so ship eventually stops
vx_drag_done:
  SUB                   ; vx - vx/32
  STORE 0xC000

  ; Same for vy
  LOAD 0xC002
  DUP
  DUP
  PUSH16 0x8000
  AND
  JZ vy_drag_pos
  PUSH8 5
  SHR
  PUSH16 0xFFE0
  OR
  JMP vy_drag_done
vy_drag_pos:
  PUSH8 5
  SHR
  PUSH8 1
  OR                    ; ensure drag >= 1
vy_drag_done:
  SUB
  STORE 0xC002

  ; -- Convert 8.8 velocity to sprite velocity (/4) ------------------
  ; sprite_vx = ship_vx >> 2 (arithmetic)

  LOAD 0xC000           ; ship_vx
  DUP
  PUSH16 0x8000
  AND
  JZ svx_pos
  PUSH8 2
  SHR
  PUSH16 0xC000         ; sign extension for >>2
  OR
  JMP svx_done
svx_pos:
  PUSH8 2
  SHR
svx_done:
  STORE 0xD020          ; sprite_vx

  LOAD 0xC002           ; ship_vy
  DUP
  PUSH16 0x8000
  AND
  JZ svy_pos
  PUSH8 2
  SHR
  PUSH16 0xC000
  OR
  JMP svy_done
svy_pos:
  PUSH8 2
  SHR
svy_done:
  STORE 0xD022          ; sprite_vy

  ; SPR_VEL(0, sprite_vx, sprite_vy)
  PUSH8 0               ; slot
  LOAD 0xD020           ; vx
  LOAD 0xD022           ; vy
  SYSCALL 0x42          ; SPR_VEL

  ; -- Decrement fire cooldown ----------------------------------------
  LOAD8 0xC004
  PUSH8 0
  GT
  JZ cooldown_done
  LOAD8 0xC004
  PUSH8 1
  SUB
  STORE8 0xC004
cooldown_done:

  CALL draw_hud
  SYSCALL 0x06          ; YIELD
  JMP main_loop

; ====================================================================
; Subroutines
; ====================================================================

; -- check_collisions: check ship + asteroid hits --------------------
check_collisions:
  ; -- Check if ship was hit by asteroid (skip if invincible) --
  LOAD8 0xC009
  PUSH8 0
  GT
  JNZ ship_ok           ; invincible, skip hit check

  PUSH8 0
  SYSCALL 0x4a          ; SPR_HIT(0) -> hitFlags
  PUSH8 4
  AND                   ; sprite collision?
  JZ ship_ok

  ; Ship hit! Decrement lives
  LOAD8 0xC02B
  PUSH8 1
  SUB
  STORE8 0xC02B         ; lives--
  LOAD8 0xC02B
  PUSH8 0
  EQ
  JZ ship_respawn       ; lives > 0 -> respawn
  ; No lives left -> game over
  PUSH8 1
  STORE8 0xC005         ; game_state = 1
  JMP ship_ok

ship_respawn:
  ; Reset position and velocity, start invincibility
  PUSH8 0
  PUSH8 62
  PUSH8 30
  SYSCALL 0x41          ; SPR_POS(0, 62, 30)
  PUSH8 0
  PUSH8 0
  PUSH8 0
  SYSCALL 0x42          ; SPR_VEL(0, 0, 0)
  PUSH8 0
  STORE 0xC000          ; ship_vx = 0
  PUSH8 0
  STORE 0xC002          ; ship_vy = 0
  PUSH8 0
  PUSH8 0
  PUSH8 0
  SYSCALL 0x4d          ; SPR_ROT(0, 0, 0) -- reset angle
  PUSH8 120
  STORE8 0xC009         ; invincibility = 120 frames (2 sec)

ship_ok:
  ; -- Scan asteroid slots 5-31 for bullet hits --
  PUSH8 5
  STORE 0xD040          ; current slot
cc_loop:
  LOAD 0xD040
  PUSH8 32
  LT
  JZ cc_done

  ; Is this slot active? Check size array
  LOAD 0xD040
  PUSH8 5
  SUB
  PUSH16 0xC010
  ADD
  LOAD8_IDX             ; sizes[slot-5]
  PUSH8 0
  EQ
  JNZ cc_next           ; inactive, skip

  ; SPR_HIT for this slot
  LOAD 0xD040
  SYSCALL 0x4a          ; -> (hitIndex<<8)|hitFlags
  STORE 0xD042          ; save hit result

  ; Check sprite-collision bit
  LOAD 0xD042
  PUSH8 4
  AND
  JZ cc_next

  ; Verify collider is a bullet (slot 1-4), not the ship
  LOAD 0xD042
  PUSH8 8
  SHR                   ; hitIndex
  PUSH8 1
  LT                    ; hitIndex < 1? (ship)
  JNZ cc_next
  LOAD 0xD042
  PUSH8 8
  SHR
  PUSH8 5
  LT                    ; hitIndex < 5? (bullet range)
  JZ cc_next

  ; -- Hit! Get position before destroying --
  LOAD 0xD040
  SYSCALL 0x43          ; SPR_GET -> x, y
  STORE 0xD054          ; y
  STORE 0xD052          ; x

  ; Read current size
  LOAD 0xD040
  PUSH8 5
  SUB
  DUP
  PUSH16 0xC010
  ADD
  LOAD8_IDX             ; size
  STORE 0xD044          ; save size

  ; Clear size entry
  PUSH16 0xC010
  ADD
  PUSH8 0
  SWAP
  STORE8_IDX

  ; Destroy sprite
  LOAD 0xD040
  SYSCALL 0x44          ; SPR_OFF

  ; asteroid_count--
  LOAD8 0xC007
  PUSH8 1
  SUB
  STORE8 0xC007

  ; Add score for destroyed asteroid
  CALL add_score

  ; Split if not small (size < 3)
  LOAD 0xD044
  PUSH8 3
  LT
  JZ cc_next            ; small, no children

  ; Child size
  LOAD 0xD044
  PUSH8 1
  ADD
  STORE8 0xD050         ; child size

  ; Spawn child 1 (offset x-3)
  LOAD 0xD052
  PUSH8 3
  SUB
  STORE 0xD052
  CALL spawn_child

  ; Spawn child 2 (offset x+6 from child1 = original+3)
  LOAD 0xD052
  PUSH8 6
  ADD
  STORE 0xD052
  CALL spawn_child

cc_next:
  LOAD 0xD040
  PUSH8 1
  ADD
  STORE 0xD040
  JMP cc_loop
cc_done:
  RET

; -- spawn_child: create asteroid from scratch vars ------------------
; Reads: 0xD050=size, 0xD052=x, 0xD054=y
spawn_child:
  ; Find free slot 5-31
  PUSH8 5
  STORE 0xD056
sc_find:
  LOAD 0xD056
  PUSH8 32
  LT
  JZ sc_none            ; all full

  LOAD 0xD056
  PUSH8 5
  SUB
  PUSH16 0xC010
  ADD
  LOAD8_IDX
  PUSH8 0
  EQ
  JNZ sc_found

  LOAD 0xD056
  PUSH8 1
  ADD
  STORE 0xD056
  JMP sc_find

sc_found:
  ; Pick vector addr + bbox by size
  LOAD8 0xD050
  PUSH8 1
  EQ
  JZ sc_not_large
  ; Large
  PUSH16 ast_large
  STORE 0xD058
  PUSH8 15
  STORE8 0xD05A
  JMP sc_do
sc_not_large:
  LOAD8 0xD050
  PUSH8 2
  EQ
  JZ sc_small
  ; Medium
  PUSH16 ast_med
  STORE 0xD058
  PUSH8 9
  STORE8 0xD05A
  JMP sc_do
sc_small:
  PUSH16 ast_small
  STORE 0xD058
  PUSH8 5
  STORE8 0xD05A

sc_do:
  ; Random velocity -18..18
  SYSCALL 0x20
  PUSH8 37
  MOD
  PUSH8 18
  SUB
  STORE 0xD05C
  SYSCALL 0x20
  PUSH8 37
  MOD
  PUSH8 18
  SUB
  STORE 0xD05E

  ; SPR_SET
  LOAD 0xD056
  LOAD 0xD058
  LOAD8 0xD05A
  LOAD8 0xD05A
  LOAD 0xD052
  LOAD 0xD054
  PUSH8 4               ; vector
  LOAD 0xD05C
  LOAD 0xD05E
  PUSH8 1               ; wrap
  SYSCALL 0x40

  ; Collision groups
  LOAD 0xD056
  PUSH8 2
  PUSH8 4
  SYSCALL 0x4b
  LOAD 0xD056
  PUSH8 1
  SYSCALL 0x47

  ; Random angle + random rotSpeed (-20..20)
  SYSCALL 0x20
  PUSH16 255
  AND
  STORE 0xD010
  SYSCALL 0x20
  PUSH8 81
  MOD
  PUSH8 40
  SUB
  STORE 0xD05E          ; rotSpeed (-40..40)
  LOAD 0xD056
  LOAD 0xD010
  LOAD 0xD05E
  SYSCALL 0x4d

  ; Mark size
  LOAD 0xD056
  PUSH8 5
  SUB
  PUSH16 0xC010
  ADD
  LOAD8 0xD050
  SWAP
  STORE8_IDX

  ; asteroid_count++
  LOAD8 0xC007
  PUSH8 1
  ADD
  STORE8 0xC007

sc_none:
  RET

; -- spawn_wave: increment wave and spawn asteroids ------------------
spawn_wave:
  ; wave++
  LOAD8 0xC02E
  PUSH8 1
  ADD
  STORE8 0xC02E

  ; count = min(3 + wave, 27)
  LOAD8 0xC02E
  PUSH8 3
  ADD
  DUP
  PUSH8 27
  GT
  JZ sw_count_ok
  POP
  PUSH8 27
sw_count_ok:
  STORE 0xD000          ; count

  PUSH8 0
  STORE 0xD002          ; i = 0
sw_loop:
  LOAD 0xD002
  LOAD 0xD000
  LT
  JZ sw_done

  ; size = 1 (large)
  PUSH8 1
  STORE8 0xD050

  ; Random x: edge (5 or 110)
  SYSCALL 0x20
  PUSH8 2
  MOD
  JZ sw_right
  PUSH8 5
  JMP sw_x_ok
sw_right:
  PUSH8 110
sw_x_ok:
  STORE 0xD052

  ; Random y: 5 + rand % 50
  SYSCALL 0x20
  PUSH8 50
  MOD
  PUSH8 5
  ADD
  STORE 0xD054

  CALL spawn_child

  ; i++
  LOAD 0xD002
  PUSH8 1
  ADD
  STORE 0xD002
  JMP sw_loop
sw_done:
  RET

; -- add_score: add points for destroyed asteroid --------------------
; Reads size from 0xD044
add_score:
  LOAD8 0xD044
  DUP
  PUSH8 1
  EQ
  JZ as_not_large
  POP
  PUSH8 100
  JMP as_add
as_not_large:
  DUP
  PUSH8 2
  EQ
  JZ as_small
  POP
  PUSH8 50
  JMP as_add
as_small:
  POP
  PUSH8 25
as_add:
  LOAD 0xC02C
  ADD
  STORE 0xC02C
  RET

; -- draw_hud: score and lives display --------------------------------
draw_hud:
  CALL itoa

  ; Draw score at top-left
  PUSH16 0xC030
  PUSH8 1
  PUSH8 1
  SYSCALL 0x24          ; TEXT_SM

  ; Draw lives icons at top-right
  PUSH8 0
  STORE 0xD060          ; i = 0
dh_loop:
  LOAD 0xD060
  LOAD8 0xC02B
  LT
  JZ dh_done

  ; x = 122 - 6*i
  LOAD 0xD060
  PUSH8 6
  MUL
  STORE 0xD062
  PUSH8 122
  LOAD 0xD062
  SUB
  STORE 0xD062

  ; BLIT ship_icon at (x, 1), 5x5
  PUSH16 ship_icon
  LOAD 0xD062
  PUSH8 1
  PUSH8 5
  PUSH8 5
  SYSCALL 0x05          ; BLIT

  ; i++
  LOAD 0xD060
  PUSH8 1
  ADD
  STORE 0xD060
  JMP dh_loop
dh_done:
  RET

; -- itoa: convert score u16 -> ASCII at 0xC030 ----------------------
; Uses scratch 0xD070-0xD076
itoa:
  LOAD 0xC02C
  STORE 0xD070          ; working value
  PUSH8 0
  STORE8 0xD072         ; leading = 0
  PUSH16 0xC030
  STORE 0xD074          ; output pointer

  ; -- 10000s --
  LOAD 0xD070
  PUSH16 10000
  DIV
  STORE8 0xD076
  LOAD 0xD070
  PUSH16 10000
  MOD
  STORE 0xD070

  LOAD8 0xD076
  LOAD8 0xD072
  OR
  JZ itoa_s1000
  LOAD8 0xD076
  PUSH8 0x30
  ADD
  LOAD 0xD074
  STORE8_IDX
  LOAD 0xD074
  PUSH8 1
  ADD
  STORE 0xD074
  PUSH8 1
  STORE8 0xD072
itoa_s1000:

  ; -- 1000s --
  LOAD 0xD070
  PUSH16 1000
  DIV
  STORE8 0xD076
  LOAD 0xD070
  PUSH16 1000
  MOD
  STORE 0xD070

  LOAD8 0xD076
  LOAD8 0xD072
  OR
  JZ itoa_s100
  LOAD8 0xD076
  PUSH8 0x30
  ADD
  LOAD 0xD074
  STORE8_IDX
  LOAD 0xD074
  PUSH8 1
  ADD
  STORE 0xD074
  PUSH8 1
  STORE8 0xD072
itoa_s100:

  ; -- 100s --
  LOAD 0xD070
  PUSH8 100
  DIV
  STORE8 0xD076
  LOAD 0xD070
  PUSH8 100
  MOD
  STORE 0xD070

  LOAD8 0xD076
  LOAD8 0xD072
  OR
  JZ itoa_s10
  LOAD8 0xD076
  PUSH8 0x30
  ADD
  LOAD 0xD074
  STORE8_IDX
  LOAD 0xD074
  PUSH8 1
  ADD
  STORE 0xD074
  PUSH8 1
  STORE8 0xD072
itoa_s10:

  ; -- 10s --
  LOAD 0xD070
  PUSH8 10
  DIV
  STORE8 0xD076
  LOAD 0xD070
  PUSH8 10
  MOD
  STORE 0xD070

  LOAD8 0xD076
  LOAD8 0xD072
  OR
  JZ itoa_s1
  LOAD8 0xD076
  PUSH8 0x30
  ADD
  LOAD 0xD074
  STORE8_IDX
  LOAD 0xD074
  PUSH8 1
  ADD
  STORE 0xD074
itoa_s1:

  ; -- 1s (always written) --
  LOAD 0xD070
  PUSH8 0x30
  ADD
  LOAD 0xD074
  STORE8_IDX
  LOAD 0xD074
  PUSH8 1
  ADD
  STORE 0xD074

  ; Null terminator
  PUSH8 0
  LOAD 0xD074
  STORE8_IDX
  RET

; -- game_over: end screen with score --------------------------------
game_over:
  ; Disable all sprites (slots 0-31)
  PUSH8 0
  STORE 0xD060
go_disable:
  LOAD 0xD060
  PUSH8 32
  LT
  JZ go_loop
  LOAD 0xD060
  SYSCALL 0x44          ; SPR_OFF
  LOAD 0xD060
  PUSH8 1
  ADD
  STORE 0xD060
  JMP go_disable

go_loop:
  ; Draw "GAME OVER" centered
  PUSH16 str_game_over
  PUSH8 37
  PUSH8 20
  SYSCALL 0x25          ; TEXT_LG

  ; Draw score
  CALL itoa
  PUSH16 0xC030
  PUSH8 52
  PUSH8 35
  SYSCALL 0x24          ; TEXT_SM

  ; Check fire button -> restart
  SYSCALL 0x10
  PUSH8 128
  AND
  JNZ go_restart

  SYSCALL 0x06          ; YIELD
  JMP go_loop

go_restart:
  JMP start
