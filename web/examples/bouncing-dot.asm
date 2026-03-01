; Bouncing dot — a single 1x1 pixel sprite with bounce edge mode
; The engine handles movement and bouncing automatically

  JMP start

dot_gfx:
  .data 0x80

start:
  PUSH8 0               ; slot
  PUSH16 dot_gfx        ; addr
  PUSH8 1               ; width
  PUSH8 1               ; height
  PUSH8 10              ; x
  PUSH8 5               ; y
  PUSH8 0               ; flags
  PUSH8 64              ; vx = 64 (1 px/frame)
  PUSH8 64              ; vy = 64 (1 px/frame)
  PUSH8 2               ; edge = bounce
  SYSCALL 0x40          ; SYS_SPR_SET

loop:
  SYSCALL 0x06          ; SYS_YIELD
  JMP loop
