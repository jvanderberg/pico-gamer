; Move a 4x4 block with arrow keys / WASD
; 0xD000 = x, 0xD002 = y

  PUSH8 60
  STORE 0xD000          ; x = 60
  PUSH8 28
  STORE 0xD002          ; y = 28

main_loop:
  ; Read input
  SYSCALL 0x10          ; SYS_INPUT -> bitfield on stack

  ; Check UP (bit 0)
  DUP
  PUSH8 1
  AND
  JZ not_up
  LOAD 0xD002
  PUSH8 1
  SUB
  STORE 0xD002
not_up:

  ; Check DOWN (bit 1)
  DUP
  PUSH8 2
  AND
  JZ not_down
  LOAD 0xD002
  PUSH8 1
  ADD
  STORE 0xD002
not_down:

  ; Check LEFT (bit 2)
  DUP
  PUSH8 4
  AND
  JZ not_left
  LOAD 0xD000
  PUSH8 1
  SUB
  STORE 0xD000
not_left:

  ; Check RIGHT (bit 3)
  DUP
  PUSH8 8
  AND
  JZ not_right
  LOAD 0xD000
  PUSH8 1
  ADD
  STORE 0xD000
not_right:

  POP                   ; discard remaining input bitfield

  ; Draw block at (x, y)
  LOAD 0xD000
  LOAD 0xD002
  PUSH8 4
  PUSH8 4
  SYSCALL 0x03          ; SYS_RECT

  SYSCALL 0x06          ; SYS_YIELD
  JMP main_loop
