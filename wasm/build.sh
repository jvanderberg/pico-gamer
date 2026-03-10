#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
VM_LIB="$ROOT_DIR/vm/lib/pico_vm"
WASM_DIR="$SCRIPT_DIR"
OUT_DIR="$ROOT_DIR/web/src/wasm"
PUBLIC_DIR="$ROOT_DIR/web/public"
CACHE_DIR="$ROOT_DIR/.cache/emscripten"
SYSTEM_EMSCRIPTEN_CONFIG="/usr/share/emscripten/.emscripten"
SYSTEM_CACHE_DIR="/usr/share/emscripten/cache"

mkdir -p "$OUT_DIR" "$PUBLIC_DIR"
mkdir -p "$CACHE_DIR"

if ! command -v emcc >/dev/null 2>&1; then
    if [ -f "$HOME/emsdk/emsdk_env.sh" ]; then
        # Use the local emsdk install when the shell has not preloaded it.
        # shellcheck disable=SC1091
        source "$HOME/emsdk/emsdk_env.sh" >/dev/null
    fi
fi

if ! command -v emcc >/dev/null 2>&1; then
    echo "error: emcc not found. Install/activate emsdk or ensure ~/emsdk/emsdk_env.sh exists." >&2
    exit 1
fi

# Debian/Ubuntu's packaged Emscripten ships with FROZEN_CACHE enabled and a
# prebuilt shared cache. Reusing that cache avoids build failures when this
# script points EM_CACHE at a fresh project-local directory.
if [ -z "${EM_CACHE:-}" ]; then
    if [ -f "$SYSTEM_EMSCRIPTEN_CONFIG" ] &&
       grep -Eq '^[[:space:]]*FROZEN_CACHE[[:space:]]*=[[:space:]]*True' "$SYSTEM_EMSCRIPTEN_CONFIG" &&
       [ -d "$SYSTEM_CACHE_DIR" ]; then
        export EM_CACHE="$SYSTEM_CACHE_DIR"
    else
        export EM_CACHE="$CACHE_DIR"
    fi
fi

SOURCES=(
    "$VM_LIB/vm.cpp"
    "$VM_LIB/display.cpp"
    "$VM_LIB/font.cpp"
    "$VM_LIB/sprites.cpp"
    "$VM_LIB/particles.cpp"
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
    _vm_audio_cmd_count
    _vm_audio_cmd_id
    _vm_audio_cmd_arg
    _vm_audio_cmd_clear
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
    -s INITIAL_MEMORY=8388608 \
    -s EXPORTED_FUNCTIONS="[$EXPORTS]" \
    -s EXPORTED_RUNTIME_METHODS='["cwrap","HEAPU8"]' \
    -O2 \
    --no-entry

# Copy .wasm to public/ for stable asset serving
cp "$OUT_DIR/pico-vm.wasm" "$PUBLIC_DIR/pico-vm.wasm"

echo "Build complete: $OUT_DIR/pico-vm.mjs + $OUT_DIR/pico-vm.wasm"
echo "Copied to: $PUBLIC_DIR/pico-vm.wasm"
