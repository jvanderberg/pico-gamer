; Draw some rectangles to test drawing syscalls

  ; Draw a border rectangle
  PUSH8 0               ; x
  PUSH8 0               ; y
  PUSH8 128             ; w (NOTE: wraps — that's fine for u8)
  PUSH8 64              ; h
  SYSCALL 0x03          ; SYS_RECT

  ; Clear inside (black rect)
  PUSH8 2               ; x
  PUSH8 2               ; y
  PUSH8 124             ; w
  PUSH8 60              ; h
  ; Need to draw black — but SYS_RECT draws white.
  ; Instead, let's just draw white shapes on black bg.
  SYSCALL 0x00          ; SYS_CLEAR

  ; Small white box top-left
  PUSH8 4
  PUSH8 4
  PUSH8 20
  PUSH8 12
  SYSCALL 0x03

  ; Small white box center
  PUSH8 54
  PUSH8 26
  PUSH8 20
  PUSH8 12
  SYSCALL 0x03

  ; Small white box bottom-right
  PUSH8 104
  PUSH8 48
  PUSH8 20
  PUSH8 12
  SYSCALL 0x03

  ; Draw a diagonal line
  PUSH8 4               ; y0
  PUSH8 4               ; x0
  PUSH8 60              ; y1
  PUSH8 124             ; x1
  SYSCALL 0x02          ; SYS_LINE

  SYSCALL 0x06          ; SYS_YIELD
  HALT
