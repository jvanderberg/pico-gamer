#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
VM_LIB="$ROOT_DIR/vm/lib/pico_vm"
WASM_DIR="$SCRIPT_DIR"
OUT_DIR="$ROOT_DIR/web/src/wasm"
PUBLIC_DIR="$ROOT_DIR/web/public"

mkdir -p "$OUT_DIR" "$PUBLIC_DIR"

SOURCES=(
    "$VM_LIB/vm.cpp"
    "$VM_LIB/display.cpp"
    "$VM_LIB/font.cpp"
    "$VM_LIB/sprites.cpp"
    "$VM_LIB/syscalls.cpp"
    "$VM_LIB/runtime.cpp"
    "$WASM_DIR/wasm_api.cpp"
)

EXPORTED_FUNCTIONS=(
    _vm_init
    _vm_reset
    _vm_load_program
    _vm_set_input
    _vm_set_elapsed_ms
    _vm_exec_frame
    _vm_step
    _vm_is_yielded
    _vm_do_sprite_update
    _vm_clear_fb
    _vm_get_framebuffer
    _vm_get_pc
    _vm_get_sp
    _vm_get_tos
    _vm_get_cycles
    _vm_is_halted
    _vm_get_stack_value
    _vm_read_mem
    _vm_write_mem
    _vm_read_mem16
    _vm_get_pixel_front
    _vm_spr_active
    _vm_spr_x
    _vm_spr_y
    _vm_spr_vx
    _vm_spr_vy
    _vm_spr_width
    _vm_spr_height
    _vm_spr_flags
    _vm_spr_edge
    _vm_spr_angle
    _vm_spr_rot_speed
    _vm_spr_coll_group
    _vm_spr_coll_mask
    _vm_spr_sprite_mode
    _vm_spr_set_active
    _vm_spr_set_x
    _vm_spr_set_y
    _vm_spr_set_vx
    _vm_spr_set_vy
    _vm_spr_set_angle
    _vm_spr_set_rot_speed
    _vm_spr_set_addr
    _vm_spr_set_width
    _vm_spr_set_height
    _vm_spr_set_flags
    _vm_spr_set_edge
    _vm_spr_set_coll_group
    _vm_spr_set_coll_mask
    _vm_spr_set_sprite_mode
    _malloc
    _free
)

# Join exported functions with commas
EXPORTS=$(IFS=,; echo "${EXPORTED_FUNCTIONS[*]}")

emcc "${SOURCES[@]}" \
    -I "$VM_LIB" \
    -o "$OUT_DIR/pico-vm.mjs" \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s ALLOW_MEMORY_GROWTH=0 \
    -s INITIAL_MEMORY=1048576 \
    -s EXPORTED_FUNCTIONS="[$EXPORTS]" \
    -s EXPORTED_RUNTIME_METHODS='["cwrap","HEAPU8"]' \
    -O2 \
    --no-entry

# Copy .wasm to public/ for stable asset serving
cp "$OUT_DIR/pico-vm.wasm" "$PUBLIC_DIR/pico-vm.wasm"

echo "Build complete: $OUT_DIR/pico-vm.mjs + $OUT_DIR/pico-vm.wasm"
echo "Copied to: $PUBLIC_DIR/pico-vm.wasm"
