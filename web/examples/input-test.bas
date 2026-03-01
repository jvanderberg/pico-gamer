' Move a 4x4 block with arrow keys / WASD

x = 60
y = 28

DO
  inp = INPUT()
  IF inp AND INPUT_UP THEN y = y - 1
  IF inp AND INPUT_DOWN THEN y = y + 1
  IF inp AND INPUT_LEFT THEN x = x - 1
  IF inp AND INPUT_RIGHT THEN x = x + 1
  RECT x, y, 4, 4
  YIELD
LOOP
