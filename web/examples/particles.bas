' Particle System Demo
' Press BTN to trigger explosion at cursor
' Hold ENC_BTN for continuous rocket exhaust

DATA ship_gfx, $18, $3C, $7E, $FF, $FF, $7E, $3C, $18

x = 64
y = 32

' Emitter 0: explosion (burst mode)
PFX_SET 0, 80, 20, 128, 0, 1, PFX_SPEED_VAR OR PFX_LIFE_VAR

' Emitter 1: rocket exhaust (continuous mode)
PFX_SET 1, 25, 8, 5, 192, 0, PFX_LIFE_VAR

' Emitter 2: sparkle trail (2x2, continuous)
PFX_SET 2, 20, 30, 30, 64, 2, PFX_2X2 OR PFX_SPEED_VAR OR PFX_LIFE_VAR

DO
  inp = INPUT()

  ' Move cursor
  IF inp AND INPUT_UP THEN y = y - 2
  IF inp AND INPUT_DOWN THEN y = y + 2
  IF inp AND INPUT_LEFT THEN x = x - 2
  IF inp AND INPUT_RIGHT THEN x = x + 2

  ' Clamp to screen
  IF x > 120 THEN x = 120
  IF y > 56 THEN y = 56
  IF x < 0 THEN x = 0
  IF y < 0 THEN y = 0

  ' Explosion on button press
  IF inp AND INPUT_BTN THEN
    PFX_POS 0, x + 4, y + 4
    PFX_BURST 0, 30
  END IF

  ' Rocket exhaust while encoder button held
  IF inp AND INPUT_ENC_BTN THEN
    PFX_POS 1, x + 4, y + 8
    PFX_ON 1, 2
  ELSE
    PFX_ON 1, 0
  END IF

  ' Sparkle trail follows cursor
  PFX_POS 2, x + 4, y + 4
  PFX_ON 2, 1

  ' Draw cursor ship
  BLIT ship_gfx, x, y, 8, 8

  ' HUD
  TEXT_SM "BTN=EXPLODE", 1, 1
  TEXT_SM "ENC=THRUST", 1, 57

  YIELD
LOOP
