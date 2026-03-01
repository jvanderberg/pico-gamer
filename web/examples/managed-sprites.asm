; Managed Sprites — collision groups, detect-only & hit callbacks
; Two visible wall barriers; sprites with different collision groups.
;
; Sprite 0 (big circle 16x16): group=0x01, bounces off walls + screen edges
; Sprite 1 (diamond 8x8):      group=0x02, wraps at edges, passes through walls
; Sprite 2 (small diamond 4x4): group=0x01, mask=0x01 — stops at walls,
;                                bounces off big circle (same group),
;                                ignores diamond (different group)
; Sprite 3 (square 8x8):       group=0x01, spriteMode=1 (detect-only) +
;                                hit callback that teleports on collision
; Sprite 4 (tall bar 4x12):    group=0x02, destroys on wall contact

  JMP start

; --- 16x16 big circle (32 bytes) ---
big_circle:
  .data 0x07, 0xE0, 0x1F, 0xF8, 0x3F, 0xFC, 0x7F, 0xFE
  .data 0x7F, 0xFE, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF
  .data 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x7F, 0xFE
  .data 0x7F, 0xFE, 0x3F, 0xFC, 0x1F, 0xF8, 0x07, 0xE0

; --- 8x8 diamond ---
diamond_gfx:
  .data 0x18, 0x3C, 0x7E, 0xFF, 0xFF, 0x7E, 0x3C, 0x18

; --- 8x8 hollow square ---
square_gfx:
  .data 0xFF, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0xFF

; --- 4x4 small diamond (top 4 bits used) ---
sm_diamond:
  .data 0x60, 0xF0, 0xF0, 0x60

; --- 4x12 tall bar ---
tall_bar:
  .data 0xF0, 0xF0, 0xF0, 0xF0, 0xF0, 0xF0
  .data 0xF0, 0xF0, 0xF0, 0xF0, 0xF0, 0xF0

; --- Hit callback: teleport square to random position ---
; Uses scratch memory at 0xD010-0xD016 for temporaries.
square_hit:
  ; On entry: [..., slot, returnAddr]
  STORE 0xD010          ; save returnAddr
  STORE 0xD012          ; save slot
  ; Generate random X
  SYSCALL 0x20          ; RAND
  PUSH8 112
  MOD                   ; x = rand % 112
  STORE 0xD014          ; save x
  ; Generate random Y
  SYSCALL 0x20          ; RAND
  PUSH8 48
  MOD                   ; y = rand % 48
  STORE 0xD016          ; save y
  ; Call SPR_POS(slot, x, y)
  LOAD 0xD012           ; slot
  LOAD 0xD014           ; x
  LOAD 0xD016           ; y
  SYSCALL 0x41          ; SPR_POS
  ; Return
  LOAD 0xD010           ; push returnAddr
  RET

start:
  ; --- Set up two walls (invisible collision geometry) ---
  ; Wall 0: left barrier at x=30, full height
  PUSH8 0               ; slot
  PUSH8 30              ; x
  PUSH8 0               ; y
  PUSH8 4               ; w
  PUSH8 64              ; h
  SYSCALL 0x48          ; WALL_SET

  ; Wall 1: right barrier at x=94, full height
  PUSH8 1               ; slot
  PUSH8 94              ; x
  PUSH8 0               ; y
  PUSH8 4               ; w
  PUSH8 64              ; h
  SYSCALL 0x48          ; WALL_SET

  ; --- Sprite 0: Big circle (16x16) group=0x01, bounces off walls + screen ---
  PUSH8 0               ; slot
  PUSH16 big_circle     ; addr
  PUSH8 16              ; width
  PUSH8 16              ; height
  PUSH8 50              ; x (between walls)
  PUSH8 10              ; y
  PUSH8 0               ; flags
  PUSH8 32              ; vx = 0.5 px/frame
  PUSH8 48              ; vy = 0.75 px/frame
  PUSH8 2               ; edge = bounce
  SYSCALL 0x40          ; SPR_SET
  PUSH8 0               ; slot
  PUSH8 2               ; wallMode = bounce
  SYSCALL 0x46          ; SPR_WALL
  PUSH8 0               ; slot
  PUSH8 2               ; spriteMode = bounce
  SYSCALL 0x47          ; SPR_COLL
  PUSH8 0               ; slot
  PUSH8 1               ; collGroup = 0x01
  PUSH8 0xFF            ; collMask = 0xFF (collides with everything)
  SYSCALL 0x4b          ; SPR_GROUP

  ; --- Sprite 1: Diamond (8x8) group=0x02, wraps at edges, no walls ---
  PUSH8 1               ; slot
  PUSH16 diamond_gfx    ; addr
  PUSH8 8               ; width
  PUSH8 8               ; height
  PUSH8 60              ; x
  PUSH8 5               ; y
  PUSH8 0               ; flags
  PUSH8 128             ; vx = 2 px/frame
  PUSH16 0xFFC0         ; vy = -1 px/frame
  PUSH8 1               ; edge = wrap
  SYSCALL 0x40          ; SPR_SET
  PUSH8 1               ; slot
  PUSH8 2               ; spriteMode = bounce
  SYSCALL 0x47          ; SPR_COLL
  PUSH8 1               ; slot
  PUSH8 2               ; collGroup = 0x02
  PUSH8 0xFF            ; collMask = 0xFF
  SYSCALL 0x4b          ; SPR_GROUP

  ; --- Sprite 2: Small diamond (4x4) group=0x01, mask=0x01 ---
  ; Bounces off big circle (group 0x01), ignores diamond (group 0x02)
  PUSH8 2               ; slot
  PUSH16 sm_diamond     ; addr
  PUSH8 4               ; width
  PUSH8 4               ; height
  PUSH8 50              ; x
  PUSH8 5               ; y
  PUSH8 0               ; flags
  PUSH8 96              ; vx = 1.5 px/frame
  PUSH8 48              ; vy = 0.75 px/frame
  PUSH8 2               ; edge = bounce
  SYSCALL 0x40          ; SPR_SET
  PUSH8 2               ; slot
  PUSH8 4               ; wallMode = stop
  SYSCALL 0x46          ; SPR_WALL
  PUSH8 2               ; slot
  PUSH8 2               ; spriteMode = bounce
  SYSCALL 0x47          ; SPR_COLL
  PUSH8 2               ; slot
  PUSH8 1               ; collGroup = 0x01
  PUSH8 1               ; collMask = 0x01 (only collides with group 0x01)
  SYSCALL 0x4b          ; SPR_GROUP

  ; --- Sprite 3: Square (8x8) group=0x01, detect-only + hit callback ---
  PUSH8 3               ; slot
  PUSH16 square_gfx     ; addr
  PUSH8 8               ; width
  PUSH8 8               ; height
  PUSH8 60              ; x
  PUSH8 40              ; y
  PUSH8 0               ; flags
  PUSH16 0xFFC0         ; vx = -1 px/frame
  PUSH16 0xFFC0         ; vy = -1 px/frame
  PUSH8 2               ; edge = bounce
  SYSCALL 0x40          ; SPR_SET
  PUSH8 3               ; slot
  PUSH8 1               ; spriteMode = 1 (detect-only)
  SYSCALL 0x47          ; SPR_COLL
  PUSH8 3               ; slot
  PUSH8 1               ; collGroup = 0x01
  PUSH8 0xFF            ; collMask = 0xFF
  SYSCALL 0x4b          ; SPR_GROUP
  PUSH8 3               ; slot
  PUSH16 square_hit     ; callback addr
  SYSCALL 0x4c          ; SPR_ON_HIT

  ; --- Sprite 4: Tall bar (4x12) group=0x02, destroys on wall contact ---
  PUSH8 4               ; slot
  PUSH16 tall_bar       ; addr
  PUSH8 4               ; width
  PUSH8 12              ; height
  PUSH8 40              ; x (between the walls)
  PUSH8 26              ; y
  PUSH8 0               ; flags
  PUSH8 64              ; vx = 1 px/frame
  PUSH8 0               ; vy = 0
  PUSH8 0               ; edge = none
  SYSCALL 0x40          ; SPR_SET
  PUSH8 4               ; slot
  PUSH8 3               ; wallMode = destroy
  SYSCALL 0x46          ; SPR_WALL
  PUSH8 4               ; slot
  PUSH8 2               ; collGroup = 0x02
  PUSH8 0xFF            ; collMask = 0xFF
  SYSCALL 0x4b          ; SPR_GROUP

loop:
  ; Draw visible wall rectangles each frame
  PUSH8 30              ; x
  PUSH8 0               ; y
  PUSH8 4               ; w
  PUSH8 64              ; h
  SYSCALL 0x03          ; SYS_RECT (left wall)

  PUSH8 94              ; x
  PUSH8 0               ; y
  PUSH8 4               ; w
  PUSH8 64              ; h
  SYSCALL 0x03          ; SYS_RECT (right wall)

  SYSCALL 0x06          ; SYS_YIELD
  JMP loop
