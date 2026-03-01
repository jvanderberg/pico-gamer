cmake_minimum_required(VERSION 3.13)

include(pico_sdk_import.cmake)

project(fps_bench C CXX ASM)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)

pico_sdk_init()

add_executable(fps_bench main.c)

target_link_libraries(fps_bench
    pico_stdlib
    hardware_i2c
    hardware_dma
)

pico_enable_stdio_usb(fps_bench 1)
pico_enable_stdio_uart(fps_bench 0)

pico_add_extra_outputs(fps_bench)
